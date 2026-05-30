// =====================================================================
// /api/admin/reconciliation/recurring-dismiss
//
// MAIA recurring estimates in the Upcoming Payments section are computed
// live from payment history — there's nothing stored to edit. When staff
// judge an estimate wrong/unwanted, they dismiss it (by its recurring
// fingerprint `vendor_key`) so it stops reappearing.
//
// POST   { assoc, vendor_key }  → dismiss (upsert)
// DELETE ?assoc=&vendor_key=     → un-dismiss
//
// Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

async function requireStaff() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return null
  return session
}

export async function POST(req: Request) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { assoc?: string; vendor_key?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const assoc = (body.assoc ?? '').trim().toUpperCase()
  const vendorKey = (body.vendor_key ?? '').trim()
  if (!assoc || !vendorKey) return NextResponse.json({ error: 'assoc and vendor_key are required' }, { status: 400 })

  const actor = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null
  const { error } = await supabaseAdmin
    .from('recurring_estimate_dismissals')
    .upsert({ association_code: assoc, vendor_key: vendorKey, dismissed_by_email: actor }, { onConflict: 'association_code,vendor_key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const assoc = (url.searchParams.get('assoc') ?? '').trim().toUpperCase()
  const vendorKey = (url.searchParams.get('vendor_key') ?? '').trim()
  if (!assoc || !vendorKey) return NextResponse.json({ error: 'assoc and vendor_key are required' }, { status: 400 })
  const { error } = await supabaseAdmin
    .from('recurring_estimate_dismissals')
    .delete().eq('association_code', assoc).eq('vendor_key', vendorKey)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
