import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  fetchGmailHistory,
  fetchGmailHistoryWithToken,
  fetchGmailMessageWithToken,
  fetchGmailAttachmentDataWithToken,
  listRecentInboxMessages,
  listRecentInboxMessagesWithToken,
  refreshStaffToken,
  type GmailHistoryChanges,
} from '@/lib/gmail'
import {
  processEmailCommand,
  parseGmailMessage,
  detectAssociationCode,
  isAllowedSender,
  ingestInboundEmailToTicket,
} from '@/lib/maia-command-processor'
import { logEmail } from '@/lib/email-logger'

// A normal Gmail Pub/Sub notification covers a handful of new messages.
// A history batch larger than this means the stored historyId was far
// behind real time (a watch that sat dead for days) — treat it as a
// stale-cursor replay, not real traffic, and resync recent inbox only
// instead of re-logging the whole backlog with today's timestamps.
const BACKLOG_REPLAY_CAP  = 100
const RECENT_RESYNC_LIMIT = 20

// Gmail deletion sync marks email_logs rows dismissed in batches. Kept
// small so the `.in()` filter URL stays well under any length limit.
const DISMISS_CHUNK = 100

/** Mark email_logs rows dismissed when their Gmail message was deleted,
 *  trashed, or archived out of INBOX. Matches by gmail_message_id (unique
 *  per mailbox). Only rows not already dismissed are touched, so a manual
 *  dismissal or auto-dismiss flag is never overwritten. Degrades silently
 *  if the gmail_message_id column hasn't been migrated yet. */
async function dismissEmailsDeletedInGmail(messageIds: string[]): Promise<number> {
  let dismissed = 0
  for (let i = 0; i < messageIds.length; i += DISMISS_CHUNK) {
    const chunk = messageIds.slice(i, i + DISMISS_CHUNK)
    const { data, error } = await supabaseAdmin
      .from('email_logs')
      .update({ dismissed_at: new Date().toISOString(), dismissed_by_email: 'system' })
      .in('gmail_message_id', chunk)
      .is('dismissed_at', null)
      .select('id')
    if (error) {
      // Pre-migration: gmail_message_id column not added yet → no-op.
      if (/gmail_message_id/i.test(error.message)) return dismissed
      console.error('[maia-webhook] deletion sync update failed:', error.message)
      return dismissed
    }
    dismissed += data?.length ?? 0
  }
  return dismissed
}

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

// True when an error is a Gmail per-user rate limit (429 / RESOURCE_EXHAUSTED).
function isRateLimit(msg: string): boolean {
  return /\b429\b|rate.?limit|too many requests|quota|resource_exhausted/i.test(msg)
}

