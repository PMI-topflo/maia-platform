// GET /api/units/lease-packet/rent-demand?account=…&assoc=…
// Generate the §718.116(11) Direct Rent Demand Notice (tenant demand +
// owner notice) for a unit, personalized with the association's legal name,
// owner, tenant, and payment instructions. Staff/board/manager serve it on
// owner delinquency. Read-only; the officer completes the signature blanks.

import { renderToBuffer } from '@react-pdf/renderer'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { RentDemandPdf } from '@/lib/lease-packet-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const account = (url.searchParams.get('account') || '').trim()
  const auth = await resolveUnitsAuth(url.searchParams.get('assoc'))
  if (!auth) return new Response('Unauthorized', { status: 401 })
  if (!account) return new Response('account required', { status: 400 })
  if (auth.managedUnits && !auth.managedUnits.includes(account)) return new Response('forbidden', { status: 403 })

  const [{ data: owner }, { data: tenant }, { data: assoc }] = await Promise.all([
    supabaseAdmin.from('owners').select('first_name, last_name, entity_name, unit_number, address')
      .eq('association_code', auth.assoc).eq('account_number', account).or('status.neq.previous,status.is.null').maybeSingle(),
    supabaseAdmin.from('unit_tenant_contacts').select('tenant_name').eq('association_code', auth.assoc).eq('unit_ref', account).maybeSingle(),
    supabaseAdmin.from('associations').select('legal_name, association_name, principal_address').eq('association_code', auth.assoc).maybeSingle(),
  ])

  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || auth.assoc
  const ownerName = (owner?.entity_name as string | null) || [owner?.first_name, owner?.last_name].filter(Boolean).join(' ').trim() || null

  const pdf = await renderToBuffer(RentDemandPdf({
    associationLegalName: legal,
    unitNumber: (owner?.unit_number as string | null) || account,
    ownerName,
    ownerAddress: (owner?.address as string | null) ?? null,
    tenantNames: tenant?.tenant_name ? [String(tenant.tenant_name)] : [],
    payableTo: legal,
    paymentAddress: (assoc?.principal_address as string | null) ?? null,
    paymentContact: 'PMI Top Florida Properties · ar@topfloridaproperties.com · (305) 900-5105',
    noticeDate: new Date().toISOString().slice(0, 10),
  }))
  return new Response(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Rent-Demand-${account}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
