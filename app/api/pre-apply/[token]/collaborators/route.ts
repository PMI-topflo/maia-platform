// GET/POST /api/pre-apply/[token]/collaborators
// The lead (primary stakeholder) adds everyone else involved in the application
// — co-applicants, the owner, the listing/tenant agent — and MAIA emails each
// of them their own secure link so they fill their part in parallel. Only the
// lead may add collaborators. Token auth.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getIntake, resolveToken, addStakeholders, listStakeholders, markStakeholderNotified, roleLabel, isStakeholderRole, type StakeholderRole } from '@/lib/preapply'
import { signPreApplyToken } from '@/lib/preapply-token'
import { maskEmail, maskPhone } from '@/lib/esign-verify'
import { sendEmail } from '@/lib/gmail'
import { sendSMS } from '@/lib/twilio-send'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await resolveToken(token)
  if (!r) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const rows = await listStakeholders(r.applicationId)
  return NextResponse.json({
    collaborators: rows.map(s => ({ id: s.id, name: s.name, email: s.email ? maskEmail(s.email) : maskPhone(s.phone), role: s.role, roleLabel: roleLabel(s.role), isPrimary: s.isPrimary, status: s.status, signs: s.signs })),
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await resolveToken(token)
  if (!r) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  // The lead always can; so can the owner — they need a way to add their own
  // agent even though they didn't start the application.
  if (!r.stakeholder.isPrimary && r.stakeholder.role !== 'owner') {
    return NextResponse.json({ error: 'Only the person who started the application, or the owner, can add collaborators.' }, { status: 403 })
  }

  const intake = await getIntake(r.applicationId)
  if (!intake) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  let b: { collaborators?: { name?: string; email?: string; phone?: string; role?: string }[] }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const raw = Array.isArray(b.collaborators) ? b.collaborators : []
  const parsed = raw
    .map(p => ({ name: String(p.name ?? '').trim(), email: String(p.email ?? '').trim(), phone: String(p.phone ?? '').trim() || null, role: String(p.role ?? '').trim() }))
    .filter(p => p.name && isStakeholderRole(p.role))
  // A collaborator added as role='applicant' (a co-applicant) gets their own
  // real Checkr background check, and Checkr only ever delivers its consent
  // link by email -- there's no SMS/WhatsApp option on Checkr's side, so
  // phone-only would leave them with no way to ever consent. Reject those
  // explicitly (by name) rather than silently dropping them -- a real gap
  // found elsewhere in this pipeline (components/ApplicationForm.tsx's
  // adult-occupant filter used to just exclude anyone with no email, with no
  // error telling the lead why). Owner/agent are never screened, so email OR
  // phone is fine for them (the "no tech" case, user direction 2026-09-03).
  const missingEmail = parsed.filter(p => p.role === 'applicant' && !p.email.includes('@')).map(p => p.name)
  if (missingEmail.length) {
    return NextResponse.json({ error: `A valid email is required for ${missingEmail.join(', ')} — they'll be background-checked, and the consent link can only be sent by email. Use someone else's email (like an agent's) if they don't have their own.` }, { status: 400 })
  }
  const people = parsed
    .filter(p => p.email.includes('@') || p.phone)
    .map(p => ({ ...p, role: p.role as StakeholderRole }))
  if (people.length === 0) return NextResponse.json({ error: 'Add at least one person with a name, an email or phone, and a role.' }, { status: 400 })

  const created = await addStakeholders(r.applicationId, people, r.stakeholder.role)

  // Email each new collaborator their own link.
  const { data: assoc } = await supabaseAdmin.from('associations').select('association_name, legal_name').eq('association_code', intake.associationCode).maybeSingle()
  const assocName = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || intake.associationCode
  const leadName = r.stakeholder.name || 'The applicant'

  await Promise.all(created.map(async s => {
    if (!s.email && !s.phone) return
    const t = await signPreApplyToken(r.applicationId, s.id)
    const link = `${APP}/pre-apply/${encodeURIComponent(intake.associationCode)}?t=${encodeURIComponent(t)}`
    const signs = s.signs
    try {
      if (s.email) {
        await sendEmail({
          to: s.email,
          subject: `Action needed: your part of the ${assocName} application`,
          html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px;margin:0 auto">
            <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f26a1b;font-weight:700;margin:0 0 4px">PMI Top Florida Properties</p>
            <h2 style="margin:0 0 8px;color:#1f2a44">You've been added to an application</h2>
            <p><strong>${esc(leadName)}</strong> is completing a <strong>${esc(intake.type.replace(/_/g, ' '))}</strong> application for <strong>${esc(assocName)}</strong>${intake.unitLabel ? ` (Unit ${esc(intake.unitLabel)})` : ''} and added you as the <strong>${esc(roleLabel(s.role))}</strong>.</p>
            <p>Open your secure link to verify your email, upload your documents${signs ? ', and sign the association acknowledgment' : ''}. Everyone fills their part in parallel, so this only takes a few minutes.</p>
            <p style="text-align:center;margin:22px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px;display:inline-block">Open my part of the application →</a></p>
            <p style="color:#9ca3af;font-size:12px">If the button doesn't work, copy this link:<br>${link}</p>
          </div>`,
        })
      } else if (s.phone) {
        // No email on file -- text the link instead. Freeform WhatsApp needs
        // the recipient to have messaged us first (business-initiated
        // messages are otherwise rejected), and there's no pre-approved
        // "here's your link" WhatsApp template yet, so SMS is the reliable
        // choice for a first-contact invite (OTP codes still prefer
        // WhatsApp, see send-otp -- that uses an approved template).
        await sendSMS(s.phone, `${leadName} added you (${roleLabel(s.role)}) to a ${assocName} application. Open your part: ${link}`)
      }
      await markStakeholderNotified(s.id)
    } catch { /* one failed invite shouldn't fail the batch */ }
  }))

  return NextResponse.json({
    ok: true,
    added: created.map(s => ({ id: s.id, name: s.name, email: maskEmail(s.email), role: s.role, roleLabel: roleLabel(s.role) })),
  })
}
