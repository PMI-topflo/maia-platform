// GET /api/pre-apply/[token]
// The intake state + the per-type document checklist + which items are already
// uploaded, for the applicant's upload/submit page. Token is the auth.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyPreApplyToken } from '@/lib/preapply-token'
import { getIntake } from '@/lib/preapply'
import { getIntakeChecklist, PROVIDED_BY_LABEL } from '@/lib/intake-documents'
import { maskEmail } from '@/lib/esign-verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyPreApplyToken(token)
  if (!t) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const intake = await getIntake(t.applicationId)
  if (!intake) return NextResponse.json({ error: 'This application could not be found.' }, { status: 404 })

  const [checklist, { data: assoc }, { data: rules }] = await Promise.all([
    getIntakeChecklist(intake.associationCode, intake.type),
    supabaseAdmin.from('associations').select('association_name, legal_name').eq('association_code', intake.associationCode).maybeSingle(),
    supabaseAdmin.from('association_application_rules').select('rule_key, label').eq('association_code', intake.associationCode).eq('active', true),
  ])
  const uploaded = new Set(intake.docs.map(d => d.doc_key).filter(Boolean))

  return NextResponse.json({
    associationName: (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || intake.associationCode,
    type: intake.type,
    unitLabel: intake.unitLabel,
    applicantName: intake.applicant?.name ?? null,
    applicantEmailMasked: maskEmail(intake.applicant?.email ?? null),
    emailVerified: !!intake.emailVerifiedAt,
    status: intake.status,
    submitted: !!intake.submittedAt,
    providerLabels: PROVIDED_BY_LABEL,
    checklist: checklist.map(d => ({ ...d, uploaded: uploaded.has(d.doc_key) })),
    rules: (rules ?? []).map(r => ({ rule_key: r.rule_key as string, label: r.label as string })),
  })
}
