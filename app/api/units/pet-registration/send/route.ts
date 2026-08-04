// POST /api/units/pet-registration/send   { account, assoc }
// Creates a Pet Registration e-sign document for a unit and emails the
// applicant (the tenant if leased, else the owner) their fill-and-sign link.
// The per-association pet limit + legal name are snapshotted onto the doc.
// Staff / board / manager with upload permission.

import { NextResponse } from 'next/server'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { signEsignToken } from '@/lib/esign-token'
import { PET_ACK } from '@/lib/esign-forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const firstEmail = (e: string | null) => (e ?? '').split(/[,;\s]+/).map(s => s.trim()).find(x => x.includes('@')) ?? null

export async function POST(req: Request) {
  let body: { account?: string; assoc?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const auth = await resolveUnitsAuth(body.assoc ?? null)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.canUpload) return NextResponse.json({ error: 'no permission' }, { status: 403 })
  const account = String(body.account ?? '').trim()
  if (!account) return NextResponse.json({ error: 'account required' }, { status: 400 })
  if (auth.managedUnits && !auth.managedUnits.includes(account)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const [{ data: owner }, { data: tenant }, { data: assoc }] = await Promise.all([
    supabaseAdmin.from('owners').select('first_name, last_name, entity_name, emails, phone, unit_number')
      .eq('association_code', auth.assoc).eq('account_number', account).or('status.neq.previous,status.is.null').maybeSingle(),
    supabaseAdmin.from('unit_tenant_contacts').select('tenant_name, tenant_email, tenant_phone')
      .eq('association_code', auth.assoc).eq('unit_ref', account).maybeSingle(),
    supabaseAdmin.from('associations').select('legal_name, association_name, pet_limit').eq('association_code', auth.assoc).maybeSingle(),
  ])

  // The applicant is the tenant when leased, else the owner.
  const applicantName = (tenant?.tenant_name as string | null)
    || (owner?.entity_name as string | null) || [owner?.first_name, owner?.last_name].filter(Boolean).join(' ').trim() || null
  const applicantEmail = firstEmail((tenant?.tenant_email as string | null) ?? null) || firstEmail((owner?.emails as string | null) ?? null)
  const applicantPhone = (tenant?.tenant_phone as string | null) || (owner?.phone as string | null) || null
  if (!applicantEmail) return NextResponse.json({ error: 'No email on file for the tenant or owner — add one first.' }, { status: 400 })

  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || auth.assoc
  const unitLabel = (owner?.unit_number as string | null) || account

  const { data: created, error } = await supabaseAdmin.from('esign_documents').insert({
    kind: 'pet_registration', association_code: auth.assoc, unit_ref: account,
    title: `Pet Registration — Unit ${unitLabel}`,
    payload: { associationLegalName: legal, petLimit: (assoc?.pet_limit as number | null) ?? 2, rulesAck: PET_ACK },
    signers: [{ role: 'applicant', name: applicantName, email: applicantEmail, phone: applicantPhone }],
    status: 'sent', compliance_item: 'unit.pet', created_by: `${auth.persona}`,
  }).select('id').single()
  if (error || !created) return NextResponse.json({ error: `Could not create: ${error?.message ?? 'unknown'}` }, { status: 500 })

  const link = `${APP}/esign/${await signEsignToken(created.id, 'applicant')}`
  try {
    await sendEmail({
      to: applicantEmail,
      subject: `Pet Registration — Unit ${unitLabel}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
        <p>Hello${applicantName ? ` ${esc(applicantName)}` : ''},</p>
        <p>${esc(legal)} asks that you register your pet(s) for <strong>Unit ${esc(unitLabel)}</strong>. Please fill in the short form and e-sign it — it only takes a minute.</p>
        <p style="margin:22px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">Register your pet &amp; e-sign →</a></p>
        <p style="color:#6b7280;font-size:12px">No account needed. This link is specific to you.</p>
        <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p></div>`,
    })
  } catch (e) {
    return NextResponse.json({ error: `Created but could not email: ${e instanceof Error ? e.message : 'error'}`, docId: created.id }, { status: 502 })
  }

  return NextResponse.json({ ok: true, docId: created.id, sentTo: applicantEmail })
}
