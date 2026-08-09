// POST /api/units/tenant  { account, assoc, tenant_name?, tenant_phone?, tenant_email?, lease_start?, lease_end? }
// Board / on-site manager / staff add or update the tenant's contact + lease on
// a unit (unit_tenant_contacts). Units-portal auth; needs upload permission.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const dateOrNull = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) ? v.trim() : null

export async function POST(req: Request) {
  let b: { account?: string; assoc?: string; tenant_name?: string; tenant_phone?: string; tenant_email?: string; lease_start?: string; lease_end?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const auth = await resolveUnitsAuth(b.assoc ?? null)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.canUpload) return NextResponse.json({ error: 'no permission' }, { status: 403 })
  const account = String(b.account ?? '').trim()
  if (!account) return NextResponse.json({ error: 'account required' }, { status: 400 })
  if (auth.managedUnits && !auth.managedUnits.includes(account)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const email = String(b.tenant_email ?? '').trim()
  if (email && !email.includes('@')) return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 })

  // Merge onto the existing record so editing one field doesn't wipe the others.
  const { data: cur } = await supabaseAdmin.from('unit_tenant_contacts')
    .select('tenant_name, tenant_phone, tenant_email, lease_start, lease_end')
    .eq('association_code', auth.assoc).eq('unit_ref', account).maybeSingle()

  const row = {
    association_code: auth.assoc, unit_ref: account,
    tenant_name: 'tenant_name' in b ? (String(b.tenant_name ?? '').trim() || null) : (cur?.tenant_name ?? null),
    tenant_phone: 'tenant_phone' in b ? (String(b.tenant_phone ?? '').trim() || null) : (cur?.tenant_phone ?? null),
    tenant_email: 'tenant_email' in b ? (email || null) : (cur?.tenant_email ?? null),
    lease_start: 'lease_start' in b ? dateOrNull(b.lease_start) : (cur?.lease_start ?? null),
    lease_end: 'lease_end' in b ? dateOrNull(b.lease_end) : (cur?.lease_end ?? null),
    updated_by: `units: ${auth.persona}`, updated_at: new Date().toISOString(),
  }
  const { error } = await supabaseAdmin.from('unit_tenant_contacts').upsert(row, { onConflict: 'association_code,unit_ref' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
