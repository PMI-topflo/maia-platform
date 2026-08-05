// GET /api/units/overview?assoc=CODE
// Association details for the board / on-site-manager audit page — the same
// non-financial "Association Details" the admin hub shows. Units-portal auth.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await resolveUnitsAuth(new URL(req.url).searchParams.get('assoc'))
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: a }, { count: boardCount }, { count: docCount }] = await Promise.all([
    supabaseAdmin.from('associations')
      .select('association_name, legal_name, association_type, service_type, florida_statute, principal_address, city, state, zip, sunbiz_document_number, sunbiz_status')
      .eq('association_code', auth.assoc).maybeSingle(),
    supabaseAdmin.from('association_board_members').select('id', { count: 'exact', head: true }).eq('association_code', auth.assoc).eq('active', true),
    supabaseAdmin.from('compliance_records').select('id', { count: 'exact', head: true }).eq('association_code', auth.assoc).eq('scope', 'association'),
  ])

  const address = [a?.principal_address, [a?.city, [a?.state, a?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ')
  return NextResponse.json({
    name: (a?.legal_name as string | null) || (a?.association_name as string | null) || auth.assoc,
    type: a?.association_type ?? null, service: a?.service_type ?? null, statute: a?.florida_statute ?? null,
    address: address || null, sunbiz: a?.sunbiz_document_number ?? null, sunbizStatus: a?.sunbiz_status ?? null,
    boardMembers: boardCount ?? 0, associationDocs: docCount ?? 0,
  })
}
