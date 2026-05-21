// =====================================================================
// POST /api/admin/gmail-accounts/[email]/sync-inbox
//
// Reconciles MAIA's Emails view for one account to its LIVE Gmail inbox:
// any email_logs row whose message is no longer in the inbox (archived,
// trashed, or deleted in Gmail) is dismissed. Runs server-side because
// the Gmail credentials are sensitive and only exist in the deployment
// environment. Re-runnable.
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

const MAIN_ACCOUNT = 'maia@pmitop.com'

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

  // 2. Currently-visible inbound rows logged for this inbox.
  const visible: Array<{ id: string; gmail_message_id: string | null }> = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabaseAdmin
      .from('email_logs')
      .select('id, gmail_message_id')
      .eq('direction', 'inbound')
      .is('dismissed_at', null)
      .ilike('to_email', addr)
      .order('id', { ascending: true })
      .range(start, start + 999)
    if (error) {
      return NextResponse.json({ ok: false, error: error.message })
    }
    const rows = (data ?? []) as Array<{ id: string; gmail_message_id: string | null }>
    visible.push(...rows)
    if (rows.length < 1000) break
  }

  // 3. Dismiss every visible row whose message is not in the live inbox
  //    (or has no message id, so it can't be confirmed in the inbox).
  const toDismiss = visible
    .filter(r => !r.gmail_message_id || !inboxIds.has(r.gmail_message_id))
    .map(r => r.id)

  let dismissed = 0
  const nowIso = new Date().toISOString()
  for (let i = 0; i < toDismiss.length; i += 200) {
    const chunk = toDismiss.slice(i, i + 200)
    const { error } = await supabaseAdmin
      .from('email_logs')
      .update({ dismissed_at: nowIso, dismissed_by_email: 'system' })
      .in('id', chunk)
    if (error) {
      return NextResponse.json({ ok: false, error: error.message, dismissed })
    }
    dismissed += chunk.length
  }

  return NextResponse.json({
    ok:            true,
    inboxSize:     inboxIds.size,
    visibleBefore: visible.length,
    dismissed,
    visibleAfter:  visible.length - dismissed,
  })
}
