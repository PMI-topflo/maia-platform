// =====================================================================
// lib/screening/report-storage.ts
// Downloads a finished Checkr report PDF, splices MAIA's own colorful
// summary cover page in front of it (lib/screening-summary-pdf.tsx's
// mergeWithOriginalPdf -- the ORIGINAL report pages are copied verbatim,
// never re-created, same compliance stance as lib/rules-ack-pdf.ts), and
// stores the merged file. Links it back onto the screening_subjects row
// (and, for single-subject applications, applications.screening_report_url
// so the two existing "View screening report" UI links light up).
//
// User direction, 2026-09-08, after a first version shipped the colorful
// summary as a SEPARATE downloadable PDF: "my idea was having the new
// colourful in the same PDF and preview as the original, so both could
// be seen by the board while approving, not a new button that I will
// never use." One file, one "View report" link from here on.
// =====================================================================

import { renderToBuffer } from '@react-pdf/renderer'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { screening } from './index'
import { INTAKE_BUCKET } from '@/lib/preapply'
import { normalizeName } from './stakeholder-match'
import { summarizeReport } from './report-summary'
import { ScreeningSummaryPdf, mergeWithOriginalPdf } from '@/lib/screening-summary-pdf'

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

type Subject = { id: string; application_id: string; name: string | null; stakeholder_id: string | null }

/** Unit + association line for the summary cover page's header -- best-
 *  effort only, never fatal (a missing address just leaves the header
 *  blanker, not broken). */
async function unitLineFor(applicationId: string): Promise<string | null> {
  const { data: la } = await supabaseAdmin.from('listing_applications')
    .select('unit_label, association_code').eq('detailed_application_id', applicationId).maybeSingle()
  if (!la) return null
  const unit = (la.unit_label as string | null) ?? null
  const { data: assoc } = await supabaseAdmin.from('associations')
    .select('association_name').eq('association_code', String(la.association_code)).maybeSingle()
  const assocName = (assoc?.association_name as string | null) ?? String(la.association_code)
  return [unit ? `Unit ${unit}` : null, assocName].filter(Boolean).join(' · ') || null
}

/** Builds the colorful cover page and splices it in front of Checkr's
 *  original PDF, byte-for-byte unmodified. Falls back to the original PDF
 *  alone (never throws) whenever there's nothing to summarize or the
 *  render/merge fails -- the original report is the authoritative record
 *  either way, so a cover-page failure must never block it from being
 *  stored. */
async function buildMergedPdf(subject: Subject, reportId: string, originalPdf: Buffer, reportData: Record<string, unknown> | null): Promise<Buffer> {
  const summary = reportData ? summarizeReport(reportData) : null
  if (!summary) return originalPdf
  try {
    const unitLine = await unitLineFor(subject.application_id)
    const summaryPdf = Buffer.from(await renderToBuffer(ScreeningSummaryPdf({
      applicantName: subject.name ?? 'Applicant', unitLine, reportId,
      pulledAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      summary,
    })))
    return await mergeWithOriginalPdf(summaryPdf, originalPdf)
  } catch (e) {
    console.error('[report-storage] colorful cover page failed, storing the original report alone:', e)
    return originalPdf
  }
}

/** Fetches the PDF from Checkr, stores it (with MAIA's colorful summary
 *  spliced in front), and links it onto the subject row (plus the
 *  application row, when it's the application's only subject --
 *  applications.screening_report_url has room for one link). Also best-
 *  effort fetches the structured report body (credit/criminal/eviction/
 *  income results, not just the rendered PDF) into report_data, and best-
 *  effort files the same merged PDF onto the applicant's own "Background /
 *  Credit Reports" checklist row (see fileReportAsDocument below) --
 *  neither ever fails the whole function, since the PDF stored on
 *  screening_subjects is the authoritative record staff/board already
 *  rely on regardless of whether either extra step lands. */
export async function storeAndLinkReport(subject: Subject, reportId: string): Promise<void> {
  await ensureBucket()
  const originalPdf = await screening.getReportPdf(reportId)

  let reportData: Record<string, unknown> | null = null
  try {
    reportData = await screening.getReport(reportId)
  } catch (e) {
    console.error('[report-storage] getReport failed (PDF still stored):', e)
  }

  const pdf = await buildMergedPdf(subject, reportId, originalPdf, reportData)

  const path = `${subject.application_id}/${subject.id}_${reportId}.pdf`
  const { error: uploadErr } = await supabaseAdmin.storage.from(BUCKET)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (uploadErr) throw new Error(`upload report pdf: ${uploadErr.message}`)

  const { data: signed, error: signErr } = await supabaseAdmin.storage.from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (signErr || !signed) throw new Error(`sign report pdf url: ${signErr?.message}`)

  await supabaseAdmin.from('screening_subjects')
    .update({ checkr_report_id: reportId, report_url: signed.signedUrl, ...(reportData ? { report_data: reportData } : {}) })
    .eq('id', subject.id)

  const { count } = await supabaseAdmin.from('screening_subjects')
    .select('id', { count: 'exact', head: true }).eq('application_id', subject.application_id)
  if (count === 1) {
    await supabaseAdmin.from('applications')
      .update({ screening_report_url: signed.signedUrl }).eq('id', subject.application_id)
  }

  await fileReportAsDocument(subject, pdf).catch(e => console.error('[report-storage] file as document failed:', e))
}

