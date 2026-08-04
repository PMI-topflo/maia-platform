// POST /api/admin/pre-apply/[id]/decision-page
//   { decision?, conditions?, leaseStart?, leaseEnd?, occupants?, signers?[] }
// Creates the Board Decision Page. The number of signers follows the
// association's required_signatures (e.g. MANXI needs 2). Signers default to the
// top board officers (President first); any with an on-file signature are signed
// immediately, the rest get a signing link. Staff-only.
// GET → prefill (default signers, full address, applicant, lease term, occupants).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { signEsignToken } from '@/lib/esign-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

const rolePriority = (role: string | null): number => {
  const r = (role ?? '').toLowerCase()
  if (r.includes('president') && !r.includes('vice')) return 0
  if (r.includes('vice')) return 1
  if (r.includes('secretary')) return 2
  if (r.includes('treasurer')) return 3
  return 4
}

async function loadContext(id: string) {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, application_type, unit_label').eq('id', id).maybeSingle()
  if (!app) return null
  const code = String(app.association_code)
  const [{ data: assoc }, { data: sh }, { data: members }, { data: cfg }, { data: tenant }] = await Promise.all([
    supabaseAdmin.from('associations').select('legal_name, association_name, principal_address, city, state, zip').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('name').eq('application_id', id).eq('role', 'applicant').eq('is_primary', true).maybeSingle(),
    supabaseAdmin.from('association_board_members').select('name, email, role, signature_image').eq('association_code', code).eq('active', true),
    supabaseAdmin.from('association_config').select('required_signatures').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('unit_tenant_contacts').select('occupants, lease_start, lease_end').eq('association_code', code).eq('unit_ref', app.unit_label ?? '').maybeSingle(),
  ])
  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || code
  const addr = [assoc?.principal_address, app.unit_label ? `Unit ${app.unit_label}` : null, [assoc?.city, [assoc?.state, assoc?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ')
  const occ = Array.isArray(tenant?.occupants) ? (tenant!.occupants as Array<{ name?: string } | string>).map(o => typeof o === 'string' ? o : o?.name).filter(Boolean) as string[] : []
  const required = Math.max(1, (cfg?.required_signatures as number | null) ?? 1)
  const ordered = (members ?? []).slice().sort((a, b) => rolePriority(a.role as string) - rolePriority(b.role as string))
  return { app, code, legal, propertyAddress: addr || null, applicant: (sh?.name as string | null) ?? null, required, board: ordered, tenant, occupants: occ }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const c = await loadContext(id)
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    applicationType: c.app.application_type, propertyAddress: c.propertyAddress, applicant: c.applicant,
    requiredSignatures: c.required,
    defaultSigners: c.board.slice(0, c.required).map(m => ({ name: m.name, email: m.email, role: m.role, hasSignature: !!m.signature_image })),
    allBoard: c.board.map(m => ({ name: m.name, email: m.email, role: m.role, hasSignature: !!m.signature_image })),
    leaseStart: c.tenant?.lease_start ?? null, leaseEnd: c.tenant?.lease_end ?? null,
    occupants: c.occupants, applicantAsOccupant: c.applicant,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let b: { decision?: string; conditions?: string; leaseStart?: string; leaseEnd?: string; occupants?: string[]; signers?: { name?: string; email?: string }[] }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const c = await loadContext(id)
  if (!c) return NextResponse.json({ error: 'Application not found' }, { status: 404 })

  // Signers: staff-supplied list, else the top `required` board officers.
  const chosen = (b.signers && b.signers.length ? b.signers : c.board.slice(0, c.required).map(m => ({ name: m.name as string | null, email: m.email as string | null })))
    .map(x => ({ name: x.name?.trim() || null, email: (x.email ?? '').trim() })).filter(x => x.email.includes('@'))
  if (chosen.length === 0) return NextResponse.json({ error: 'No signer emails — set board officers (with a President) in Board setup or enter emails.' }, { status: 400 })

  const occupants = (b.occupants ?? []).map(o => String(o).trim()).filter(Boolean)
  const payload = {
    associationLegalName: c.legal, propertyAddress: c.propertyAddress, applicant: c.applicant,
    occupants: occupants.length ? occupants : (c.applicant ? [c.applicant] : []),
    unit: c.app.unit_label, applicationType: c.app.application_type,
    decision: b.decision?.trim() || 'Approved', conditions: b.conditions?.trim() || null,
    leaseStart: b.leaseStart || c.tenant?.lease_start || null, leaseEnd: b.leaseEnd || c.tenant?.lease_end || null,
  }

  const now = new Date().toISOString()
  const sigByEmail = new Map(c.board.map(m => [String(m.email).toLowerCase(), m.signature_image as string | null]))
  const signers = chosen.map((x, i) => {
    const onFile = sigByEmail.get(x.email.toLowerCase()) ?? null
    const base = { role: `approver_${i + 1}`, name: x.name, email: x.email, phone: null as string | null }
    return onFile
      ? { ...base, signed_at: now, sig_name: x.name, sig_image: onFile, sig_ip: null, verification: { email: x.email, emailVerifiedAt: now } }
      : base
  })
  const allSigned = signers.every(sg => 'signed_at' in sg)

  const { data: created, error } = await supabaseAdmin.from('esign_documents').insert({
    kind: 'board_decision', association_code: c.code, unit_ref: c.app.unit_label,
    title: `Board Decision — ${c.propertyAddress ?? `Unit ${c.app.unit_label ?? ''}`}`.trim(),
    payload, signers, status: allSigned ? 'completed' : (signers.some(sg => 'signed_at' in sg) ? 'partially_signed' : 'sent'),
    created_by: `staff:${session.displayName}`,
  }).select('id').single()
  if (error || !created) return NextResponse.json({ error: `Could not create: ${error?.message ?? 'unknown'}` }, { status: 500 })

  await supabaseAdmin.from('listing_applications').update({ review_note: `Board Decision Page — ${signers.filter(sg => 'signed_at' in sg).length}/${signers.length} signed`, updated_at: now }).eq('id', id)

  const result = await Promise.all(signers.map(async (sg) => ({
    name: sg.name, email: sg.email, signed: 'signed_at' in sg,
    link: 'signed_at' in sg ? null : `${APP}/esign/${await signEsignToken(created.id, sg.role)}`,
  })))
  return NextResponse.json({ ok: true, docId: created.id, allSigned, pdfUrl: `${APP}/api/esign/${await signEsignToken(created.id, signers[0].role)}/pdf`, signers: result })
}
