// GET  /api/admin/pre-apply/[id]/rules-ack  → who would sign, and whether we can
// POST /api/admin/pre-apply/[id]/rules-ack  → create it + return a link per signer
//
// The Rules Knowledge Acknowledgment. EVERY adult on the roster signs their own
// block — the association's Rules require "a signed copy of the Rules and
// Regulations signed by all parties who will occupy", and the paper form it
// replaces carried four signature lines for exactly that reason. Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { signEsignToken } from '@/lib/esign-token'
import { rulesAckContentFor } from '@/lib/rules-ack-content'
import { hasRulesPdf } from '@/lib/rules-ack-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

interface Ctx {
  code: string; unit: string | null; type: string | null
  legal: string; address: string | null
  people: { id: string; name: string; email: string | null }[]
}

async function loadContext(id: string): Promise<Ctx | null> {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, application_type, unit_label').eq('id', id).maybeSingle()
  if (!app) return null
  const code = String(app.association_code)
  const [{ data: assoc }, { data: sh }] = await Promise.all([
    supabaseAdmin.from('associations').select('legal_name, association_name, principal_address, city, state, zip').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('id, name, email, applicant_role, is_primary')
      .eq('application_id', id).eq('role', 'applicant').order('is_primary', { ascending: false }).order('created_at', { ascending: true }),
  ])
  // Minors don't sign. Everyone else on the roster does.
  const people = ((sh ?? []) as { id: string; name: string | null; email: string | null; applicant_role: string | null }[])
    .filter(p => String(p.applicant_role ?? '') !== 'minor_dependent')
    .map(p => ({ id: String(p.id), name: String(p.name ?? '').trim(), email: (p.email as string | null) ?? null }))
    .filter(p => p.name)
  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || code
  const address = [assoc?.principal_address, app.unit_label ? `Unit ${app.unit_label}` : null,
    [assoc?.city, [assoc?.state, assoc?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') || null
  return { code, unit: (app.unit_label as string | null) ?? null, type: (app.application_type as string | null) ?? null, legal, address, people }
}

/** Why this application can't produce an acknowledgment yet, or null. */
async function blockers(c: Ctx): Promise<string[]> {
  const out: string[] = []
  if (!rulesAckContentFor(c.code)) out.push(`${c.code} has no Rules Knowledge content configured yet.`)
  if (!await hasRulesPdf(c.code)) out.push(`${c.code} has no Rules and Regulations PDF stored — the acknowledgment says the rules follow, so it must not be sent without them.`)
  if (c.people.length === 0) out.push('Nobody is on the applicant roster yet — add the applicants first.')
  const noEmail = c.people.filter(p => !p.email).map(p => p.name)
  if (noEmail.length) out.push(`No email for ${noEmail.join(', ')} — each signer needs one to receive their link.`)
  return out
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const c = await loadContext(id)
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data: open } = await supabaseAdmin.from('esign_documents')
    .select('id, status, signers, created_at').eq('kind', 'rules_knowledge_ack')
    .eq('association_code', c.code).eq('unit_ref', c.unit ?? '')
    .neq('status', 'void').order('created_at', { ascending: false }).limit(1).maybeSingle()

  return NextResponse.json({
    associationLegalName: c.legal, propertyAddress: c.address,
    signers: c.people.map(p => ({ name: p.name, email: p.email })),
    blockers: await blockers(c),
    existing: open ? { id: open.id, status: open.status, createdAt: open.created_at, signers: open.signers } : null,
  })
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const c = await loadContext(id)
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const stop = await blockers(c)
  if (stop.length) return NextResponse.json({ error: stop.join(' ') }, { status: 400 })

  const content = rulesAckContentFor(c.code)!
  const payload = {
    associationLegalName: c.legal, propertyAddress: c.address, unit: c.unit,
    applicationType: c.type, applicants: c.people.map(p => p.name),
    ...content,
  }
  // One role per person: applicant, applicant2, applicant3… so each signature
  // block belongs to a named human rather than a shared "the applicants" line.
  const signers = c.people.map((p, i) => ({
    role: i === 0 ? 'applicant' : `applicant${i + 1}`,
    name: p.name, email: p.email,
  }))

  const { data: created, error } = await supabaseAdmin.from('esign_documents').insert({
    kind: 'rules_knowledge_ack', association_code: c.code, unit_ref: c.unit,
    title: `Rules Knowledge Acknowledgment — ${c.address ?? `Unit ${c.unit ?? ''}`}`.trim(),
    payload, signers, status: 'sent', created_by: `staff:${session.displayName}`,
  }).select('id').single()
  if (error || !created) return NextResponse.json({ error: `Could not create: ${error?.message ?? 'unknown'}` }, { status: 500 })

  const links = await Promise.all(signers.map(async sg => ({
    name: sg.name, email: sg.email,
    link: `${APP}/esign/${await signEsignToken(String(created.id), sg.role)}`,
  })))
  return NextResponse.json({ ok: true, docId: created.id, signers: links })
}
