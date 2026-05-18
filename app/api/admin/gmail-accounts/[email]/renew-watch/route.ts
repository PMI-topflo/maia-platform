// =====================================================================
// POST /api/admin/gmail-accounts/[email]/renew-watch
//
// Triggers an on-demand Gmail watch renewal for a single staff
// account. Used by the "Renew now" button on /admin/tools so staff
// don't have to wait for the every-6-days cron after fixing an
// auth issue.
//
// Returns the same shape as the cron's per-account result.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { renewStaffAccountWatch } from '@/app/api/cron/renew-gmail-watch/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  const decoded   = decodeURIComponent(email)
  if (!decoded || !decoded.includes('@')) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const topic = process.env.GMAIL_PUBSUB_TOPIC
  if (!topic) {
    return NextResponse.json({ error: 'GMAIL_PUBSUB_TOPIC not set on server' }, { status: 500 })
  }

  const { data: account, error } = await supabaseAdmin
    .from('staff_gmail_accounts')
    .select('gmail_address, refresh_token, access_token, token_expiry')
    .eq('gmail_address', decoded)
    .maybeSingle()

  if (error || !account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const result = await renewStaffAccountWatch({
    gmail_address: account.gmail_address as string,
    refresh_token: account.refresh_token as string,
    access_token:  account.access_token as string | null,
    token_expiry:  account.token_expiry as string | null,
    topic,
  })

  if (result.ok) {
    return NextResponse.json({ ok: true, historyId: result.historyId })
  }
  return NextResponse.json(
    { ok: false, error: result.error, isInvalidGrant: result.isInvalidGrant },
    { status: 200 },  // 200 because the endpoint succeeded — the renewal failed
  )
}
