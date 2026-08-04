// POST /api/pre-apply/[token]/submit   { rulesName, signatureImage }
// Finalizes the intake: every REQUIRED checklist item must be uploaded, the
// shown-&-signed rules acknowledgment is captured, and the application is
// marked submitted so it enters the staff audit queue (PMI + Jonathan). Token
// auth. NOTE: the rules acknowledgment here is the applicant's read-&-agree;
// the formal Board Decision Page is e-signed later in the audit/approval stage.

import { NextResponse } from 'next/server'
import { verifyPreApplyToken } from '@/lib/preapply-token'
import { getIntake, submitIntake } from '@/lib/preapply'
import { getIntakeChecklist } from '@/lib/intake-documents'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyPreApplyToken(token)
  if (!t) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const intake = await getIntake(t.applicationId)
  if (!intake) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (intake.submittedAt) return NextResponse.json({ error: 'This application has already been submitted.' }, { status: 400 })

  let b: { rulesName?: string; signatureImage?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const rulesName = String(b.rulesName ?? '').trim()
  if (!rulesName) return NextResponse.json({ error: 'Please type your name to acknowledge the rules.' }, { status: 400 })

  // Every REQUIRED checklist item must be uploaded.
  const checklist = await getIntakeChecklist(intake.associationCode, intake.type)
  const uploaded = new Set(intake.docs.map(d => d.doc_key).filter(Boolean))
  const missing = checklist.filter(d => d.required && !uploaded.has(d.doc_key)).map(d => d.label)
  if (missing.length) return NextResponse.json({ error: `Please upload: ${missing.join(', ')}` }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const sig = (b.signatureImage && b.signatureImage.startsWith('data:image')) ? b.signatureImage : null
  const res = await submitIntake(t.applicationId, { name: rulesName, signature: sig, ip })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 })

  if (NOTIFY.length) {
    void sendEmail({
      to: NOTIFY,
      subject: `New application to audit — ${intake.associationCode} ${intake.unitLabel ? `Unit ${intake.unitLabel}` : ''} (${intake.type})`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
        <p><strong>${esc(intake.applicant?.name ?? 'An applicant')}</strong> submitted a <strong>${esc(intake.type)}</strong> application for <strong>${esc(intake.associationCode)}</strong>${intake.unitLabel ? ` Unit ${esc(intake.unitLabel)}` : ''}.</p>
        <p>${checklist.length} document(s) on the checklist · ${uploaded.size} uploaded.</p>
        <p><a href="${APP}/admin/pre-apply">Open the audit queue →</a></p>
      </div>`,
    }).catch(() => null)
  }

  return NextResponse.json({ ok: true })
}
