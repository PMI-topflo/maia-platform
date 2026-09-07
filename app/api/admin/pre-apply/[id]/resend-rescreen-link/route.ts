// POST /api/admin/pre-apply/[id]/resend-rescreen-link
//
// Staff-only manual trigger for the $150 re-screening payment link —
// today it only ever goes out from the daily screening-expiry-warnings
// cron (app/api/cron/screening-expiry-warnings/route.ts) the moment a
// screening actually expires. User report, 2026-09-07: "the applicant
// didn't show the last documents... we reactivate asking only to pay
// again and run the background check" — staff has no way to send that
// link themselves without waiting for the next cron run. Reuses the
// exact same email template and one-time-token table as the cron so a
// manually-sent link behaves identically to an automatic one; reuses an
// existing unpaid token for this application instead of minting a new
// one every click.

import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { getReviewState } from '@/lib/board-review'
import { expiredHtml } from '@/app/api/cron/screening-expiry-warnings/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const [{ data: app }, state] = await Promise.all([
    supabaseAdmin.from('listing_applications').select('association_code, unit_label').eq('id', id).maybeSingle(),
    getReviewState(id),
  ])
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })
  // Only sendable while the screening is genuinely expired -- the email's
  // legal framing states outright that "your prior screening expired 45+
  // days ago," so this can't be used to send it early.
  if (!state?.screeningExpired) return NextResponse.json({ error: 'The screening for this application has not expired.' }, { status: 400 })

  const [{ data: primary }, { data: assoc }] = await Promise.all([
    supabaseAdmin.from('application_stakeholders').select('name, email')
      .eq('application_id', id).eq('role', 'applicant').eq('is_primary', true).maybeSingle(),
    supabaseAdmin.from('associations').select('association_name').eq('association_code', String(app.association_code)).maybeSingle(),
  ])
  const email = (primary?.email as string | null)?.trim()
  if (!email) return NextResponse.json({ error: 'No email on file for the primary applicant.' }, { status: 400 })

  // Reuse an existing unpaid link rather than minting a new one every time
  // staff clicks this -- an applicant who already has the email just gets
  // the same working link again, not a second one that quietly orphans the
  // first.
  const { data: existing } = await supabaseAdmin.from('rescreening_payments')
    .select('token').eq('listing_application_id', id).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  let token = existing?.token as string | undefined
  if (!token) {
    token = randomBytes(24).toString('hex')
    const { error: insErr } = await supabaseAdmin.from('rescreening_payments')
      .insert({ listing_application_id: id, token })
    if (insErr) return NextResponse.json({ error: `Could not create the payment link: ${insErr.message}` }, { status: 500 })
  }

  const unit = (app.unit_label as string | null) ?? '—'
  const assocName = (assoc?.association_name as string | null) ?? String(app.association_code)
  const name = (primary?.name as string | null) ?? ''

  try {
    await sendEmail({
      to: email, subject: `Action needed: your background screening has expired — Unit ${unit}, ${assocName}`,
      html: expiredHtml({ name, unit, assoc: assocName, link: `${APP}/rescreen/${token}` }),
    })
  } catch (e) {
    return NextResponse.json({ error: `Could not send: ${(e as Error).message}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true, to: email })
}
