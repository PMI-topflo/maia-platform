// POST /api/pre-apply/start
//   { code, type, role, unit, name, email, phone }
// Public: begins a Pre-Application Compliance intake for an association and
// returns a token the applicant uses to upload documents + submit. No account.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createIntake, carryOverApprovedDocs, addStakeholders, isStakeholderRole, roleLabel } from '@/lib/preapply'
import { signPreApplyToken } from '@/lib/preapply-token'
import { isApplicationType } from '@/lib/intake-documents'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const SUPPORT_EMAIL = 'support@topfloridaproperties.com'
const NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)
const TYPE_WORD: Record<string, string> = { lease: 'rental', purchase: 'purchase', lease_renewal: 'lease-renewal', additional_occupant: 'additional-occupant' }
// additional_occupant is deliberately excluded from the duplicate-unit check
// below — it's expected to open alongside an existing approved lease/purchase,
// not a rival application for the same occupancy.
const PRIMARY_TYPES = ['lease', 'lease_renewal', 'purchase']
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

// When someone who is NOT the unit owner starts an application, add the owner
// as a real stakeholder (so they get their own secure link, the same way any
// other collaborator does) and email them — both the FYI and, now, a way to
// actually act: fill in their own part and add their own agent if they have
// one. Previously this was FYI-only with no link at all — the owner had no
// way to answer "do you have an agent?" short of calling the office.
// User direction, 2026-08-20 (Rule 2): "send to the owner also to fill if he
// has an agent." Best-effort; never blocks the applicant.
async function notifyUnitOwnerOfNewApplication(opts: { applicationId: string; associationCode: string; unitLabel: string | null; type: string; leadName: string; leadRole: string }) {
  const unit = (opts.unitLabel ?? '').trim()
  if (!unit) return
  const [{ data: owners }, { data: a }] = await Promise.all([
    supabaseAdmin.from('owners').select('first_name, last_name, entity_name, emails, status').eq('association_code', opts.associationCode).eq('unit_number', unit).or('status.neq.previous,status.is.null'),
    supabaseAdmin.from('associations').select('association_name, legal_name').eq('association_code', opts.associationCode).maybeSingle(),
  ])
  const emails = [...new Set((owners ?? []).flatMap(o => String(o.emails ?? '').split(',')).map(s => s.trim().toLowerCase()).filter(e => e.includes('@')))]
  if (emails.length === 0) return
  const assocName = (a?.legal_name as string | null) || (a?.association_name as string | null) || opts.associationCode
  const word = TYPE_WORD[opts.type] ?? 'new'
  const ownerName = (owners ?? [])
    .map(o => (o.entity_name as string | null)?.trim() || `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim())
    .find(Boolean) || 'Owner'

  // One stakeholder row (the first owner email) gets the actionable link — the
  // same email-verification/OTP flow every other collaborator uses. Any
  // additional co-owner emails on file are BCC'd on the same notice, matching
  // how this office already treats co-owned units elsewhere.
  const [primaryEmail, ...ccEmails] = emails
  let link: string | null = null
  const created = await addStakeholders(opts.applicationId, [{ name: ownerName, email: primaryEmail, role: 'owner' }], opts.leadRole)
  if (created[0]) {
    const t = await signPreApplyToken(opts.applicationId, created[0].id)
    link = `${APP}/pre-apply/${encodeURIComponent(opts.associationCode)}?t=${encodeURIComponent(t)}`
  }

  await sendEmail({
    to: [primaryEmail], cc: ccEmails.length ? ccEmails : undefined,
    replyTo: SUPPORT_EMAIL,
    subject: `A new ${word} application was started for your unit — ${assocName} Unit ${unit}`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px;margin:0 auto">
      <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f26a1b;font-weight:700;margin:0 0 4px">PMI Top Florida Properties</p>
      <h2 style="margin:0 0 8px;color:#1f2a44">A new application was started for your unit</h2>
      <p>A new <strong>${esc(word)}</strong> application was just started for your unit — <strong>${esc(assocName)}, Unit ${esc(unit)}</strong> — by <strong>${esc(opts.leadName)}</strong> (${esc(roleLabel(opts.leadRole))}).</p>
      ${link ? `<p>If you have your own agent handling this, or anything of your own to upload, you can add them or fill your part here:</p>
      <p style="text-align:center;margin:20px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px;display:inline-block">Open my part of the application →</a></p>` : ''}
      <p>If you started this, or you recognize it — for example your tenant, buyer, or agent is applying — no other action is needed.</p>
      <p style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;color:#92400e">⚠ If you do <strong>not</strong> recognize this application, please reply to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> right away so we can look into it.</p>
      <p style="color:#9aa0ab;font-size:12px">PMI Top Florida Properties · Managing agent for ${esc(assocName)}</p>
    </div>`,
  })
}

