// GET  /api/admin/pre-apply/[id]/pet-registration → who'd receive it, blockers, existing
// POST /api/admin/pre-apply/[id]/pet-registration → create + email the applicant
//
// The pet item is OPTIONAL on the checklist — it only applies if the household
// has an animal — so this is staff-triggered rather than part of the required
// set. The applicant fills in the pets themselves (the form is fillable) and
// e-signs; on completion it files onto the application with its own renewal
// expiry. Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { signEsignToken } from '@/lib/esign-token'
import { sendEmail } from '@/lib/gmail'
import { PET_ACK } from '@/lib/esign-forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

async function loadContext(id: string) {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label').eq('id', id).maybeSingle()
  if (!app) return null
  const code = String(app.association_code)
  const [{ data: assoc }, { data: sh }] = await Promise.all([
    supabaseAdmin.from('associations').select('legal_name, association_name, pet_limit').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('name, email, phone, is_primary')
      .eq('application_id', id).eq('role', 'applicant').order('is_primary', { ascending: false }).order('created_at', { ascending: true }),
  ])
  const primary = (sh ?? [])[0] as { name: string | null; email: string | null; phone: string | null } | undefined
  return {
    code, unit: (app.unit_label as string | null) ?? null,
    legal: (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || code,
    petLimit: (assoc?.pet_limit as number | null) ?? 2,
    name: (primary?.name ?? null), email: (primary?.email ?? null), phone: (primary?.phone ?? null),
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const c = await loadContext(id)
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data: open } = await supabaseAdmin.from('esign_documents')
    .select('id, status, signers, created_at').eq('kind', 'pet_registration')
    .eq('association_code', c.code).eq('unit_ref', c.unit ?? '')
    .neq('status', 'void').order('created_at', { ascending: false }).limit(1).maybeSingle()

  const blockers: string[] = []
  if (!c.name) blockers.push('Nobody is on the applicant roster yet.')
  else if (!c.email) blockers.push(`No email for ${c.name} — they need one to receive the form.`)

  return NextResponse.json({
    recipient: c.name ? { name: c.name, email: c.email } : null,
    petLimit: c.petLimit, blockers,
    existing: open ? { id: open.id, status: open.status, createdAt: open.created_at, signers: open.signers } : null,
  })
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const c = await loadContext(id)
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!c.email) return NextResponse.json({ error: `No email on file for ${c.name ?? 'the applicant'} — add one first.` }, { status: 400 })

  const unitLabel = c.unit ?? '—'
  const { data: created, error } = await supabaseAdmin.from('esign_documents').insert({
    kind: 'pet_registration', association_code: c.code, unit_ref: c.unit,
    // Neutral until the applicant picks a branch; the rendered PDF titles
    // itself from the answers (documentTitleFor / renderPetPdf).
    title: `Animal Information — Unit ${unitLabel}`,
    payload: { associationLegalName: c.legal, petLimit: c.petLimit, rulesAck: PET_ACK },
    signers: [{ role: 'applicant', name: c.name, email: c.email, phone: c.phone }],
    status: 'sent', compliance_item: 'unit.pet', created_by: `staff:${session.displayName}`,
  }).select('id').single()
  if (error || !created) return NextResponse.json({ error: `Could not create: ${error?.message ?? 'unknown'}` }, { status: 500 })

  const link = `${APP}/esign/${await signEsignToken(String(created.id), 'applicant')}`
  try {
    await sendEmail({
      to: c.email,
      subject: `Animal information — Unit ${unitLabel}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
        <p>Hello${c.name ? ` ${esc(c.name)}` : ''},</p>
        <p>${esc(c.legal)} asks for information about any animal that will live at <strong>Unit ${esc(unitLabel)}</strong> as part of your application. Fill in the short form and e-sign it — it takes a minute.</p>
        <p>If your animal is a <strong>service animal</strong> or an <strong>emotional support / assistance animal</strong>, say so on the form. Those are not pets: no pet fee, deposit, or breed or size restriction applies, and you will never be asked for a diagnosis or medical records.</p>
        <p style="margin:22px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">Complete the animal form &amp; e-sign →</a></p>
        <p style="color:#6b7280;font-size:12px">If no animal will live in the unit, tell us and we'll mark this item as not applicable. No account needed; this link is specific to you.</p>
        <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p></div>`,
    })
  } catch (e) {
    return NextResponse.json({ error: `Created but could not email: ${e instanceof Error ? e.message : 'error'}`, docId: created.id, link }, { status: 502 })
  }
  return NextResponse.json({ ok: true, docId: created.id, sentTo: c.email, link })
}
