// =====================================================================
// lib/screening/report-storage.ts
// Downloads a finished Checkr report PDF and stores it in a private
// Supabase bucket, then links it back onto the screening_subjects row
// (and, for single-subject applications, applications.screening_report_url
// so the two existing "View screening report" UI links light up).
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { screening } from './index'

const BUCKET = 'screening-reports'
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days -- board/staff review window

let bucketEnsured = false
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return
  const { data: buckets } = await supabaseAdmin.storage.listBuckets()
  if (!buckets?.some(b => b.name === BUCKET)) {
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false })
    if (error) throw new Error(`createBucket(${BUCKET}) failed: ${error.message}`)
  }
  bucketEnsured = true
}

/** Fetches the PDF from Checkr, stores it, and links it onto the subject
 *  row (plus the application row, when it's the application's only
 *  subject -- applications.screening_report_url has room for one link). */
export async function storeAndLinkReport(subject: { id: string; application_id: string }, reportId: string): Promise<void> {
  await ensureBucket()
  const pdf = await screening.getReportPdf(reportId)
  const path = `${subject.application_id}/${subject.id}_${reportId}.pdf`
  const { error: uploadErr } = await supabaseAdmin.storage.from(BUCKET)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (uploadErr) throw new Error(`upload report pdf: ${uploadErr.message}`)

  const { data: signed, error: signErr } = await supabaseAdmin.storage.from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (signErr || !signed) throw new Error(`sign report pdf url: ${signErr?.message}`)

  await supabaseAdmin.from('screening_subjects')
    .update({ checkr_report_id: reportId, report_url: signed.signedUrl })
    .eq('id', subject.id)

  const { count } = await supabaseAdmin.from('screening_subjects')
    .select('id', { count: 'exact', head: true }).eq('application_id', subject.application_id)
  if (count === 1) {
    await supabaseAdmin.from('applications')
      .update({ screening_report_url: signed.signedUrl }).eq('id', subject.application_id)
  }
}