// Real incident, MANXI Unit 802, 2026-08-29: a tenant and the unit's owner
// each independently started their OWN separate lease_renewal application for
// the same unit (the same-email "resume" check above only catches the SAME
// person reopening the link — a genuinely different person on the same unit
// still fell through to createIntake() and got a second, parallel
// application). One real lease_renewal ended up needing 3 documents manually
// moved off the other application and its stakeholder re-added by hand.
//
// "Never let open 2 applications" (user direction, 2026-08-30): before
// creating anything, check whether the unit already has one of the three
// primary-occupancy types in flight. If it does, the second person joins
// that SAME application as a collaborator instead of spawning a new one —
// they already self-identified their role on the initial persona card, so
// no extra step is needed. The one exception is a self-identified OWNER
// whose email does NOT match a real owners.emails record for the unit: that
// claim can't be verified the way every other role's self-identification
// can just be trusted, and a false owner claim carries real financial/legal
// stakes, so it stays blocked and routed to staff instead of auto-joining.
async function findOpenUnitApplication(associationCode: string, unitLabel: string, type: string) {
  if (!PRIMARY_TYPES.includes(type)) return null
  const { data } = await supabaseAdmin.from('listing_applications')
    .select('id, application_type, created_at')
    .eq('association_code', associationCode).eq('unit_label', unitLabel)
    .in('application_type', PRIMARY_TYPES)
    .not('status', 'in', '("approved","declined","withdrawn")')
    .order('created_at', { ascending: true }).limit(1)
  const existing = (data ?? [])[0]
  if (!existing) return null
  const { data: lead } = await supabaseAdmin.from('application_stakeholders')
    .select('name, email, role').eq('application_id', existing.id).eq('is_primary', true).maybeSingle()
  return {
    applicationId: String(existing.id), applicationType: String(existing.application_type),
    leadName: (lead?.name as string | null) ?? 'someone', leadRole: (lead?.role as string | null) ?? 'applicant',
    leadEmail: (lead?.email as string | null) ?? null,
  }
}

const phoneDigits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')

/** True if this email OR phone genuinely belongs to a real owner on file for
 *  the unit — the same email match notifyUnitOwnerOfNewApplication already
 *  trusts, widened to phone too (owners.phone, same field the lease-packet
 *  contact flow already reads) so a real owner with a stale email on file
 *  but an unchanged phone number still verifies instead of getting blocked.
 *  A 2FA/OTP send here would only prove control of whatever email or phone
 *  the person typed — it can't establish that value belongs to the unit's
 *  real owner, which is exactly the fact this function exists to check. */
async function isVerifiedOwner(associationCode: string, unitLabel: string, email: string, phone: string | null): Promise<boolean> {
  const { data: owners } = await supabaseAdmin.from('owners')
    .select('emails, phone, status').eq('association_code', associationCode).eq('unit_number', unitLabel)
    .or('status.neq.previous,status.is.null')
  const targetEmail = email.trim().toLowerCase()
  const targetPhone = phoneDigits(phone)
  return (owners ?? []).some(o =>
    String(o.emails ?? '').split(',').map(s => s.trim().toLowerCase()).includes(targetEmail)
    || (targetPhone.length >= 10 && phoneDigits(o.phone as string | null) === targetPhone))
}

