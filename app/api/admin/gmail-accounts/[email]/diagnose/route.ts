// =====================================================================
// POST /api/admin/gmail-accounts/[email]/diagnose
//
// Live end-to-end check of one connected staff Gmail account. Refreshes
// the stored token, hits the Gmail API directly, and compares what
// Gmail sees against what MAIA has logged — so a "healthy-looking but
// capturing nothing" inbox can be pinned down without digging through
// Vercel function logs.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  refreshStaffToken,
  fetchGmailProfileWithToken,
  fetchGmailProfile,
  listRecentInboxMessagesWithToken,
  listRecentInboxMessages,
} from '@/lib/gmail'

// The main MAIA inbox — env-var credentials, not a connected staff
// account. Diagnosed via a dedicated branch below.
const MAIN_ACCOUNT = 'maia@pmitop.com'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DiagnoseReport {
  account:          string
  storedHistoryId:  string | null
  watchExpiry:      string | null
  watchExpired:     boolean
  lastWatchError:   string | null
  tokenOk:          boolean
  tokenError:       string | null
  liveHistoryId:    string | null
  messagesTotal:    number | null
  recentInboxCount: number | null
  emailLogs30d:     number
  verdict:          string
}

// Escape LIKE wildcards so an address with '_' (valid in email local
// parts) is matched literally by the ilike contains-check below.
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, c => `\\${c}`)
}

// Gmail per-user rate limit (429 / RESOURCE_EXHAUSTED) — NOT a token failure.
function isRateLimit(msg: string): boolean {
  return /\b429\b|rate.?limit|too many requests|quota|resource_exhausted/i.test(msg)
}
// Parse "Retry after <ISO>" → cooldown timestamp (+30s); fallback now+5min.
function cooldownUntil(msg: string): string {
  const m = msg.match(/Retry after (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)
  const base = m ? new Date(m[1]).getTime() : Date.now() + 5 * 60_000
  return new Date((Number.isFinite(base) ? base : Date.now() + 5 * 60_000) + 30_000).toISOString()
}
// The report shown when an account is in cooldown — no Gmail call made.
function coolingReport(account: string, until: string): DiagnoseReport {
  const mins = Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 60000))
  return {
    account, storedHistoryId: null, watchExpiry: null, watchExpired: false, lastWatchError: null,
    tokenOk: false, tokenError: null, liveHistoryId: null, messagesTotal: null,
    recentInboxCount: null, emailLogs30d: 0,
    verdict: `Cooling down — Gmail rate-limited this account; it auto-resumes in ~${mins} min (until ${until}). This is NOT a token problem — do not reconnect. Avoid Diagnose/Sync until then so the limit can reset.`,
  }
}

// A processing cursor more than this far behind the live mailbox means
// notifications have stopped being processed. Healthy inboxes sit within
// a few dozen of live (notifications are near-real-time); a gap in the
// thousands is a stuck cursor, not normal lag.
const CURSOR_GAP_ALERT = 1000

