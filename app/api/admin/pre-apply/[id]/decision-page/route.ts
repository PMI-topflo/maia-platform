// POST /api/admin/pre-apply/[id]/decision-page
//   { email?, name?, decision?, conditions?, leaseStart?, leaseEnd?, occupants? }
// Creates the Board Decision Page for this application. The signer defaults to
// the association's President (from board setup); if that member has an on-file
// signature it is applied immediately (the letter is signed), otherwise a
// signing link is returned to send them. Staff-only.
// GET → prefill data (President, full address, applicant, lease term, occupants).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { signEsignToken } from '@/lib/esign-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

async function loadContext(id: string) {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, application_type, unit_label').eq('id', id).maybeSingle()
  if (!app) return null
  const code = String(app.association_code)
  const [{ data: assoc }, { data: sh }, { data: pres }, { data: tenant }] = await Promise.all([
    supabaseAdmin.from('associations').select('legal_name, association_name, principal_address, city, state, zip').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('name').eq('application_id', id).eq('role', 'applicant').eq('is_primary', true).maybeSingle(),
    supabaseAdmin.from('association_board_members').select('name, email, signature_image').eq('association_code', code).eq('active', true).ilike('role', '%president%').order('sort_order', { ascending: true }).limit(1).maybeSingle(),
    supabaseAdmin.from('unit_tenant_contacts').select('occupants, lease_start, lease_end').eq('association_code', code).eq('unit_ref', app.unit_label ?? '').maybeSingle(),
  ])
  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || code
  const addr = [assoc?.principal_address, app.unit_label ? `Unit ${app.unit_label}` : null, [assoc?.city, [assoc?.state, assoc?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ')
  const occ = Array.isArray(tenant?.occupants) ? (tenant!.occupants as Array<{ name?: string } | string>).map(o => typeof o === 'string' ? o : o?.name).filter(Boolean) as string[] : []
  return { app, code, legal, propertyAddress: addr || null, applicant: (sh?.name as string | null) ?? null, president: pres ?? null, tenant, occupants: occ }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const c = await loadContext(id)
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    applicationType: c.app.application_type, propertyAddress: c.propertyAddress, applicant: c.applicant,
    president: c.president ? { name: c.president.name, email: c.president.email, hasSignature: !!c.president.signature_image } : null,
    leaseStart: c.tenant?.lease_start ?? null, leaseEnd: c.tenant?.lease_end ?? null,
    occupants: c.occupants, applicantAsOccupant: c.applicant,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let b: { email?: string; name?: string; decision?: string; conditions?: string; leaseStart?: string; leaseEnd?: string; occupants?: string[] }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const c = await loadContext(id)
  if (!c) return NextResponse.json({ error: 'Application not found' }, { status: 404 })

  // Signer defaults to the President; a supplied email overrides.
  const signerEmail = (b.email?.trim() || (c.president?.email as string | null) || '').trim()
  const signerName = b.name?.trim() || (c.president?.name as string | null) || null
  if (!signerEmail.includes('@')) return NextResponse.json({ error: 'No signer email — set the President in Board setup or enter one.' }, { status: 400 })
  const isPresident = !!c.president?.email && signerEmail.toLowerCase() === String(c.president.email).toLowerCase()
  const onFileSig = isPresident ? (c.president?.signature_image as string | null) : null

  const occupants = (b.occupants ?? []).map(o => String(o).trim()).filter(Boolean)
  const payload = {
    associationLegalName: c.legal, propertyAddress: c.propertyAddress, applicant: c.applicant,
    occupants: occupants.length ? occupants : (c.applicant ? [c.applicant] : []),
    unit: c.app.unit_label, applicationType: c.app.application_type,
    decision: b.decision?.trim() || 'Approved', conditions: b.conditions?.trim() || null,
    leaseStart: b.leaseStart || c.tenant?.lease_start || null, leaseEnd: b.leaseEnd || c.tenant?.lease_end || null,
  }

  const now = new Date().toISOString()
  // If the President has an on-file signature, sign immediately.
  const signer = onFileSig
    ? { role: 'approver', name: signerName, email: signerEmail, phone: null, signed_at: now, sig_name: signerName, sig_image: onFileSig, sig_ip: null, verification: { email: signerEmail, emailVerifiedAt: now } }
    : { role: 'approver', name: signerName, email: signerEmail, phone: null }

  const { data: created, error } = await supabaseAdmin.from('esign_documents').insert({
    kind: 'board_decision', association_code: c.code, unit_ref: c.app.unit_label,
    title: `Board Decision — ${c.propertyAddress ?? `Unit ${c.app.unit_label ?? ''}`}`.trim(),
    payload, signers: [signer], status: onFileSig ? 'completed' : 'sent', created_by: `staff:${session.displayName}`,
  }).select('id').single()
  if (error || !created) return NextResponse.json({ error: `Could not create: ${error?.message ?? 'unknown'}` }, { status: 500 })

  await supabaseAdmin.from('listing_applications').update({ review_note: onFileSig ? `Board Decision Page signed by ${signerName}` : `Board Decision Page sent to ${signerEmail}`, updated_at: now }).eq('id', id)

  if (onFileSig) return NextResponse.json({ ok: true, docId: created.id, signed: true, signedBy: signerName, pdfUrl: `${APP}/api/esign/${await signEsignToken(created.id, 'approver')}/pdf` })
  const link = `${APP}/esign/${await signEsignToken(created.id, 'approver')}`
  return NextResponse.json({ ok: true, docId: created.id, signed: false, link, signerEmail })
}
