// POST /api/pre-apply/[token]/submit   { rulesName?, signatureImage? }
// Finishes THIS stakeholder's part of the intake:
//   • Applicants and owners sign the shown-&-signed rules acknowledgment
//     (rulesName required; signature optional). Agents don't sign.
//   • The stakeholder is marked complete.
// Then, if every REQUIRED checklist item (across all collaborators) is now
// uploaded, the whole application is submitted for audit (PMI + Jonathan) —
// the Drive mirror + notify fire exactly once, on that transition. This lets
// multiple people fill their parts in parallel without one person's submit
// locking the others out.

import { NextResponse } from 'next/server'
import { getIntake, resolveToken, roleSigns, signStakeholderRules, completeStakeholder, submitIntake } from '@/lib/preapply'
import { getIntakeChecklist } from '@/lib/intake-documents'
import { mirrorIntakeToDrive } from '@/lib/drive-application-mirror'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await resolveToken(token)
  if (!r) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const intake = await getIntake(r.applicationId)
  if (!intake) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const me = r.stakeholder

  let b: { rulesName?: string; signatureImage?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  // Applicants + owners sign; agents just finish.
  if (roleSigns(me.role)) {
    const rulesName = String(b.rulesName ?? '').trim()
    if (!rulesName) return NextResponse.json({ error: 'Please type your name to acknowledge the rules.' }, { status: 400 })
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const sig = (b.signatureImage && b.signatureImage.startsWith('data:image')) ? b.signatureImage : null
    await signStakeholderRules(me.id, { name: rulesName, signature: sig, ip })
  }
  await completeStakeholder(me.id)

  // Submit the whole application for audit once every required document is in.
  const checklist = await getIntakeChecklist(intake.associationCode, intake.type)
  const fresh = await getIntake(r.applicationId)               // re-read: this upload may have completed the set
  const uploaded = new Set(fresh?.docKeys ?? intake.docKeys)
  const missing = checklist.filter(d => d.required && !uploaded.has(d.doc_key)).map(d => d.label)

  let appSubmitted = !!intake.submittedAt
  if (missing.length === 0 && !intake.submittedAt) {
    const res = await submitIntake(r.applicationId)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 })
    appSubmitted = true
    if (res.transitioned) {
      const drive = await mirrorIntakeToDrive(r.applicationId)   // best-effort
      if (NOTIFY.length) {
        void sendEmail({
          to: NOTIFY,
          subject: `New application to audit — ${intake.associationCode} ${intake.unitLabel ? `Unit ${intake.unitLabel}` : ''} (${intake.type})`,
          html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
            <p><strong>${esc(intake.applicant?.name ?? 'An applicant')}</strong> submitted a <strong>${esc(intake.type)}</strong> application for <strong>${esc(intake.associationCode)}</strong>${intake.unitLabel ? ` Unit ${esc(intake.unitLabel)}` : ''}.</p>
            <p>${checklist.length} document(s) on the checklist · ${uploaded.size} uploaded.</p>
            ${drive.ok && drive.folderUrl ? `<p>📁 Documents filed in Drive: <a href="${drive.folderUrl}">On Going Applications → Unit ${esc(intake.unitLabel ?? '')}</a> (${drive.mirrored} file${drive.mirrored === 1 ? '' : 's'})</p>` : (drive.error ? `<p style="color:#b45309">⚠ Drive mirror pending: ${esc(drive.error)}</p>` : '')}
            <p><a href="${APP}/admin/pre-apply">Open the audit queue →</a></p>
          </div>`,
        }).catch(() => null)
      }
    }
  }

  return NextResponse.json({ ok: true, appSubmitted, youSigned: roleSigns(me.role), waitingOn: missing })
}
