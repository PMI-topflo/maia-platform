// GET /api/request/[token]
// Public (token-gated): the document request for one recipient (owner or tenant)
// — what to upload, for which property, and what's already in. No login.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { parseDeclarations, getIntakeChecklist, isApplicationType, signTemplateUrls } from '@/lib/intake-documents'
import { getReviewState } from '@/lib/board-review'
import { findUnitLeasePacket } from '@/lib/lease-packet'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ReqItem { doc_key: string; label: string; recipient: 'owner' | 'tenant' | 'both' }

// Synthetic doc_keys draftStandardReply appends when a vehicle/animal
// declaration is unanswered — never a real checklist item, so they can't
// collide with one. See app/api/request/[token]/declare/route.ts.
const DECLARE_VEHICLE = '__declare_vehicle__'
const DECLARE_ANIMAL = '__declare_animal__'

export async function loadRequest(token: string) {
  if (!UUID.test(token)) return null
  const { data } = await supabaseAdmin.from('document_requests')
    .select('id, application_id, association_code, unit_label, items, message, owner_token, tenant_token, owner_email, tenant_email, owner_note, tenant_note')
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

  const unitLabelForPacket = (r.req.unit_label as string | null) ?? null
  const [{ data: assoc }, { data: docs }, { data: roster }, { data: appRow }, state, packet] = await Promise.all([
    supabaseAdmin.from('associations').select('legal_name, association_name, principal_address, city, state, zip').eq('association_code', r.req.association_code).maybeSingle(),
    supabaseAdmin.from('application_documents').select('doc_key').eq('application_id', r.req.application_id),
    supabaseAdmin.from('application_stakeholders').select('name, email, phone, applicant_role, is_primary')
      .eq('application_id', r.req.application_id).eq('role', 'applicant').order('is_primary', { ascending: false }),
    supabaseAdmin.from('listing_applications').select('application_type, declarations').eq('id', r.req.application_id).maybeSingle(),
    getReviewState(r.req.application_id),
    unitLabelForPacket ? findUnitLeasePacket(r.req.association_code, unitLabelForPacket) : Promise.resolve(null),
  ])
  const declarations = parseDeclarations(appRow?.declarations)
  // A file item can go stale on THIS row: it was appended when a declaration
  // gate was still undecided (both animal paths kept open — see
  // app/api/request/[token]/declare/route.ts), and the applicant's later,
  // more specific answer retired it from the checklist for good — e.g.
  // choosing "a pet" retires assistance_animal_documentation. The stored
  // items array is never edited to remove it, so re-derive relevance from
  // the SAME live checklist state every other screen reads, at render time,
  // rather than trusting the snapshot. Still shown if already uploaded, so
  // a completed upload never disappears out from under someone.
  const stillRelevant = new Set((state?.rows ?? []).map(row => row.docKey))
  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || r.req.association_code
  const unit = (r.req.unit_label as string | null) ?? null
  const address = [assoc?.principal_address, unit ? `Unit ${unit}` : null, [assoc?.city, [assoc?.state, assoc?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') || null
  const have = new Set((docs ?? []).map(d => String(d.doc_key)))
  // Prefill what we already know so the owner corrects a list instead of
  // retyping it — and so a partly-filled roster is visibly partly filled.
  const people = (roster ?? []).map(p => ({
    name: (p.name as string | null) ?? '', email: (p.email as string | null) ?? '',
    phone: (p.phone as string | null) ?? '', role: (p.applicant_role as string | null) ?? 'Tenant',
  }))
  // Done means everyone we know about has an email AND a phone — and that we
  // know about somebody at all.
  const contactDone = people.length > 0 && people.every(p => p.name && p.email && p.phone)

  // A blank example form (Tenant Affidavit, etc) to download before filling
  // it out — the same template_path the admin Request panel and the request
  // EMAIL already link to, now on the page itself. User direction,
  // 2026-08-19: "the linked card should have a button to download the Tenant
  // Affidavit." Keyed by doc_key, signed fresh so the link never expires on
  // someone who opens this page days after the email.
  const type = String(appRow?.application_type ?? '')
  const checklist = isApplicationType(type) ? await getIntakeChecklist(r.req.association_code, type) : []
  const templateByKey = new Map(checklist.map(c => [c.doc_key, c.template_path]))
  const templateUrlByPath = await signTemplateUrls(checklist.filter(c => r.mine.some(i => i.doc_key === c.doc_key)))

  return NextResponse.json({
    associationName: legal, associationCode: r.req.association_code, propertyAddress: address, unit,
    role: r.role, message: r.req.message ?? null,
    note: (r.role === 'owner' ? r.req.owner_note : r.req.tenant_note) as string | null ?? null,
    tenantName: people[0]?.name || null,
    // The roster question is worded differently for an additional occupant:
    // it is one named person, and what we need is THEIR OWN email.
    applicationType: (appRow?.application_type as string | null) ?? null,
    people,
    items: r.mine.map(i => {
      if (i.doc_key === 'tenant_contact_info') return { doc_key: i.doc_key, label: i.label, kind: 'contact' as const, uploaded: contactDone }
      if (i.doc_key === DECLARE_VEHICLE) return { doc_key: i.doc_key, label: i.label, kind: 'declare' as const, declareKey: 'vehicle' as const, uploaded: typeof declarations.vehicle?.has === 'boolean', has: declarations.vehicle?.has ?? null }
      if (i.doc_key === DECLARE_ANIMAL) return { doc_key: i.doc_key, label: i.label, kind: 'declare' as const, declareKey: 'animal' as const, uploaded: typeof declarations.animal?.has === 'boolean', has: declarations.animal?.has ?? null, animalKind: declarations.animal?.kind ?? null }
      // landlord_tenant_agreement is never an upload — MAIA sends its own
      // e-signed packet for it (lib/lease-packet.ts, request-docs/route.ts).
      // User direction, 2026-08-21: keep it ON the card as something still
      // outstanding, with a button to push the signing links, instead of
      // just disappearing — a silent removal reads as "nothing left to do"
      // when the agreement genuinely isn't signed yet.
      if (i.doc_key === 'landlord_tenant_agreement') {
        const mySignedAt = r.role === 'owner' ? packet?.ownerSignedAt : packet?.tenantSignedAt
        const otherSignedAt = r.role === 'owner' ? packet?.tenantSignedAt : packet?.ownerSignedAt
        return {
          doc_key: i.doc_key, label: i.label, kind: 'esign_packet' as const,
          uploaded: packet?.status === 'completed',
          packetStatus: (packet?.status ?? 'not_sent') as 'not_sent' | 'sent' | 'partially_signed' | 'completed',
          mySigned: !!mySignedAt, otherSigned: !!otherSignedAt,
        }
      }
      const path = templateByKey.get(i.doc_key)
      const exampleUrl = path ? templateUrlByPath.get(path) ?? null : null
      return { doc_key: i.doc_key, label: i.label, kind: 'file' as const, uploaded: have.has(i.doc_key), exampleUrl }
    }).filter(it => it.kind !== 'file' || it.uploaded || stillRelevant.has(it.doc_key)),
  })
}
