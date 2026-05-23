// =====================================================================
// /report-feedback/[token]
//
// Public tokenized page where a board member or owner rates the monthly
// management report sent to them and leaves written feedback. The token
// is the credential — no login. Submitting is idempotent so the same
// link can be reopened to edit the rating later.
// =====================================================================

import { notFound } from 'next/navigation'

import { supabaseAdmin } from '@/lib/supabase-admin'
import { monthLabel } from '@/lib/monthly-report'
import { getFeedbackByToken } from '@/lib/report-feedback'
import FeedbackForm from './FeedbackForm'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Rate the Monthly Report — PMI Top Florida Properties',
  description: 'Share your feedback on this month’s management report.',
}

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const row = await getFeedbackByToken(token)
  if (!row) notFound()

  // Report context for the page header (assoc name + month).
  const { data: report } = await supabaseAdmin
    .from('monthly_reports')
    .select('association_code, month')
    .eq('id', row.report_id)
    .maybeSingle()
  const code  = (report?.association_code as string | undefined) ?? ''
  const month = (report?.month as string | undefined) ?? ''
  let assocName: string | null = null
  if (code && code !== 'ALL') {
    const { data: a } = await supabaseAdmin
      .from('associations')
      .select('association_name')
      .eq('association_code', code)
      .maybeSingle()
    assocName = (a?.association_name as string | undefined) ?? null
  }
  const scopeLabel = assocName ? `${assocName} (${code})` : (code || '—')

  return (
    <div className="min-h-screen bg-gray-100 px-6 py-10">
      <div className="mx-auto max-w-md overflow-hidden rounded-xl bg-white shadow-sm">

        {/* Brand header */}
        <div className="border-b border-gray-100 px-7 py-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pmi-logo.png" alt="PMI Top Florida Properties" className="mx-auto h-12 w-auto" />
          <h1 className="mt-3 text-lg font-bold text-[#1f2a44]">Monthly Management Report</h1>
          <p className="mt-1 text-xs text-gray-500">
            {scopeLabel}{month ? ` · ${monthLabel(month)}` : ''}
          </p>
          <p className="mt-2 text-[11px] text-gray-400">
            {row.recipient_name ? `For ${row.recipient_name}` : ''}
            {row.recipient_label ? ` · ${row.recipient_label}` : ''}
          </p>
        </div>

        <div className="px-7 py-6">
          <FeedbackForm
            token={token}
            initialRating={row.rating}
            initialFeedback={row.feedback}
            recipientName={row.recipient_name}
          />
        </div>

        <div className="border-t border-gray-100 bg-gray-50 px-7 py-4 text-center text-[11px] leading-relaxed text-gray-500">
          PMI Top Florida Properties · Miami, FL · 305.900.5077<br />
          Your feedback goes only to your management team.
        </div>

      </div>
    </div>
  )
}
