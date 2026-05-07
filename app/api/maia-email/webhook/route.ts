import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  fetchGmailHistory,
  fetchGmailHistoryWithToken,
  fetchGmailMessageWithToken,
  refreshStaffToken,
} from '@/lib/gmail'
import {
  processEmailCommand,
  parseGmailMessage,
  detectAssociationCode,
  isAllowedSender,
  ingestInboundEmailToTicket,
} from '@/lib/maia-command-processor'
import { logEmail } from '@/lib/email-logger'

// POST /api/maia-email/webhook
// Receives Gmail push notifications via Google Cloud Pub/Sub.
// Handles both the main PMI account (env var tokens) and connected
// staff Gmail accounts (tokens stored in staff_gmail_accounts table).
//
// Setup (one-time in Google Cloud Console):
//   1. Create Pub/Sub topic: projects/<project>/topics/maia-inbox
//   2. Grant Gmail service account publisher role on that topic:
//      serviceAccount:gmail-api-push@system.gserviceaccount.com
//   3. Create a push subscription pointing to:
//      https://www.pmitop.com/api/maia-email/webhook?token=<GMAIL_PUBSUB_SECRET>
//      Ack deadline: 60s
//   4. POST /api/maia-email/setup-watch to register the main account watch
//   5. Staff accounts register their own watch via /api/auth/gmail-staff/callback
//
// Required env vars: GMAIL_PUBSUB_SECRET

