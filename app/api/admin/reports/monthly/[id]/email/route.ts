// =====================================================================
// POST /api/admin/reports/monthly/[id]/email
//
// Staff send a published monthly report to an audience:
//   - audience='board'  → every active board member of the association
//   - audience='owners' → every owner of the association with an email
//
// Each recipient gets a personalized email with two CTAs — a link to
// the full report (/report/[id]) and a tokenized "rate this report"
// link (/report-feedback/[token]). A report_feedback row is created
// (or reused) per recipient so their rating + feedback flows back to
// staff. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import {
  gatherMonthlyReportData,
  type ReportAudience,
} from '@/lib/monthly-report'
import {
  findReportRecipients,
  prepareReportSend,
  type FeedbackAudience,
} from '@/lib/report-feedback'
import { buildReportEmail } from '@/lib/report-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

interface ReportRow {
  id:                 string
  association_code:   string
  month:              string
  report_markdown:    string
  published_at:       string | null
  published_audience: ReportAudience | null
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params

  let body: { audience?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const audience = body.audience
  if (audience !== 'board' && audience !== 'owners') {
    return NextResponse.json({ error: 'audience must be "board" or "owners"' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('monthly_reports')
    .select('id, association_code, month, report_markdown, published_at, published_audience')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }
  const report = data as ReportRow

  if (report.association_code === 'ALL') {
    return NextResponse.json(
      { error: 'Per-association reports only — generate this report for a single association first.' },
      { status: 400 },
    )
  }
  if (!report.published_at || !report.published_audience) {
    return NextResponse.json(
      { error: 'Publish the report before sending it.' },
      { status: 400 },
    )
  }

  // The send audience must be part of the publish audience — otherwise
  // recipients clicking "Read the full report" would hit a 404.
  const compatible =
    report.published_audience === 'both' ||
    (audience === 'board'  && report.published_audience === 'board') ||
    (audience === 'owners' && report.published_audience === 'owners')
  if (!compatible) {
    return NextResponse.json(
      { error: `This report is published to "${report.published_audience}". Re-publish to include ${audience} before sending.` },
      { status: 400 },
    )
  }

  const recipients = await findReportRecipients(report.association_code, audience as FeedbackAudience)
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: audience === 'board'
          ? `No active board members with email on file for ${report.association_code}.`
          : `No owner emails on file for ${report.association_code}.` },
      { status: 404 },
    )
  }

  // Scope label + totals for the email body.
  const { data: assocRow } = await supabaseAdmin
    .from('associations')
    .select('association_name')
    .eq('association_code', report.association_code)
    .maybeSingle()
  const assocName = (assocRow?.association_name as string | undefined) ?? null
  const scopeLabel = assocName
    ? `${assocName} (${report.association_code})`
    : report.association_code

  const reportData = await gatherMonthlyReportData(report.association_code, report.month)

  // Ensure a report_feedback row per recipient (idempotent — re-sends
  // reuse the existing token + rating).
  const rows = await prepareReportSend(report.id, audience as FeedbackAudience, recipients)

  let sent = 0
  const errors: string[] = []
  for (const row of rows) {
    const viewUrl     = `${APP_URL}/report/${report.id}`
    const feedbackUrl = `${APP_URL}/report-feedback/${row.feedback_token}`
    const { subject, html, text } = buildReportEmail({
      scopeLabel,
      month:          report.month,
      totals:         reportData.totals,
      reportMarkdown: report.report_markdown,
      recipientName:  row.recipient_name || (audience === 'board' ? 'Board Member' : 'Unit Owner'),
      viewUrl, feedbackUrl,
      appUrl:         APP_URL,
    })
    try {
      await sendEmail({ to: row.recipient_email, subject, html, text })
      sent++
    } catch (err) {
      errors.push(`${row.recipient_email}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return NextResponse.json({
    ok:       true,
    audience,
    sent,
    total:    rows.length,
    errors,
  })
}