// When Gmail rate-limits us it returns "Retry after <ISO timestamp>". Park a
// cooldown until then (+ a 30s buffer) so we stop hitting Gmail and let the
// per-user quota reset. Falls back to now+5min if no timestamp is present.
function cooldownUntil(msg: string): string {
  const m = msg.match(/Retry after (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)
  const base = m ? new Date(m[1]).getTime() : Date.now() + 5 * 60_000
  const until = Number.isFinite(base) ? base : Date.now() + 5 * 60_000
  return new Date(until + 30_000).toISOString()
}

export async function POST(req: NextRequest) {
  // EMERGENCY KILL SWITCH — set MAIA_WEBHOOK_DISABLED=1 in the environment to
  // make this endpoint ack every Pub/Sub delivery (200) and do NOTHING: no
  // Gmail fetch, no Claude calls. Instantly halts any processing loop /
  // runaway API spend. Pub/Sub stops redelivering because we ack with 200.
  if (process.env.MAIA_WEBHOOK_DISABLED === '1') {
    return NextResponse.json({ ok: true, disabled: true })
  }

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

  const emailAddress = (notification.emailAddress ?? '').toLowerCase()

  // Check if this notification is for a connected staff account. Match
  // case-insensitively: Gmail can deliver the address in a different
  // case than it was stored, and an exact .eq() would silently miss —
  // mis-routing the notification to the main-account path so the staff
  // inbox captures nothing. The connected-account set is tiny, so a
  // fetch-then-find in JS is cheap and avoids ilike wildcard pitfalls.
  // RESILIENT SELECT: try with gmail_cooldown_until, but fall back to the
  // base columns if that column hasn't been migrated yet. Selecting a
  // missing column errors the WHOLE query (data=null), which would route
  // every notification down the wrong path and silently take MAIA down —
  // exactly the "code deployed before migration" outage we just had. The
  // fallback degrades to "no cooldown" instead of breaking.
  const STAFF_BASE = 'gmail_address, refresh_token, access_token, token_expiry, history_id'
  let staffAccounts = (await supabaseAdmin.from('staff_gmail_accounts').select(`${STAFF_BASE}, gmail_cooldown_until`).eq('active', true)).data as Record<string, unknown>[] | null
  if (!staffAccounts) staffAccounts = (await supabaseAdmin.from('staff_gmail_accounts').select(STAFF_BASE).eq('active', true)).data as Record<string, unknown>[] | null
  const staffAccount = (staffAccounts ?? []).find(
    a => typeof a.gmail_address === 'string' && (a.gmail_address as string).toLowerCase() === emailAddress,
  ) ?? null

  if (staffAccount) {
    await processStaffAccountEmails(staffAccount as StaffAccountRow, newHistoryId)
    return NextResponse.json({ ok: true, account: emailAddress })
  }

  // Main PMI account — existing logic. Resilient select, same reason as above.
  let state = (await supabaseAdmin.from('maia_watch_state').select('last_history_id, gmail_cooldown_until').eq('id', 1).maybeSingle()).data as Record<string, unknown> | null
  if (!state) state = (await supabaseAdmin.from('maia_watch_state').select('last_history_id').eq('id', 1).maybeSingle()).data as Record<string, unknown> | null

  const lastHistoryId = state?.last_history_id as string | undefined

  // Self-healing cooldown: if we recently got rate-limited, ACK without
  // touching Gmail until the Retry-After time passes — so the per-user quota
  // gets a quiet window to reset instead of being re-tripped on every
  // notification. The cursor stays put; we resume once the cooldown expires.
  const cooldown = state?.gmail_cooldown_until as string | undefined
  if (cooldown && new Date(cooldown).getTime() > Date.now()) {
    return NextResponse.json({ ok: true, cooling_down_until: cooldown })
  }

  // First-ever notification: just establish the baseline.
  if (!lastHistoryId) {
    await supabaseAdmin
      .from('maia_watch_state')
      .upsert({ id: 1, last_history_id: newHistoryId, updated_at: new Date().toISOString() })
    return NextResponse.json({ ok: true, baseline: true })
  }

  let changes: GmailHistoryChanges
  try {
    changes = await fetchGmailHistory(lastHistoryId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[maia-webhook] History API error:', msg)
    // Gmail RATE LIMIT (429): park a cooldown until the Retry-After time and
    // ACK with 200. Redelivering on a 429 just re-hits the already-limited
    // endpoint (amplifying it); skipping Gmail entirely until the cooldown
    // expires lets the quota reset. Cursor stays put → catches up after.
    if (isRateLimit(msg)) {
      await supabaseAdmin
        .from('maia_watch_state')
        .upsert({ id: 1, gmail_cooldown_until: cooldownUntil(msg), updated_at: new Date().toISOString() })
      console.warn(`[maia-webhook] Gmail rate-limited — cooling down until ${cooldownUntil(msg)}`)
      return NextResponse.json({ ok: true, rateLimited: true })
    }
    // Other transient errors: 500 so Pub/Sub retries from the same cursor.
    return NextResponse.json({ ok: false, error: 'history_fetch_failed' }, { status: 500 })
  }

  let messageIds  = changes.added
  let staleReplay = false

  // Stale-historyId guard: a batch this large means lastHistoryId was far
  // behind real time. Replaying it would re-log hundreds of old messages
  // with today's timestamp — resync only the recent inbox instead.
  if (messageIds.length > BACKLOG_REPLAY_CAP) {
    staleReplay = true
    console.warn(`[maia-webhook] history returned ${messageIds.length} messages (cap ${BACKLOG_REPLAY_CAP}) — stale historyId, resyncing recent inbox only`)
    try {
      messageIds = await listRecentInboxMessages(RECENT_RESYNC_LIMIT)
    } catch (err) {
      console.error('[maia-webhook] recent resync error:', err)
      return NextResponse.json({ ok: false, error: 'inbox_scan_failed' }, { status: 500 })
    }
  } else if (messageIds.length === 0) {
    // Recovery path: 404s and other "history purged / out of range" cases come
    // back from fetchGmailHistory empty. Falling back to listing recent inbox
    // messages directly catches the message that prompted the notification.
    // Idempotency in processEmailCommand (UNIQUE on gmail_message_id) and in
    // ticket_messages.external_id makes this safe to re-run.
    console.log('[maia-webhook] history fetch returned empty — falling back to direct inbox scan')
    try {
      messageIds = await listRecentInboxMessages(RECENT_RESYNC_LIMIT)
    } catch (err) {
      console.error('[maia-webhook] inbox scan fallback error:', err)
      return NextResponse.json({ ok: false, error: 'inbox_scan_failed' }, { status: 500 })
    }
  }

  // Advance the cursor BEFORE processing. The Gmail history fetch already
  // succeeded (a fetch error 500s above and Pub/Sub retries from the same
  // cursor), so we have the message ids in hand. Committing the new cursor
  // now means a Pub/Sub redelivery — or a slow batch that overruns the 60s
  // ack deadline — can't replay this same batch and re-call Claude on every
  // message. Reprocessing was the runaway-cost loop; processEmailCommand is
  // already idempotent (UNIQUE on gmail_message_id), so the worst case of an
  // early advance is a rare missed message, recoverable via resync — far
  // cheaper than an infinite reprocess.
  await supabaseAdmin
    .from('maia_watch_state')
    .upsert({ id: 1, last_history_id: newHistoryId, updated_at: new Date().toISOString() })

  for (const id of messageIds) {
    try {
      await processEmailCommand(id)
    } catch (err) {
      console.error(`[maia-webhook] processEmailCommand(${id}) error:`, err)
    }
  }

  // Gmail deletion sync: dismiss the email_logs row for any message that
  // was deleted / trashed / archived out of INBOX, so the Communications
  // view mirrors the inbox. Skipped on a stale replay — that batch can
  // carry months of removals and isn't worth the webhook's time.
  let dismissed = 0
  if (!staleReplay && changes.removed.length > 0) {
    dismissed = await dismissEmailsDeletedInGmail(changes.removed)
  }

  return NextResponse.json({ ok: true, processed: messageIds.length, dismissed })
}

// ── Staff account email processing ───────────────────────────────────────────

type StaffAccountRow = {
  gmail_address: string
  refresh_token: string
  access_token:  string | null
  token_expiry:  string | null
  history_id:    string | null
  gmail_cooldown_until?: string | null
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
  // Self-healing cooldown — skip Gmail entirely while this account is rate-
  // limited, so its per-user quota can reset (same as the main-account path).
  if (account.gmail_cooldown_until && new Date(account.gmail_cooldown_until).getTime() > Date.now()) {
    return
  }

  const lastHistoryId = account.history_id
  if (!lastHistoryId) {
    // First notification — set baseline, nothing to process yet
    await supabaseAdmin
      .from('staff_gmail_accounts')
      .update({ history_id: newHistoryId, updated_at: new Date().toISOString() })
      .eq('gmail_address', account.gmail_address)
    return
  }

  let accessToken: string
  try {
    accessToken = await getValidStaffToken(account)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[staff-gmail] Token refresh failed for ${account.gmail_address}:`, msg)
    // A revoked / expired refresh token (Google `invalid_grant`) is permanent:
    // it will fail on EVERY future notification, churning oauth2 calls + error
    // logs until someone re-auths. Deactivate the account so we stop retrying;
    // the staff Gmail re-connect flow sets active=true again with a fresh
    // token. Other (transient) errors just log + retry on the next push.
    if (/invalid_grant/i.test(msg)) {
      await supabaseAdmin
        .from('staff_gmail_accounts')
        .update({ active: false, last_watch_error: msg.slice(0, 500), last_watch_error_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('gmail_address', account.gmail_address)
      console.warn(`[staff-gmail] deactivated ${account.gmail_address} (dead refresh token — reconnect to re-enable)`)
    }
    return
  }

  let changes: GmailHistoryChanges
  try {
    changes = await fetchGmailHistoryWithToken(lastHistoryId, accessToken)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[staff-gmail] History API error for ${account.gmail_address}:`, msg)
    // On a Gmail rate-limit, park a cooldown so we stop hitting this account's
    // quota until the Retry-After passes (lets it reset). Other errors: just
    // return (no 500, so no Pub/Sub redelivery storm on this path).
    if (isRateLimit(msg)) {
      await supabaseAdmin
        .from('staff_gmail_accounts')
        .update({ gmail_cooldown_until: cooldownUntil(msg), updated_at: new Date().toISOString() })
        .eq('gmail_address', account.gmail_address)
      console.warn(`[staff-gmail] ${account.gmail_address} rate-limited — cooling down until ${cooldownUntil(msg)}`)
    }
    return
  }

  let messageIds  = changes.added
  let staleReplay = false

  // Stale-historyId guard — see the main-account path above. A batch this
  // large means the stored history_id was far behind; replaying it would
  // re-log a backlog of old mail. Resync recent inbox only.
  if (messageIds.length > BACKLOG_REPLAY_CAP) {
    staleReplay = true
    console.warn(`[staff-gmail] history returned ${messageIds.length} messages for ${account.gmail_address} (cap ${BACKLOG_REPLAY_CAP}) — stale historyId, resyncing recent inbox only`)
    try {
      messageIds = await listRecentInboxMessagesWithToken(accessToken, RECENT_RESYNC_LIMIT)
    } catch (err) {
      console.error(`[staff-gmail] recent resync error for ${account.gmail_address}:`, err)
      return
    }
  } else if (messageIds.length === 0) {
    // Recovery path: empty history (404 / out of range) → fall back to recent
    // inbox scan so we don't silently lose messages when Gmail's history
    // index is stale.
    console.log(`[staff-gmail] history empty for ${account.gmail_address} — falling back to direct inbox scan`)
    try {
      messageIds = await listRecentInboxMessagesWithToken(accessToken, RECENT_RESYNC_LIMIT)
    } catch (err) {
      console.error(`[staff-gmail] inbox scan fallback error for ${account.gmail_address}:`, err)
      return
    }
  }

  // Advance the cursor BEFORE processing — same anti-runaway-loop fix as the
  // main account path. A redelivery (or a batch that overruns the 60s ack
  // deadline) must not replay the same messages and re-call Claude.
  await supabaseAdmin
    .from('staff_gmail_accounts')
    .update({ history_id: newHistoryId, updated_at: new Date().toISOString() })
    .eq('gmail_address', account.gmail_address)

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
        gmailThreadId:   parsed.threadId,
        gmailMessageId:  parsed.messageId,
        emailDate:       parsed.internalDate,
      })

      // Invoice intake used to fire here for any PDF landing in
      // billing@. That implicit magnet kept swallowing real staff
      // commands ("@maia update db" CC'd to billing@ became invoice
      // drafts). As of 2026-05-26 invoice intake is purely explicit —
      // it only fires on the maia@ webhook when the body contains
      // "@maia process invoice", "@maia invoice", or "@maia upload
      // invoice". See
      // processEmailCommand → invoice-intake trigger.

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
      await ingestInboundEmailToTicket(
        parsed, isAllowedSender(parsed.senderEmail), assocCode,
        (attId) => fetchGmailAttachmentDataWithToken(parsed.messageId, attId, accessToken),
      )
    } catch (err) {
      console.error(`[staff-gmail] Failed to process message ${id} for ${account.gmail_address}:`, err)
    }
  }

  // Gmail deletion sync: dismiss email_logs rows for messages deleted /
  // trashed / archived out of this staff inbox. Skipped on a stale replay.
  if (!staleReplay && changes.removed.length > 0) {
    await dismissEmailsDeletedInGmail(changes.removed)
  }

  // Advance the staff account cursor only after processing finished — if
  // fetchGmailHistoryWithToken errored above we've already returned and
  // never reach this point, so the next notification retries from the
  // same start.
  await supabaseAdmin
    .from('staff_gmail_accounts')
    .update({ history_id: newHistoryId, updated_at: new Date().toISOString() })
    .eq('gmail_address', account.gmail_address)
}
