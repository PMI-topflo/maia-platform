// GET  /api/sponsorship/[token] → what the tenant is being asked
// POST /api/sponsorship/[token] → their answer
//   { decision: 'requested'|'declined', occupantEmail?, occupantPhone?, acknowledged?, note? }
//
// Token auth: the approved tenant does not need an account to confirm somebody
// joining their own lease.
//
// On "requested" the occupant's contact details are written onto the
// application — which is the whole point. The email is REQUIRED and must
// differ from the tenant's; see lib/occupant-sponsorship.ts for why that is a
// server rule and not a form hint.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { checkOccupantEmail, SPONSOR_ACKNOWLEDGMENT, norm } from '@/lib/occupant-sponsorship'
import { normalizePhone } from '@/lib/cinc-sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const OFFICE = (process.env.BOARD_REVIEW_OFFICE_EMAILS
  ?? 'PMI@topfloridaproperties.com,jonathan@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(e => e.includes('@'))
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

async function load(token: string) {
  const { data } = await supabaseAdmin.from('occupant_sponsorships')
    .select('id, application_id, association_code, unit_label, tenant_name, tenant_email, occupant_name, responded_at, decision, occupant_email, occupant_phone, acknowledged')
    .eq('token', token).maybeSingle()
  return data ?? null
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const row = await load(token)
  if (!row) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })

  const { data: assoc } = await supabaseAdmin.from('associations')
    .select('legal_name, association_name').eq('association_code', String(row.association_code)).maybeSingle()

  return NextResponse.json({
    associationName: (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || row.association_code,
    unitLabel: row.unit_label,
    tenantName: row.tenant_name, tenantEmail: row.tenant_email,
    occupantName: row.occupant_name,
    acknowledgment: SPONSOR_ACKNOWLEDGMENT,
    answered: !!row.responded_at,
    decision: row.decision, occupantEmail: row.occupant_email, occupantPhone: row.occupant_phone,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const row = await load(token)
  if (!row) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  if (row.responded_at) return NextResponse.json({ error: 'You have already answered this. Contact the office to change it.' }, { status: 400 })

  let b: { decision?: unknown; occupantEmail?: unknown; occupantPhone?: unknown; acknowledged?: unknown; note?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const decision = b.decision === 'requested' || b.decision === 'declined' ? b.decision : null
  if (!decision) return NextResponse.json({ error: 'Tell us whether you are asking for this occupant to be added.' }, { status: 400 })

  const now = new Date().toISOString()

  if (decision === 'declined') {
    await supabaseAdmin.from('occupant_sponsorships').update({
      decision, responded_at: now, note: String(b.note ?? '').trim() || null, updated_at: now,
    }).eq('id', row.id)
    await notifyOffice(row, 'declined', null, String(b.note ?? '').trim() || null).catch(() => null)
    return NextResponse.json({ ok: true, decision })
  }

  if (b.acknowledged !== true) {
    return NextResponse.json({ error: 'Please tick the box to confirm you accept responsibility for this occupant.' }, { status: 400 })
  }

  const check = await checkOccupantEmail({
    applicationId: String(row.application_id),
    tenantEmail: String(row.tenant_email ?? ''),
    candidate: b.occupantEmail,
  })
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

  const phoneRaw = String(b.occupantPhone ?? '').trim()
  if (!phoneRaw) return NextResponse.json({ error: 'Please give the occupant’s phone number.' }, { status: 400 })
  const phone = normalizePhone(phoneRaw) ?? phoneRaw

  await supabaseAdmin.from('occupant_sponsorships').update({
    decision, responded_at: now, occupant_email: check.email, occupant_phone: phone,
    acknowledged: true, note: String(b.note ?? '').trim() || null, updated_at: now,
  }).eq('id', row.id)

  // Write the details onto the occupant so every later step — the affidavit,
  // the rules acknowledgment, the OTP — reaches the right person.
  const { data: people } = await supabaseAdmin.from('application_stakeholders')
    .select('id, name, email, is_primary').eq('application_id', String(row.application_id)).eq('role', 'applicant')
    .order('is_primary', { ascending: false })
  const target = (people ?? []).find(p => norm(p.name) === norm(row.occupant_name)) ?? (people ?? [])[0]
  if (target) {
    await supabaseAdmin.from('application_stakeholders')
      .update({ email: check.email, phone, updated_at: now }).eq('id', target.id)
  }

  await notifyOffice(row, 'requested', { email: check.email, phone }, String(b.note ?? '').trim() || null).catch(() => null)
  return NextResponse.json({ ok: true, decision, occupantEmail: check.email })
}

async function notifyOffice(
  row: { application_id: unknown; unit_label: unknown; tenant_name: unknown; occupant_name: unknown },
  decision: 'requested' | 'declined',
  contact: { email: string; phone: string } | null,
  note: string | null,
): Promise<void> {
  if (!OFFICE.length) return
  const unit = String(row.unit_label ?? '')
  await sendEmail({
    to: OFFICE,
    subject: `${row.tenant_name} ${decision === 'requested' ? 'confirmed' : 'declined'} an occupant — ${unit ? `Unit ${unit}` : ''}`.trim(),
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.55">
      <p><strong>${esc(String(row.tenant_name ?? 'The tenant'))}</strong> ${decision === 'requested' ? 'confirmed' : '<strong style="color:#b42318">declined</strong>'} adding <strong>${esc(String(row.occupant_name ?? ''))}</strong> as an occupant${unit ? ` of Unit ${esc(unit)}` : ''}.</p>
      ${contact ? `<p>Occupant's own contact details: <strong>${esc(contact.email)}</strong> · ${esc(contact.phone)}</p>` : ''}
      ${note ? `<div style="border-left:3px solid #c05a1c;background:#fff7ed;padding:10px 13px;margin:12px 0"><em>“${esc(note)}”</em></div>` : ''}
      <p style="margin-top:18px"><a href="${APP}/admin/pre-apply/${String(row.application_id)}" style="color:#f26a1b;font-weight:600;text-decoration:none">Open the application →</a></p>
      <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p></div>`,
  })
}
