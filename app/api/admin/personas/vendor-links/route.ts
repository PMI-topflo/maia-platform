// =====================================================================
// /api/admin/personas/vendor-links   (staff-only)
//
// MAIA-local "this vendor serves this association" links. CINC's API
// exposes the vendor↔association linkage READ-ONLY, so staff tag vendors
// to an association here and the Personas Vendors tab scopes to CINC's
// links PLUS these.
//
//   GET    ?assoc=CODE              → list links for an association
//   POST   { assoc, vendorId, vendorName }  → add a link (idempotent)
//   DELETE ?assoc=CODE&vendorId=N   → remove a link
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireStaff() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}

const actorEmail = (s: { userId: string | number }) =>
  typeof s.userId === 'string' && s.userId.includes('@') ? s.userId.toLowerCase() : null

export async function GET(req: Request) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const assoc = (new URL(req.url).searchParams.get('assoc') ?? '').trim().toUpperCase()
  if (!assoc) return NextResponse.json({ links: [] })
  const { data, error } = await supabaseAdmin
    .from('association_vendor_links')
    .select('cinc_vendor_id, vendor_name, created_at')
    .eq('association_code', assoc)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ links: data ?? [] })
}

export async function POST(req: Request) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { assoc?: string; vendorId?: number | string; vendorName?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const assoc = (body.assoc ?? '').trim().toUpperCase()
  const vendorId = Number(body.vendorId)
  if (!assoc || !Number.isFinite(vendorId) || vendorId <= 0) {
    return NextResponse.json({ error: 'assoc and a numeric vendorId are required' }, { status: 400 })
  }

  // Idempotent: unique (association_code, cinc_vendor_id). Re-tagging is a no-op.
  const { error } = await supabaseAdmin
    .from('association_vendor_links')
    .upsert(
      { association_code: assoc, cinc_vendor_id: vendorId, vendor_name: (body.vendorName ?? '').trim() || null, created_by_email: actorEmail(session) },
      { onConflict: 'association_code,cinc_vendor_id' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const assoc = (url.searchParams.get('assoc') ?? '').trim().toUpperCase()
  const vendorId = Number(url.searchParams.get('vendorId'))
  if (!assoc || !Number.isFinite(vendorId)) {
    return NextResponse.json({ error: 'assoc and vendorId are required' }, { status: 400 })
  }
  const { error } = await supabaseAdmin
    .from('association_vendor_links')
    .delete()
    .eq('association_code', assoc)
    .eq('cinc_vendor_id', vendorId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