async function notifyStaffOfBlockedDuplicate(opts: { associationCode: string; unitLabel: string; existingApplicationId: string; existingLeadName: string; existingLeadRole: string; newName: string; newEmail: string; newPhone: string | null; newRole: string }) {
  if (!NOTIFY.length) return
  await sendEmail({
    to: NOTIFY,
    subject: `⚠ Unverified owner claim for ${opts.associationCode} Unit ${opts.unitLabel} — needs manual review`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6">
      <p><strong>${esc(opts.newName)}</strong> (${esc(opts.newEmail)}${opts.newPhone ? ` · ${esc(opts.newPhone)}` : ''}) tried to start a new application claiming to be the OWNER of
      <strong>${esc(opts.associationCode)}, Unit ${esc(opts.unitLabel)}</strong> — but their email doesn't match any owner on file, and an application is already in progress there, started by <strong>${esc(opts.existingLeadName)}</strong> (${esc(roleLabel(opts.existingLeadRole))}).</p>
      <p>MAIA did not create a second application or add them automatically, since ownership couldn't be verified. Review and add them by hand if this checks out:</p>
      <p><a href="${APP}/admin/pre-apply/${opts.existingApplicationId}">Open the existing application →</a></p>
    </div>`,
  }).catch(() => null)
}

/** FYI, not action-needed — a second person joined an already-open
 *  application automatically instead of spawning a duplicate. Staff (and,
 *  best-effort, the existing lead) see it happened and can separate them if
 *  it turns out to be a genuine mix-up (e.g. two unrelated people both
 *  trying to apply for the same unit) rather than a real co-applicant. */
async function notifyOfAutoJoin(opts: { associationCode: string; unitLabel: string; existingApplicationId: string; existingLeadName: string; existingLeadEmail: string | null; existingLeadRole: string; newName: string; newEmail: string; newRole: string }) {
  const recipients = [...NOTIFY]
  if (opts.existingLeadEmail) recipients.push(opts.existingLeadEmail)
  if (!recipients.length) return
  await sendEmail({
    to: recipients,
    subject: `${opts.newName} joined the ${opts.associationCode} Unit ${opts.unitLabel} application`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6">
      <p><strong>${esc(opts.newName)}</strong> (${esc(roleLabel(opts.newRole))}, ${esc(opts.newEmail)}) identified themselves and joined the application already in progress for
      <strong>${esc(opts.associationCode)}, Unit ${esc(opts.unitLabel)}</strong> — started by <strong>${esc(opts.existingLeadName)}</strong> (${esc(roleLabel(opts.existingLeadRole))}).</p>
      <p>If this doesn't look right — for example, two unrelated people both trying to apply for the same unit — separate them here:</p>
      <p><a href="${APP}/admin/pre-apply/${opts.existingApplicationId}">Open the application →</a></p>
    </div>`,
  }).catch(() => null)
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

  const unitLabel = String(b.unit ?? '').trim() || null

  // RESUME instead of duplicating. The link is per-unit and gets opened more
  // than once (a second session, a re-read of the email, an abandoned first
  // try), and every open used to mint a NEW application — MANXI 1002 and 613
  // each ended up with two, one empty. If this same person already has an
  // unsubmitted application for this unit, hand them back their existing one
  // so their documents stay together.
  if (unitLabel) {
    const { data: openApps } = await supabaseAdmin.from('listing_applications')
      .select('id').eq('association_code', code).eq('unit_label', unitLabel).eq('status', 'started')
      .order('created_at', { ascending: false }).limit(20)
    for (const a of openApps ?? []) {
      const { data: me } = await supabaseAdmin.from('application_stakeholders')
        .select('id').eq('application_id', a.id).ilike('email', email).maybeSingle()
      if (me) {
        const resumed = await signPreApplyToken(String(a.id), String(me.id))
        return NextResponse.json({ ok: true, token: resumed, resumed: true })
      }
    }
  }

  // A genuinely DIFFERENT person on the same unit — never silently spawn a
  // second application (see the block comment above findOpenUnitApplication).
  if (unitLabel) {
    const openUnitApp = await findOpenUnitApplication(code, unitLabel, type)
    if (openUnitApp) {
      const unverifiedOwnerClaim = role === 'owner' && !(await isVerifiedOwner(code, unitLabel, email, String(b.phone ?? '').trim() || null))
      if (!unverifiedOwnerClaim) {
        const joined = await addStakeholders(openUnitApp.applicationId, [{ name, email, phone: String(b.phone ?? '').trim() || null, role }], 'self')
        if (joined[0]) {
          const token = await signPreApplyToken(openUnitApp.applicationId, joined[0].id)
          void notifyOfAutoJoin({
            associationCode: code, unitLabel, existingApplicationId: openUnitApp.applicationId,
            existingLeadName: openUnitApp.leadName, existingLeadEmail: openUnitApp.leadEmail, existingLeadRole: openUnitApp.leadRole,
            newName: name, newEmail: email, newRole: role,
          }).catch(() => null)
          return NextResponse.json({ ok: true, token, resumed: true })
        }
        // Already a stakeholder somehow (race) — fall through to the block
        // message rather than error, safer than guessing which row is theirs.
      }
      await notifyStaffOfBlockedDuplicate({
        associationCode: code, unitLabel, existingApplicationId: openUnitApp.applicationId,
        existingLeadName: openUnitApp.leadName, existingLeadRole: openUnitApp.leadRole,
        newName: name, newEmail: email, newPhone: String(b.phone ?? '').trim() || null, newRole: role,
      })
      return NextResponse.json({
        error: `An application for this unit is already in progress — started by ${openUnitApp.leadName} (${roleLabel(openUnitApp.leadRole)}). We've notified our team so they can add you to it; you'll hear from us shortly. If this is urgent, contact ${SUPPORT_EMAIL}.`,
      }, { status: 409 })
    }
  }

  const created = await createIntake({
    associationCode: code, type, role,
    unitLabel,
    applicant: { name, email, phone: String(b.phone ?? '').trim() || null },
  })
  if ('error' in created) return NextResponse.json({ error: created.error }, { status: 500 })

  // Additional-occupant on an already-approved unit: carry the approved lease's
  // files (lease, Certificate of Use, HO-6, governing-docs ack, …) into this new
  // application so the occupant only adds their own items. Best-effort.
  if (type === 'additional_occupant') {
    void carryOverApprovedDocs(created.applicationId, code, String(b.unit ?? '').trim() || null).catch(() => null)
  }

  // If a non-owner started this, let the unit owner know (best-effort — never
  // blocks the applicant). Owners starting their own application skip this.
  if (role !== 'owner') {
    void notifyUnitOwnerOfNewApplication({
      applicationId: created.applicationId, associationCode: code, unitLabel: String(b.unit ?? '').trim() || null, type, leadName: name, leadRole: role,
    }).catch(() => null)
  }

  const token = await signPreApplyToken(created.applicationId, created.stakeholderId)
  return NextResponse.json({ ok: true, token })
}
