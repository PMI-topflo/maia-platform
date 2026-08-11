// GET /api/request/[token]
// Public (token-gated): the document request for one recipient (owner or tenant)
// — what to upload, for which property, and what's already in. No login.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ReqItem { doc_key: string; label: string; recipient: 'owner' | 'tenant' | 'both' }

export async function loadRequest(token: string) {
  if (!UUID.test(token)) return null
  const { data } = await supabaseAdmin.from('document_requests')
    .select('id, application_id, association_code, unit_label, items, message, owner_token, tenant_token, owner_note, tenant_note')
    .or(`owner_token.eq.${token},tenant_token.eq.${token}`).maybeSingle()
  if (!data) return null
  const role: 'owner' | 'tenant' = data.owner_token === token ? 'owner' : 'tenant'
  const items = (Array.isArray(data.items) ? data.items : []) as ReqItem[]
  const mine = items.filter(i => i.recipient === role || i.recipient === 'both')
  return { req: data, role, mine }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await loadRequest(token)
  if (!r) return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 404 })

  const [{ data: assoc }, { data: docs }, { data: primary }] = await Promise.all([
    supabaseAdmin.from('associations').select('legal_name, association_name, principal_address, city, state, zip').eq('association_code', r.req.association_code).maybeSingle(),
    supabaseAdmin.from('application_documents').select('doc_key').eq('application_id', r.req.application_id),
    supabaseAdmin.from('application_stakeholders').select('name, email, phone').eq('application_id', r.req.application_id).eq('role', 'applicant').eq('is_primary', true).maybeSingle(),
  ])
  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || r.req.association_code
  const unit = (r.req.unit_label as string | null) ?? null
  const address = [assoc?.principal_address, unit ? `Unit ${unit}` : null, [assoc?.city, [assoc?.state, assoc?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') || null
  const have = new Set((docs ?? []).map(d => String(d.doc_key)))
  const contactDone = !!(primary?.email && primary?.phone)

  return NextResponse.json({
    associationName: legal, propertyAddress: address, unit,
    role: r.role, message: r.req.message ?? null,
    note: (r.role === 'owner' ? r.req.owner_note : r.req.tenant_note) as string | null ?? null,
    tenantName: (primary?.name as string | null) ?? null,
    items: r.mine.map(i => i.doc_key === 'tenant_contact_info'
      ? { doc_key: i.doc_key, label: i.label, kind: 'contact', uploaded: contactDone }
      : { doc_key: i.doc_key, label: i.label, kind: 'file', uploaded: have.has(i.doc_key) }),
  })
}
