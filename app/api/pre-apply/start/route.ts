// POST /api/pre-apply/start
//   { code, type, role, unit, name, email, phone }
// Public: begins a Pre-Application Compliance intake for an association and
// returns a token the applicant uses to upload documents + submit. No account.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createIntake, isStakeholderRole, roleLabel } from '@/lib/preapply'
import { signPreApplyToken } from '@/lib/preapply-token'
import { isApplicationType } from '@/lib/intake-documents'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPPORT_EMAIL = 'support@topfloridaproperties.com'
const TYPE_WORD: Record<string, string> = { lease: 'rental', purchase: 'purchase', lease_renewal: 'lease-renewal', additional_occupant: 'additional-occupant' }
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

// When someone who is NOT the unit owner starts an application, email the unit
// owner so they know (and can flag it if they don't recognize it). Best-effort.
async function notifyUnitOwnerOfNewApplication(opts: { associationCode: string; unitLabel: string | null; type: string; leadName: string; leadRole: string }) {
  const unit = (opts.unitLabel ?? '').trim()
  if (!unit) return
  const [{ data: owners }, { data: a }] = await Promise.all([
    supabaseAdmin.from('owners').select('emails, status').eq('association_code', opts.associationCode).eq('unit_number', unit).or('status.neq.previous,status.is.null'),
    supabaseAdmin.from('associations').select('association_name, legal_name').eq('association_code', opts.associationCode).maybeSingle(),
  ])
  const emails = [...new Set((owners ?? []).flatMap(o => String(o.emails ?? '').split(',')).map(s => s.trim()).filter(e => e.includes('@')))]
  if (emails.length === 0) return
  const assocName = (a?.legal_name as string | null) || (a?.association_name as string | null) || opts.associationCode
  const word = TYPE_WORD[opts.type] ?? 'new'
  await sendEmail({
    to: emails,
    replyTo: SUPPORT_EMAIL,
    subject: `A new ${word} application was started for your unit — ${assocName} Unit ${unit}`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px;margin:0 auto">
      <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f26a1b;font-weight:700;margin:0 0 4px">PMI Top Florida Properties</p>
      <h2 style="margin:0 0 8px;color:#1f2a44">A new application was started for your unit</h2>
      <p>A new <strong>${esc(word)}</strong> application was just started for your unit — <strong>${esc(assocName)}, Unit ${esc(unit)}</strong> — by <strong>${esc(opts.leadName)}</strong> (${esc(roleLabel(opts.leadRole))}).</p>
      <p>If you started this, or you recognize it — for example your tenant, buyer, or agent is applying — <strong>no action is needed</strong>.</p>
      <p style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;color:#92400e">⚠ If you do <strong>not</strong> recognize this application, please reply to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> right away so we can look into it.</p>
      <p style="color:#9aa0ab;font-size:12px">PMI Top Florida Properties · Managing agent for ${esc(assocName)}</p>
    </div>`,
  })
}

export async function POST(req: Request) {
  let b: { code?: string; type?: string; role?: string; unit?: string; name?: string; email?: string; phone?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const code = String(b.code ?? '').trim().toUpperCase()
  const type = String(b.type ?? '').trim()
  const name = String(b.name ?? '').trim()
  const email = String(b.email ?? '').trim()
  const role = String(b.role ?? 'applicant').trim()
  if (!code || !isApplicationType(type)) return NextResponse.json({ error: 'code and a valid application type are required' }, { status: 400 })
  if (!isStakeholderRole(role)) return NextResponse.json({ error: 'Please choose who you are (tenant, owner, or agent).' }, { status: 400 })
  if (!name || !email.includes('@')) return NextResponse.json({ error: 'Please enter your name and a valid email.' }, { status: 400 })

  const { data: assoc } = await supabaseAdmin.from('associations').select('association_code, active').eq('association_code', code).maybeSingle()
  if (!assoc || assoc.active === false) return NextResponse.json({ error: 'This association is not accepting applications online.' }, { status: 404 })

  const created = await createIntake({
    associationCode: code, type, role,
    unitLabel: String(b.unit ?? '').trim() || null,
    applicant: { name, email, phone: String(b.phone ?? '').trim() || null },
  })
  if ('error' in created) return NextResponse.json({ error: created.error }, { status: 500 })

  // If a non-owner started this, let the unit owner know (best-effort — never
  // blocks the applicant). Owners starting their own application skip this.
  if (role !== 'owner') {
    void notifyUnitOwnerOfNewApplication({
      associationCode: code, unitLabel: String(b.unit ?? '').trim() || null, type, leadName: name, leadRole: role,
    }).catch(() => null)
  }

  const token = await signPreApplyToken(created.applicationId, created.stakeholderId)
  return NextResponse.json({ ok: true, token })
}