function buildVerdict(r: DiagnoseReport): string {
  if (!r.tokenOk) {
    return 'Token refresh FAILED — this account must be reconnected before it can capture any mail.'
  }
  if (r.recentInboxCount === 0) {
    return 'Gmail API reached the mailbox, but its INBOX has no recent messages. Mail may be skipping the inbox (a Gmail filter or forward), or this address simply receives little mail.'
  }
  if ((r.recentInboxCount ?? 0) > 0 && r.emailLogs30d === 0) {
    return 'BREAK FOUND: Gmail has recent inbox mail but MAIA logged nothing in the last 30 days. The token works, so the Gmail watch / Pub-Sub notifications are not reaching MAIA. Try "Renew now"; if it stays at zero, the Pub/Sub push subscription needs checking.'
  }
  // Cursor far behind the live mailbox: notifications aren't being
  // processed even though some mail was logged at some point.
  const gap = (r.liveHistoryId && r.storedHistoryId)
    ? Number(r.liveHistoryId) - Number(r.storedHistoryId)
    : 0
  if (Number.isFinite(gap) && gap > CURSOR_GAP_ALERT) {
    return `BREAK FOUND: MAIA's processing cursor is ${gap.toLocaleString()} history events behind this mailbox — notifications stopped being processed, so it is capturing little or no new mail (only ${r.emailLogs30d} inbound emails logged in 30 days, vs. thousands on a healthy inbox). Re-check after the next inbound email; if the gap doesn't close, the watch is mis-routed.`
  }
  if (r.watchExpired) {
    return `MAIA has logged ${r.emailLogs30d} inbound emails, but the Gmail watch is expired — new mail will stop arriving until it is renewed.`
  }
  return `Healthy — MAIA has logged ${r.emailLogs30d} inbound emails for this inbox in the last 30 days.`
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

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString()

  // Main MAIA inbox — env-var credentials + maia_watch_state cursor,
  // not a connected staff account. Diagnosed with the env-token helpers.
  if (addr === MAIN_ACCOUNT) {
    let ws = (await supabaseAdmin.from('maia_watch_state').select('last_history_id, watch_expiry, gmail_cooldown_until').eq('id', 1).maybeSingle()).data as Record<string, unknown> | null
    if (!ws) ws = (await supabaseAdmin.from('maia_watch_state').select('last_history_id, watch_expiry').eq('id', 1).maybeSingle()).data as Record<string, unknown> | null

    // Respect the cooldown — if Gmail recently rate-limited us, do NOT call
    // Gmail again (that just re-trips it). Report the cooldown instead.
    const cd = (ws as Record<string, unknown> | null)?.gmail_cooldown_until as string | null
    if (cd && new Date(cd).getTime() > Date.now()) {
      return NextResponse.json({ ok: true, report: coolingReport(MAIN_ACCOUNT, cd) })
    }

    const report: DiagnoseReport = {
      account:          MAIN_ACCOUNT,
      storedHistoryId:  (ws?.last_history_id as string | null) ?? null,
      watchExpiry:      (ws?.watch_expiry as string | null) ?? null,
      watchExpired:     !!(ws?.watch_expiry && new Date(ws.watch_expiry as string).getTime() < Date.now()),
      lastWatchError:   null,
      tokenOk:          false,
      tokenError:       null,
      liveHistoryId:    null,
      messagesTotal:    null,
      recentInboxCount: null,
      emailLogs30d:     0,
      verdict:          '',
    }

    const { count } = await supabaseAdmin
      .from('email_logs')
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'inbound')
      .gte('created_at', thirtyDaysAgo)
      .ilike('to_email', `%${escapeLike(MAIN_ACCOUNT)}%`)
    report.emailLogs30d = count ?? 0

    try {
      const profile        = await fetchGmailProfile()
      report.tokenOk       = true
      report.liveHistoryId = String(profile.historyId)
      report.messagesTotal = profile.messagesTotal
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      report.tokenError = m
      // A 429 here is a rate limit, not a token failure — record a cooldown
      // and report it as such instead of "must be reconnected".
      if (isRateLimit(m)) {
        const until = cooldownUntil(m)
        await supabaseAdmin.from('maia_watch_state').upsert({ id: 1, gmail_cooldown_until: until, updated_at: new Date().toISOString() })
        return NextResponse.json({ ok: true, report: coolingReport(MAIN_ACCOUNT, until) })
      }
    }
    if (report.tokenOk) {
      try {
        const recent            = await listRecentInboxMessages(20)
        report.recentInboxCount = recent.length
      } catch { /* leave recentInboxCount null */ }
    }

    report.verdict = buildVerdict(report)
    return NextResponse.json({ ok: true, report })
  }

  // Load the connected account (case-insensitive — see the webhook).
  const STAFF_SEL = 'gmail_address, refresh_token, history_id, watch_expiry, last_watch_error'
  let accounts = (await supabaseAdmin.from('staff_gmail_accounts').select(`${STAFF_SEL}, gmail_cooldown_until`).eq('active', true)).data as Record<string, unknown>[] | null
  if (!accounts) accounts = (await supabaseAdmin.from('staff_gmail_accounts').select(STAFF_SEL).eq('active', true)).data as Record<string, unknown>[] | null
  const account = (accounts ?? []).find(
    a => typeof a.gmail_address === 'string' && (a.gmail_address as string).toLowerCase() === addr,
  )
  if (!account) {
    return NextResponse.json({ error: 'No active connected account for that address' }, { status: 404 })
  }

  // Respect the cooldown — don't re-hit Gmail while rate-limited.
  const acctCd = (account as Record<string, unknown>).gmail_cooldown_until as string | null
  if (acctCd && new Date(acctCd).getTime() > Date.now()) {
    return NextResponse.json({ ok: true, report: coolingReport(account.gmail_address as string, acctCd) })
  }

  const report: DiagnoseReport = {
    account:          account.gmail_address as string,
    storedHistoryId:  (account.history_id as string | null) ?? null,
    watchExpiry:      (account.watch_expiry as string | null) ?? null,
    watchExpired:     !!(account.watch_expiry && new Date(account.watch_expiry as string).getTime() < Date.now()),
    lastWatchError:   (account.last_watch_error as string | null) ?? null,
    tokenOk:          false,
    tokenError:       null,
    liveHistoryId:    null,
    messagesTotal:    null,
    recentInboxCount: null,
    emailLogs30d:     0,
    verdict:          '',
  }

  // How many INBOUND emails has MAIA captured for this inbox in the last
  // 30 days? Inbound-only so the number reflects ingest, not replies.
  const { count: logCount } = await supabaseAdmin
    .from('email_logs')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'inbound')
    .gte('created_at', thirtyDaysAgo)
    .ilike('to_email', `%${escapeLike(addr)}%`)
  report.emailLogs30d = logCount ?? 0

  // Refresh the token and hit the Gmail API live.
  const setCooldownAndReport = async (m: string) => {
    const until = cooldownUntil(m)
    await supabaseAdmin.from('staff_gmail_accounts').update({ gmail_cooldown_until: until, updated_at: new Date().toISOString() }).eq('gmail_address', account.gmail_address as string)
    return NextResponse.json({ ok: true, report: coolingReport(account.gmail_address as string, until) })
  }
  let accessToken = ''
  try {
    const refreshed = await refreshStaffToken(account.refresh_token as string)
    accessToken     = refreshed.access_token
    report.tokenOk  = true
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err)
    report.tokenError = m
    if (isRateLimit(m)) return setCooldownAndReport(m)
  }

  if (report.tokenOk) {
    try {
      const profile        = await fetchGmailProfileWithToken(accessToken)
      report.liveHistoryId = String(profile.historyId)
      report.messagesTotal = profile.messagesTotal
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      report.tokenError = m
      if (isRateLimit(m)) return setCooldownAndReport(m)
    }
    try {
      const recent           = await listRecentInboxMessagesWithToken(accessToken, 20)
      report.recentInboxCount = recent.length
    } catch {
      /* leave recentInboxCount null */
    }
  }

  report.verdict = buildVerdict(report)
  return NextResponse.json({ ok: true, report })
}
