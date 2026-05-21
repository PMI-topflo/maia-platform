// =====================================================================
// POST /api/admin/gmail-accounts/[email]/sync-inbox
//
// Mirrors MAIA's Emails view for one account to its LIVE Gmail inbox.
// After this runs, the account's visible inbound mail in Communications
// is EXACTLY the set of messages currently in the Gmail INBOX:
//
//   • a message in the inbox  → exactly one visible email_logs row
//                               (extra duplicate rows are dismissed)
//   • a message NOT in the inbox (archived / trashed / deleted, or a
//     stale backlog replay) → every row for it is dismissed
//   • a previously auto-dismissed message that is still in the inbox
//     (noise-sender, internal staff-to-staff, stale-replay) → restored
//
// Runs server-side because the Gmail credentials are sensitive and only
// exist in the deployment environment. Re-runnable.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  refreshStaffToken,
  listAllInboxMessageIds,
  listAllInboxMessageIdsWithToken,
} from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAIN_ACCOUNT = 'maia@pmitop.com'

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

  // 1. The live set of message ids currently in this account's INBOX.
  let inboxIds: Set<string>
  try {
    if (addr === MAIN_ACCOUNT) {
      inboxIds = new Set(await listAllInboxMessageIds())
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
      inboxIds = new Set(await listAllInboxMessageIdsWithToken(refreshed.access_token))
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }

  // 2. EVERY inbound row logged for this inbox — visible AND dismissed.
  //    The `to_email` match is a substring (ilike %addr%) so it tolerates
  //    bracket-wrapped + display-name + multi-recipient header values,
  //    exactly like the Communications page query.
  const allRows: InboundRow[] = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabaseAdmin
      .from('email_logs')
      .select('id, gmail_message_id, dismissed_at')
      .eq('direction', 'inbound')
      .ilike('to_email', `%${addr}%`)
      .order('id', { ascending: true })
      .range(start, start + 999)
    if (error) {
      return NextResponse.json({ ok: false, error: error.message })
    }
    const rows = (data ?? []) as InboundRow[]
    allRows.push(...rows)
    if (rows.length < 1000) break
  }

  const visibleBefore = allRows.filter(r => !r.dismissed_at).length

  // 3. Reconcile against the live inbox.
  //    Group rows by gmail_message_id; rows with no message id can't be
  //    confirmed against the inbox, so they are always dismissed.
  const byMsgId        = new Map<string, InboundRow[]>()
  const toDismiss      = new Set<string>()   // row ids to dismiss
  const toRestore      = new Set<string>()   // row ids to un-dismiss

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
      // Prefer a row that is already visible to minimise churn.
      const keeper = rows.find(r => !r.dismissed_at) ?? rows[0]
      for (const r of rows) {
        if (r.id === keeper.id) {
          if (r.dismissed_at) toRestore.add(r.id)        // bring it back
        } else if (!r.dismissed_at) {
          toDismiss.add(r.id)                            // dedupe extra copy
        }
      }
    } else {
      // Message is no longer in the inbox → dismiss every visible copy.
      for (const r of rows) if (!r.dismissed_at) toDismiss.add(r.id)
    }
  }

  // Inbox messages that have NO email_logs row at all — never ingested
  // (e.g. arrived during a watch outage). Reported so we can tell a
  // genuine ingest gap apart from an auto-dismiss mismatch.
  let missingFromLog = 0
  for (const id of inboxIds) if (!byMsgId.has(id)) missingFromLog++

  // 4. Apply — restore first so a row never ends up in both sets.
  const nowIso = new Date().toISOString()
  const restoreIds = [...toRestore]
  const dismissIds = [...toDismiss].filter(id => !toRestore.has(id))

  let restored  = 0
  for (let i = 0; i < restoreIds.length; i += 500) {
    const chunk = restoreIds.slice(i, i + 500)
    const { error } = await supabaseAdmin
      .from('email_logs')
      .update({ dismissed_at: null, dismissed_by_email: null, auto_dismiss_reason: null })
      .in('id', chunk)
    if (error) {
      return NextResponse.json({ ok: false, error: error.message, restored, dismissed: 0 })
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
      return NextResponse.json({ ok: false, error: error.message, restored, dismissed })
    }
    dismissed += chunk.length
  }

  // After the reconcile, the visible set is exactly one row per inbox
  // message that we have a log row for.
  let visibleAfter = 0
  for (const id of inboxIds) if (byMsgId.has(id)) visibleAfter++

  return NextResponse.json({
    ok:            true,
    inboxSize:     inboxIds.size,
    loggedRows:    allRows.length,
    visibleBefore,
    restored,
    dismissed,
    missingFromLog,
    visibleAfter,
  })
}