/** Re-generates the merged (colorful cover + original) PDF for a report
 *  that already completed -- either before this cover page existed, or
 *  before report_data was successfully captured. Re-downloads the
 *  original from Checkr by the already-known checkr_report_id (no new
 *  Checkr order or webhook involved) and re-uses the already-stored
 *  report_data, so this costs one Checkr PDF fetch, nothing else. Updates
 *  BOTH the stored report_url ("View report" link) and the filed
 *  checklist document, so backfilling one old report fixes everywhere it
 *  shows. */
export async function regenerateMergedReport(subject: Subject & { checkr_report_id: string }): Promise<void> {
  await ensureBucket()
  const originalPdf = await screening.getReportPdf(subject.checkr_report_id)
  const { data: row } = await supabaseAdmin.from('screening_subjects').select('report_data').eq('id', subject.id).maybeSingle()
  const reportData = (row?.report_data as Record<string, unknown> | null) ?? null

  const pdf = await buildMergedPdf(subject, subject.checkr_report_id, originalPdf, reportData)

  const path = `${subject.application_id}/${subject.id}_${subject.checkr_report_id}.pdf`
  const { error: uploadErr } = await supabaseAdmin.storage.from(BUCKET)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (uploadErr) throw new Error(`upload report pdf: ${uploadErr.message}`)

  const { data: signed, error: signErr } = await supabaseAdmin.storage.from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (signErr || !signed) throw new Error(`sign report pdf url: ${signErr?.message}`)

  await supabaseAdmin.from('screening_subjects').update({ report_url: signed.signedUrl }).eq('id', subject.id)

  const { count } = await supabaseAdmin.from('screening_subjects')
    .select('id', { count: 'exact', head: true }).eq('application_id', subject.application_id)
  if (count === 1) {
    await supabaseAdmin.from('applications').update({ screening_report_url: signed.signedUrl }).eq('id', subject.application_id)
  }

  await fileReportAsDocument(subject, pdf)
}

// Staff report, 2026-09-07 (Querline Pinckney, MANXI 912 -- the first real
// completed Checkr report): the PDF landed in screening_subjects (viewable
// from the Background check summary card) but never in the applicant's own
// "Background / Credit Reports" checklist row -- so the required document
// still read as missing, with no preview/approve flow like every other
// filed document gets. This copies the SAME already-fetched PDF bytes into
// application-docs (the bucket application_documents actually reads from --
// a Checkr-hosted signed URL isn't a stable long-term path the way every
// other filed document assumes) and files it as that applicant's own
// background_credit document.
//
// screening_subjects.stakeholder_id is set once, at order-creation time
// (app/api/trigger-screening/route.ts), from the applicant MAIA was
// actually placing the order for -- exact, no guessing. The name/single-
// applicant fallback below only matters for a subject created before that
// column existed.
export async function fileReportAsDocument(subject: Subject, pdf: Buffer): Promise<void> {
  const { data: listingApp } = await supabaseAdmin.from('listing_applications')
    .select('id, listing_id').eq('detailed_application_id', subject.application_id).maybeSingle()
  if (!listingApp) return   // no staff-side application to file onto (e.g. a pure legacy /apply-only record)

  let stakeholderId = subject.stakeholder_id
  if (!stakeholderId) {
    const { data: stakeholders } = await supabaseAdmin.from('application_stakeholders')
      .select('id, name').eq('application_id', listingApp.id).eq('role', 'applicant')
    const people = stakeholders ?? []
    const name = normalizeName(subject.name)
    // The single-applicant case -- by far the common one -- needs no name
    // match at all: there is only one person it could possibly be.
    stakeholderId = (people.length === 1
      ? people[0]
      : name ? people.find(s => normalizeName(s.name as string | null) === name) : undefined
    )?.id as string | null ?? null
  }

  const path = `intake/${listingApp.id}/background_credit/${crypto.randomUUID()}.pdf`
  const { error: upErr } = await supabaseAdmin.storage.from(INTAKE_BUCKET)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (upErr) { console.error('[report-storage] copy to application-docs failed:', upErr.message); return }

  const filename = `Checkr Report${subject.name ? ` - ${subject.name}` : ''}.pdf`
  // Replace a PREVIOUS Checkr-filed copy for this same slot rather than
  // piling up a new row on every webhook redelivery (Checkr's own delivery
  // guarantee is at-least-once, per their Webhooks guide).
  let existingQuery = supabaseAdmin.from('application_documents')
    .select('id').eq('application_id', listingApp.id).eq('doc_key', 'background_credit').eq('uploaded_by_role', 'checkr')
  existingQuery = stakeholderId ? existingQuery.eq('stakeholder_id', stakeholderId) : existingQuery.is('stakeholder_id', null)
  const { data: existing } = await existingQuery.maybeSingle()
  if (existing) {
    await supabaseAdmin.from('application_documents').update({ storage_path: path, filename, suggested_name: filename, mime_type: 'application/pdf' }).eq('id', existing.id)
  } else {
    await supabaseAdmin.from('application_documents').insert({
      application_id: listingApp.id, listing_id: listingApp.listing_id, kind: 'other',
      doc_key: 'background_credit', doc_label: 'Background / Credit Reports',
      storage_path: path, filename, suggested_name: filename, mime_type: 'application/pdf',
      uploaded_by_role: 'checkr', stakeholder_id: stakeholderId,
    })
    // Clean up a stale unscoped copy from before this stakeholder could be
    // resolved (e.g. an earlier click of "File as document" pre-dating this
    // fix) -- otherwise it lingers as an orphaned row nothing points to.
    if (stakeholderId) {
      await supabaseAdmin.from('application_documents')
        .delete().eq('application_id', listingApp.id).eq('doc_key', 'background_credit')
        .eq('uploaded_by_role', 'checkr').is('stakeholder_id', null)
    }
  }
}
