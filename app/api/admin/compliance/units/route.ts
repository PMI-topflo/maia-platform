// =====================================================================
// GET /api/admin/compliance/units?assoc=CODE
// Owners/units in an association + their unit-scope compliance records, so
// the Compliance Hub can show each unit's present / missing documents and
// the document-intake picker can choose the owner. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ownerLabel } from '@/lib/owner-match'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const assoc = (new URL(req.url).searchParams.get('assoc') ?? '').trim().toUpperCase()
  if (!assoc) return NextResponse.json({ error: 'assoc is required' }, { status: 400 })

  const [{ data: ownerRows }, { data: recRows }] = await Promise.all([
    supabaseAdmin.from('owners')
      .select('account_number, first_name, last_name, unit_number')
      .eq('association_code', assoc).or('status.neq.previous,status.is.null'),
    supabaseAdmin.from('compliance_records')
      .select('unit_ref, item_key, status, expiry_date, source_path')
      .eq('association_code', assoc).eq('scope', 'unit'),
  ])

  const owners = (ownerRows ?? [])
    .map(o => ({
      account_number: String(o.account_number),
      label: ownerLabel(o as { first_name: string | null; last_name: string | null; unit_number: string | null; account_number: string }),
      unit_number: (o.unit_number as string | null) ?? null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))

  return NextResponse.json({ owners, records: recRows ?? [] })
}
