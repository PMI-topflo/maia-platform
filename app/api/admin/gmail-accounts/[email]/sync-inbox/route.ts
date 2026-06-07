// =====================================================================
// POST /api/admin/gmail-accounts/[email]/sync-inbox
//
// Mirrors MAIA's Emails view for one account to its LIVE Gmail inbox.
// After this runs, the account's visible inbound mail in Communications
// is EXACTLY the set of messages currently in the Gmail INBOX:
//
//   • a message in the inbox with NO log row → fetched and logged now
//     (back-fills anything the Gmail webhook never ingested)
//   • a message in the inbox  → exactly one visible email_logs row
//                               (extra duplicate rows are dismissed)
//   • a message NOT in the inbox (archived / trashed / deleted, or a
//     stale backlog replay) → every row for it is dismissed
//   • a previously auto-dismissed message that is still in the inbox
//     (noise-sender, internal staff-to-staff, stale-replay) → restored
//
// It also stamps each in-inbox row with the message's TRUE Gmail date
// (internalDate) so the Communications view sorts like the real inbox
// instead of by log time.
//
// Runs server-side because the Gmail credentials are sensitive and only
// exist in the deployment environment. Re-runnable.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { logEmail } from '@/lib/email-logger'
import { parseGmailMessage } from '@/lib/maia-command-processor'
import {
  refreshStaffToken,
  fetchGmailMessage,
  fetchGmailMessageWithToken,
  listInboxMessageIdsAndDates,
  listInboxMessageIdsAndDatesWithToken,
} from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAIN_ACCOUNT = 'maia@pmitop.com'

// Most inbox messages we'll fetch-and-log in one sync. The real ingest
// gap is small; this just bounds a pathological run.
const BACKFILL_CAP = 300

