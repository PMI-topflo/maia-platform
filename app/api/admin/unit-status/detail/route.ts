// =====================================================================
// GET /api/admin/unit-status/detail?assoc=X&account=Y   (staff-only)
// Full missing-item detail for one unit (account_number is the real unit
// key — see route.ts's comment on why unit_number alone isn't unique).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getUnitComplianceState, OCCUPANCY_LABEL } from '@/lib/unit-required-docs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function firstEmail(emails: string | null): string | null {
  if (!emails) return null
  return emails.split(/[,;\s]+/).map(s => s.trim()).find(e => e.includes('@')) ?? null
}

export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const assoc = searchParams.get('assoc')
  const account = searchParams.get('account')
  if (!assoc || !account) return NextResponse.json({ error: 'assoc and account are required' }, { status: 400 })

  const { data: o } = await supabaseAdmin.from('owners')
    .select('unit_number, association_name, first_name, last_name, entity_name, emails')
    .eq('association_code', assoc).eq('account_number', account).limit(1).maybeSingle()

  const { occupancy, missing } = await getUnitComplianceState(assoc, account)
  const ownerName = o?.entity_name || [o?.first_name, o?.last_name].filter(Boolean).join(' ')
  const email = firstEmail((o?.emails as string | null) ?? null)

  return NextResponse.json({
    associationName: o?.association_name ?? assoc, unit: o?.unit_number ?? null, ownerName, ownerEmail: email,
    occupancy, occupancyLabel: occupancy ? OCCUPANCY_LABEL[occupancy] : null, missing,
  })
}