export async function POST(req: NextRequest) {
  const secret = process.env.GMAIL_PUBSUB_SECRET
  if (secret) {
    const token = req.nextUrl.searchParams.get('token')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let body: { message?: { data?: string; messageId?: string }; subscription?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rawData = body.message?.data
  if (!rawData) return NextResponse.json({ ok: true })

  let notification: { emailAddress?: string; historyId?: number }
  try {
    notification = JSON.parse(Buffer.from(rawData, 'base64').toString('utf-8'))
  } catch {
    console.error('[maia-webhook] Failed to decode Pub/Sub message')
    return NextResponse.json({ ok: true })
  }

  const newHistoryId = String(notification.historyId ?? '')
  if (!newHistoryId) return NextResponse.json({ ok: true })

  const emailAddress = notification.emailAddress ?? ''

  // Check if this notification is for a connected staff account
  const { data: staffAccount } = await supabaseAdmin
    .from('staff_gmail_accounts')
    .select('gmail_address, refresh_token, access_token, token_expiry, history_id')
    .eq('gmail_address', emailAddress)
    .eq('active', true)
    .maybeSingle()

  if (staffAccount) {
    await processStaffAccountEmails(staffAccount, newHistoryId)
    return NextResponse.json({ ok: true, account: emailAddress })
  }

  // Main PMI account — existing logic
  const { data: state } = await supabaseAdmin
    .from('maia_watch_state')
    .select('last_history_id')
    .eq('id', 1)
    .maybeSingle()

  const lastHistoryId = state?.last_history_id

  await supabaseAdmin
    .from('maia_watch_state')
    .upsert({ id: 1, last_history_id: newHistoryId, updated_at: new Date().toISOString() })

  if (!lastHistoryId) return NextResponse.json({ ok: true })

  let messageIds: string[]
  try {
    messageIds = await fetchGmailHistory(lastHistoryId)
  } catch (err) {
    console.error('[maia-webhook] History API error:', err)
    return NextResponse.json({ ok: true })
  }

  for (const id of messageIds) {
    try {
      await processEmailCommand(id)
    } catch (err) {
      console.error(`[maia-webhook] processEmailCommand(${id}) error:`, err)
    }
  }

  return NextResponse.json({ ok: true, processed: messageIds.length })
}

// ── Staff account email processing ───────────────────────────────────────────

type StaffAccountRow = {
  gmail_address: string
  refresh_token: string
  access_token:  string | null
  token_expiry:  string | null
  history_id:    string | null
}

async function getValidStaffToken(account: StaffAccountRow): Promise<string> {
  const isExpired = !account.token_expiry || new Date(account.token_expiry).getTime() < Date.now() + 60_000
  if (!isExpired && account.access_token) return account.access_token

  const refreshed = await refreshStaffToken(account.refresh_token)
  const expiry     = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()

  await supabaseAdmin
    .from('staff_gmail_accounts')
    .update({ access_token: refreshed.access_token, token_expiry: expiry, updated_at: new Date().toISOString() })
    .eq('gmail_address', account.gmail_address)

  return refreshed.access_token
}

async function processStaffAccountEmails(account: StaffAccountRow, newHistoryId: string) {
  const lastHistoryId = account.history_id
  if (!lastHistoryId) {
    // First notification — set baseline, nothing to process yet
    await supabaseAdmin
      .from('staff_gmail_accounts')
      .update({ history_id: newHistoryId, updated_at: new Date().toISOString() })
      .eq('gmail_address', account.gmail_address)
    return
  }

  // Update historyId first to avoid re-processing on retries
  await supabaseAdmin
    .from('staff_gmail_accounts')
    .update({ history_id: newHistoryId, updated_at: new Date().toISOString() })
    .eq('gmail_address', account.gmail_address)

  let accessToken: string
  try {
    accessToken = await getValidStaffToken(account)
  } catch (err) {
    console.error(`[staff-gmail] Token refresh failed for ${account.gmail_address}:`, err)
    return
  }

  let messageIds: string[]
  try {
    messageIds = await fetchGmailHistoryWithToken(lastHistoryId, accessToken)
  } catch (err) {
    console.error(`[staff-gmail] History API error for ${account.gmail_address}:`, err)
    return
  }

  for (const id of messageIds) {
    try {
      const msg    = await fetchGmailMessageWithToken(id, accessToken)
      const parsed = parseGmailMessage(msg)

      // Skip automated messages
      const subjectLow = parsed.subject.toLowerCase()
      if (['out of office', 'auto-reply', 'automatic reply', 'delivery failed', 'undeliverable'].some(s => subjectLow.includes(s))) continue
      if (['maia@', 'noreply@', 'no-reply@', 'mailer-daemon@'].some(s => parsed.senderEmail.toLowerCase().includes(s))) continue

      // Skip messages this staff account *sent* — they'll be picked up
      // via the recipient's account (which is also connected) so we don't
      // double-create tickets. The sender side of an outbound staff email
      // is captured as the outbound ticket_messages row when staff reply
      // through the dashboard.
      if (parsed.senderEmail.toLowerCase() === account.gmail_address.toLowerCase()) continue

      // Strict mode: only match explicit account-number patterns (e.g. ESSI16)
      const assocCode = await detectAssociationCode(parsed.subject + ' ' + parsed.body, true)

      void logEmail({
        direction:       'inbound',
        fromEmail:       parsed.senderEmail,
        toEmail:         account.gmail_address,
        subject:         parsed.subject,
        fullBody:        parsed.body,
        persona:         'staff',
        associationCode: assocCode ?? undefined,
        status:          'received',
        sentBy:          account.gmail_address,
      })

      // Tickets are created only for emails explicitly addressed to
      // maia@pmitop.com (To / CC / BCC). Internal staff-to-staff or
      // staff-to-customer emails that happen to land in a connected
      // staff inbox via thread membership won't create tickets — that
      // way only intentional ticket requests from staff hit the dashboard.
      const allRecipients = [...parsed.to, ...parsed.cc].join(' ').toLowerCase()
      if (!allRecipients.includes('maia@pmitop.com')) continue

      // Single source of truth for ticket logic — handles staff-only gating,
      // gmail-thread reply matching, subject-match dedupe, trigger phrase
      // detection, modifier parsing (@assign / @priority / @workorder), and
      // assignee notification. Same call as the main maia@pmitop.com path.
      await ingestInboundEmailToTicket(parsed, isAllowedSender(parsed.senderEmail), assocCode)
    } catch (err) {
      console.error(`[staff-gmail] Failed to process message ${id} for ${account.gmail_address}:`, err)
    }
  }
}