function isRateLimit(msg: string): boolean {
  return /\b429\b|rate.?limit|too many requests|quota|resource_exhausted/i.test(msg)
}
function cooldownUntil(msg: string): string {
  const m = msg.match(/Retry after (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)
  const base = m ? new Date(m[1]).getTime() : Date.now() + 5 * 60_000
  return new Date((Number.isFinite(base) ? base : Date.now() + 5 * 60_000) + 30_000).toISOString()
}

interface InboundRow {
  id:               string
  gmail_message_id: string | null
  dismissed_at:     string | null
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ email: string }> },
) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { email } = await ctx.params
  const addr      = decodeURIComponent(email).trim().toLowerCase()
  if (!addr.includes('@')) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  // Respect the Gmail cooldown — if this account was recently rate-limited,
  // don't hit Gmail again (that re-trips it). Report and bail.
  const cdField = addr === MAIN_ACCOUNT
    ? (await supabaseAdmin.from('maia_watch_state').select('gmail_cooldown_until').eq('id', 1).maybeSingle()).data
    : (await supabaseAdmin.from('staff_gmail_accounts').select('gmail_cooldown_until').ilike('gmail_address', addr).maybeSingle()).data
  const cd = (cdField as Record<string, unknown> | null)?.gmail_cooldown_until as string | null
  if (cd && new Date(cd).getTime() > Date.now()) {
    const mins = Math.max(0, Math.round((new Date(cd).getTime() - Date.now()) / 60000))
    return NextResponse.json({ ok: false, coolingDown: true, cooldownUntil: cd, error: `Gmail is rate-limiting this account — cooling down ~${mins} min (until ${cd}). Sync skipped so the limit can reset; it auto-resumes.` })
  }

  // 1. The live INBOX: message ids (authoritative) plus a best-effort
  //    id → internalDate map used to stamp each row's true date.
  let inboxIds:    Set<string>
  let inboxDates:  Map<string, string>
  let accessToken: string | null = null   // null = main account (env creds)
  try {
    if (addr === MAIN_ACCOUNT) {
      const live = await listInboxMessageIdsAndDates()
      inboxIds = new Set(live.ids); inboxDates = live.dates
    } else {
      const { data: accounts } = await supabaseAdmin
        .from('staff_gmail_accounts')
        .select('gmail_address, refresh_token')
        .eq('active', true)
      const account = (accounts ?? []).find(
        a => typeof a.gmail_address === 'string' && (a.gmail_address as string).toLowerCase() === addr,
      )
      if (!account) {
        return NextResponse.json({ error: 'No active connected account for that address' }, { status: 404 })
      }
      const refreshed = await refreshStaffToken(account.refresh_token as string)
      accessToken = refreshed.access_token
      const live = await listInboxMessageIdsAndDatesWithToken(accessToken)
      inboxIds = new Set(live.ids); inboxDates = live.dates
    }
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err)
    // On a Gmail 429, record a cooldown so the panel + future syncs back off.
    if (isRateLimit(m)) {
      const until = cooldownUntil(m)
      if (addr === MAIN_ACCOUNT) {
        await supabaseAdmin.from('maia_watch_state').upsert({ id: 1, gmail_cooldown_until: until, updated_at: new Date().toISOString() })
      } else {
        await supabaseAdmin.from('staff_gmail_accounts').update({ gmail_cooldown_until: until, updated_at: new Date().toISOString() }).ilike('gmail_address', addr)
      }
      return NextResponse.json({ ok: false, coolingDown: true, cooldownUntil: until, error: `Gmail rate-limited this account — cooling down until ${until}. Sync skipped so the limit can reset.` })
    }
    return NextResponse.json({ ok: false, error: m })
  }

  const fetchMsg = (id: string) =>
    addr === MAIN_ACCOUNT
      ? fetchGmailMessage(id)
      : fetchGmailMessageWithToken(id, accessToken as string)

  // Load EVERY inbound row logged for this inbox — visible AND dismissed.
  // The `to_email` match is a substring (ilike %addr%) so it tolerates
  // bracket-wrapped + display-name + multi-recipient header values,
  // exactly like the Communications page query.
  const loadInboundRows = async (): Promise<{ rows: InboundRow[]; error: string | null }> => {
    const rows: InboundRow[] = []
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabaseAdmin
        .from('email_logs')
        .select('id, gmail_message_id, dismissed_at')
        .eq('direction', 'inbound')
        .ilike('to_email', `%${addr}%`)
        .order('id', { ascending: true })
        .range(start, start + 999)
      if (error) return { rows, error: error.message }
      const page = (data ?? []) as InboundRow[]
      rows.push(...page)
      if (page.length < 1000) break
    }
    return { rows, error: null }
  }

  // 2. Existing rows (before back-fill).
  let load = await loadInboundRows()
  if (load.error) return NextResponse.json({ ok: false, error: load.error })
  const visibleBefore = load.rows.filter(r => !r.dismissed_at).length

  // 3. Back-fill: every inbox message with no log row gets fetched and
  //    logged now. This is what recovers mail the Gmail webhook never
  //    ingested (it skips no-reply senders, automated subjects, etc.).
  const loggedIds = new Set(
    load.rows.map(r => r.gmail_message_id).filter((v): v is string => !!v),
  )
  const missingIds     = [...inboxIds].filter(id => !loggedIds.has(id))
  const backfillCapped = missingIds.length > BACKFILL_CAP
  let backfilled     = 0
  let backfillFailed = 0
  for (const id of missingIds.slice(0, BACKFILL_CAP)) {
    try {
      const parsed = parseGmailMessage(await fetchMsg(id))
      await logEmail({
        direction:      'inbound',
        fromEmail:      parsed.senderEmail,
        toEmail:        addr,
        subject:        parsed.subject,
        fullBody:       parsed.body,
        persona:        'staff',
        status:         'received',
        sentBy:         addr,
        gmailThreadId:  parsed.threadId,
        gmailMessageId: parsed.messageId,
        emailDate:      parsed.internalDate,
      })
      backfilled++
    } catch (err) {
      backfillFailed++
      console.error(`[sync-inbox] back-fill failed for ${id} (${addr}):`, err)
    }
  }

  // Reload so the reconcile sees the rows we just logged.
  if (backfilled > 0) {
    load = await loadInboundRows()
    if (load.error) return NextResponse.json({ ok: false, error: load.error, backfilled })
  }
  const allRows = load.rows

  // 4. Reconcile against the live inbox. Group rows by gmail_message_id;
  //    rows with no message id can't be confirmed, so they're dismissed.
  const byMsgId   = new Map<string, InboundRow[]>()
  const toDismiss = new Set<string>()
  const toRestore = new Set<string>()

  for (const r of allRows) {
    if (!r.gmail_message_id) {
      if (!r.dismissed_at) toDismiss.add(r.id)   // unconfirmable → hide
      continue
    }
    const list = byMsgId.get(r.gmail_message_id)
    if (list) list.push(r)
    else      byMsgId.set(r.gmail_message_id, [r])
  }

  for (const [msgId, rows] of byMsgId) {
    if (inboxIds.has(msgId)) {
      // Message is live in the inbox → keep exactly ONE row visible.
      const keeper = rows.find(r => !r.dismissed_at) ?? rows[0]
      for (const r of rows) {
        if (r.id === keeper.id) {
          if (r.dismissed_at) toRestore.add(r.id)        // bring it back
        } else if (!r.dismissed_at) {
          toDismiss.add(r.id)                            // dedupe extra copy
        }
      }
    } else {
      // Message no longer in the inbox → dismiss every visible copy.
      for (const r of rows) if (!r.dismissed_at) toDismiss.add(r.id)
    }
  }

  // Inbox messages still with no log row — a back-fill fetch that failed.
  let missingFromLog = 0
  for (const id of inboxIds) if (!byMsgId.has(id)) missingFromLog++

  // 5. Apply — restore first so a row never ends up in both sets.
  const nowIso     = new Date().toISOString()
  const restoreIds = [...toRestore]
  const dismissIds = [...toDismiss].filter(id => !toRestore.has(id))

  let restored = 0
  for (let i = 0; i < restoreIds.length; i += 500) {
    const chunk = restoreIds.slice(i, i + 500)
    const { error } = await supabaseAdmin
      .from('email_logs')
      .update({ dismissed_at: null, dismissed_by_email: null, auto_dismiss_reason: null })
      .in('id', chunk)
    if (error) {
      return NextResponse.json({ ok: false, error: error.message, backfilled, restored, dismissed: 0 })
    }
    restored += chunk.length
  }

  let dismissed = 0
  for (let i = 0; i < dismissIds.length; i += 500) {
    const chunk = dismissIds.slice(i, i + 500)
    const { error } = await supabaseAdmin
      .from('email_logs')
      .update({ dismissed_at: nowIso, dismissed_by_email: 'system' })
      .in('id', chunk)
    if (error) {
      return NextResponse.json({ ok: false, error: error.message, backfilled, restored, dismissed })
    }
    dismissed += chunk.length
  }

  // 6. Stamp each in-inbox message's rows with its TRUE Gmail date so
  //    the Communications view sorts like the real inbox instead of by
  //    log time. Best-effort: a missing date or a not-yet-migrated
  //    email_date column is tolerated (the per-update error is ignored).
  const dateJobs: Array<{ msgId: string; iso: string }> = []
  for (const msgId of byMsgId.keys()) {
    if (!inboxIds.has(msgId)) continue
    const epoch = Number(inboxDates.get(msgId))
    if (Number.isFinite(epoch)) {
      dateJobs.push({ msgId, iso: new Date(epoch).toISOString() })
    }
  }
  let datesStamped = 0
  for (let i = 0; i < dateJobs.length; i += 15) {
    const chunk   = dateJobs.slice(i, i + 15)
    const results = await Promise.all(chunk.map(j =>
      supabaseAdmin
        .from('email_logs')
        .update({ email_date: j.iso })
        .eq('gmail_message_id', j.msgId)
        .select('id'),
    ))
    for (const r of results) if (!r.error) datesStamped += r.data?.length ?? 0
  }

  // After the reconcile, the visible set is exactly one row per inbox
  // message that we have a log row for.
  let visibleAfter = 0
  for (const id of inboxIds) if (byMsgId.has(id)) visibleAfter++

  return NextResponse.json({
    ok:             true,
    inboxSize:      inboxIds.size,
    loggedRows:     allRows.length,
    visibleBefore,
    backfilled,
    backfillFailed,
    backfillCapped,
    restored,
    dismissed,
    datesStamped,
    missingFromLog,
    visibleAfter,
  })
}
