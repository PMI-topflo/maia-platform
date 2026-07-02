// =====================================================================
// lib/report-financials.ts
//
// Storage + extraction + DB helpers for the monthly-report financial
// statement. Staff upload the CINC financial PDF for an (association,
// month); MAIA (Claude) reads the PDF and pulls the headline figures;
// both the PDF and the figures are stored in `report_financials`.
//
// The PDF lives in the private `report-financials` storage bucket; the
// figures are rendered into the report's styled financial section and
// fed to the board-report generator.
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { assertClaudeBudget } from '@/lib/anthropic-guard'

import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeUpload } from '@/lib/pdf-normalize'

export const FINANCIALS_BUCKET = 'report-financials'
const SIGNED_URL_TTL_SECONDS = 60 * 60          // 1 hour
const FILE_SIZE_LIMIT_BYTES  = 20 * 1024 * 1024 // 20 MB — CINC PDFs are far smaller
const EXTRACT_MODEL          = 'claude-haiku-4-5-20251001'

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────
export interface FinancialFigure {
  label: string
  value: string
  note?: string | null
}

export interface FinancialFigures {
  period_label?: string | null
  as_of_date?:   string | null
  headline:      FinancialFigure[]
  notes?:        string | null
}

export type ExtractStatus = 'pending' | 'extracted' | 'failed'

export interface ReportFinancialRow {
  id:                string
  association_code:  string
  month:             string
  storage_path:      string
  pdf_filename:      string
  pdf_size_bytes:    number
  figures:           FinancialFigures | null
  extract_status:    ExtractStatus
  extract_error:     string | null
  uploaded_by_email: string | null
  uploaded_at:       string
  extracted_at:      string | null
}

// ─────────────────────────────────────────────────────────────────────
// Bucket
// ─────────────────────────────────────────────────────────────────────
let _bucketEnsured = false
async function ensureBucket(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (_bucketEnsured) return { ok: true }

  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets()
  if (listErr) return { ok: false, reason: `listBuckets failed: ${listErr.message}` }
  if (buckets?.some(b => b.name === FINANCIALS_BUCKET)) {
    _bucketEnsured = true
    return { ok: true }
  }

  const { error: createErr } = await supabaseAdmin.storage.createBucket(FINANCIALS_BUCKET, {
    public:        false,
    fileSizeLimit: FILE_SIZE_LIMIT_BYTES,
  })
  if (createErr) return { ok: false, reason: `createBucket failed: ${createErr.message}` }
  _bucketEnsured = true
  return { ok: true }
}

export const FINANCIALS_FILE_SIZE_LIMIT_BYTES = FILE_SIZE_LIMIT_BYTES

// ─────────────────────────────────────────────────────────────────────
// Claude PDF extraction
// ─────────────────────────────────────────────────────────────────────
const EXTRACT_PROMPT =
`The attached PDF is a financial statement for a community association / HOA managed by PMI Top Florida Properties.

Extract the headline financial figures a board would want to see. Return ONLY a JSON object — no prose, no code fences — matching exactly this shape:

{
  "period_label": "the period the statement covers, e.g. 'March 2026' or 'As of March 31, 2026'",
  "as_of_date": "YYYY-MM-DD if a balance-sheet date is stated, otherwise null",
  "headline": [
    { "label": "figure name", "value": "amount exactly as printed, including the $ sign and commas", "note": "optional short context, otherwise null" }
  ],
  "notes": "one short sentence of context, otherwise null"
}

Include the most board-relevant figures actually present in the document, such as: operating cash balance, reserve cash balance, total income for the period, total expenses for the period, net income / surplus or deficit, total accounts receivable or owner delinquencies, total assets, total liabilities. Use the document's own labels. Do NOT invent, estimate, or calculate any figure that is not printed in the document. If the PDF is not a financial statement, return {"period_label": null, "as_of_date": null, "headline": [], "notes": "Not a financial statement"}.`

/** Strip ```json fences and parse. Throws if the text is not JSON. */
function parseFiguresJson(text: string): FinancialFigures {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const parsed = JSON.parse(cleaned) as Partial<FinancialFigures>
  const headline = Array.isArray(parsed.headline)
    ? parsed.headline
        .filter((f): f is FinancialFigure =>
          !!f && typeof f.label === 'string' && typeof f.value === 'string')
        .map(f => ({ label: f.label.trim(), value: f.value.trim(), note: f.note ?? null }))
    : []
  return {
    period_label: parsed.period_label ?? null,
    as_of_date:   parsed.as_of_date ?? null,
    headline,
    notes:        parsed.notes ?? null,
  }
}

/** Send the PDF to Claude and pull out the headline figures. Throws on
 *  an API error or unparseable response. An empty `headline` is a valid
 *  result — it means no figures were found / the file is not a statement. */
export async function extractFinancialFigures(pdfBase64: string): Promise<FinancialFigures> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }
  const anthropic = new Anthropic()
  await assertClaudeBudget('report-financials')
  const msg = await anthropic.messages.create({
    model:      EXTRACT_MODEL,
    max_tokens: 1600,
    messages: [{
      role: 'user',
      content: [
        {
          type:   'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
        },
        { type: 'text', text: EXTRACT_PROMPT },
      ],
    }],
  })
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()
  if (!text) throw new Error('The model returned an empty response')
  return parseFiguresJson(text)
}

// ─────────────────────────────────────────────────────────────────────
// DB
// ─────────────────────────────────────────────────────────────────────
const FINANCIAL_COLUMNS = 'id, association_code, month, storage_path, pdf_filename, pdf_size_bytes, figures, extract_status, extract_error, uploaded_by_email, uploaded_at, extracted_at'

/** The financial statement on file for an (association, month), or null. */
export async function getFinancials(
  assoc: string,
  month: string,
): Promise<ReportFinancialRow | null> {
  const code = (assoc || 'ALL').trim().toUpperCase()
  const { data, error } = await supabaseAdmin
    .from('report_financials')
    .select(FINANCIAL_COLUMNS)
    .eq('association_code', code)
    .eq('month', month)
    .maybeSingle()
  if (error || !data) return null
  return data as ReportFinancialRow
}

/** A short signed URL for the stored PDF, or '' if it can't be signed. */
export async function signedFinancialUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(FINANCIALS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return ''
  return data.signedUrl
}

/** Download the stored PDF bytes (for the staff-only stream route). */
export async function downloadFinancialPdf(storagePath: string): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(FINANCIALS_BUCKET)
    .download(storagePath)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
}

/** Upload a financial PDF, auto-extract its figures, and upsert the row
 *  for (association, month). Replacing an existing statement deletes the
 *  previous PDF object. The PDF is always kept even if extraction fails,
 *  so it can still be attached to the report. */
export async function saveFinancialPdf(opts: {
  assoc:           string
  month:           string
  bytes:           Buffer
  filename:        string
  uploadedByEmail: string | null
}): Promise<{ ok: true; row: ReportFinancialRow } | { ok: false; error: string }> {
  const code = (opts.assoc || 'ALL').trim().toUpperCase()
  if (!/^\d{4}-\d{2}$/.test(opts.month)) {
    return { ok: false, error: 'Invalid month' }
  }
  if (!/\.pdf$/i.test(opts.filename)) {
    return { ok: false, error: 'Only PDF files are accepted' }
  }
  if (opts.bytes.byteLength === 0) {
    return { ok: false, error: 'The uploaded file is empty' }
  }
  // Shrink an oversized scanned statement before the size gate (text-layer
  // statements are preserved as-is, so extraction is unaffected).
  const { buffer: bytes } = await normalizeUpload(opts.bytes, { contentType: 'application/pdf', filename: opts.filename })
  if (bytes.byteLength > FILE_SIZE_LIMIT_BYTES) {
    return { ok: false, error: `The PDF exceeds the ${Math.round(FILE_SIZE_LIMIT_BYTES / 1024 / 1024)} MB limit` }
  }

  const bucket = await ensureBucket()
  if (!bucket.ok) return { ok: false, error: bucket.reason }

  // Remember the PDF currently on file so it can be cleaned up after a
  // successful replace.
  const existing = await getFinancials(code, opts.month)
  const oldPath  = existing?.storage_path ?? null

  const storagePath = `${code}/${opts.month}/${globalThis.crypto.randomUUID()}.pdf`
  const { error: uploadErr } = await supabaseAdmin.storage
    .from(FINANCIALS_BUCKET)
    .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: false })
  if (uploadErr) return { ok: false, error: `Upload failed: ${uploadErr.message}` }

  // Extract the figures. A failure here must not lose the PDF — record
  // the row as 'failed' so the statement can still be attached.
  let figures: FinancialFigures | null = null
  let status:  ExtractStatus = 'failed'
  let error:   string | null = null
  try {
    const result = await extractFinancialFigures(bytes.toString('base64'))
    if (result.headline.length > 0) {
      figures = result
      status  = 'extracted'
    } else {
      error = result.notes || 'No financial figures could be read from this PDF'
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  const { data: saved, error: saveErr } = await supabaseAdmin
    .from('report_financials')
    .upsert({
      association_code:  code,
      month:             opts.month,
      storage_path:      storagePath,
      pdf_filename:      opts.filename,
      pdf_size_bytes:    bytes.byteLength,
      figures,
      extract_status:    status,
      extract_error:     error,
      uploaded_by_email: opts.uploadedByEmail,
      uploaded_at:       new Date().toISOString(),
      extracted_at:      status === 'extracted' ? new Date().toISOString() : null,
    }, { onConflict: 'association_code,month' })
    .select(FINANCIAL_COLUMNS)
    .single()

  if (saveErr || !saved) {
    // Roll back the just-uploaded object so a failed insert leaves no leak.
    await supabaseAdmin.storage.from(FINANCIALS_BUCKET).remove([storagePath])
    return { ok: false, error: `Could not save the statement: ${saveErr?.message ?? 'unknown error'}` }
  }

  // Replace succeeded — drop the previous PDF object.
  if (oldPath && oldPath !== storagePath) {
    await supabaseAdmin.storage.from(FINANCIALS_BUCKET).remove([oldPath])
  }

  return { ok: true, row: saved as ReportFinancialRow }
}

/** Remove the financial statement (row + stored PDF) for an (assoc, month). */
export async function deleteFinancials(
  assoc: string,
  month: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await getFinancials(assoc, month)
  if (!row) return { ok: true }   // nothing to remove
  await supabaseAdmin.storage.from(FINANCIALS_BUCKET).remove([row.storage_path])
  const { error } = await supabaseAdmin
    .from('report_financials')
    .delete()
    .eq('id', row.id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Render the extracted figures as a prompt block for the board-report
 *  generator, so the narrative's financial section uses real numbers. */
export function financialsPromptBlock(figures: FinancialFigures | null): string {
  if (!figures || figures.headline.length === 0) return ''
  const lines = figures.headline.map(f =>
    `- ${f.label}: ${f.value}${f.note ? ` (${f.note})` : ''}`)
  const period = figures.period_label ? `\nStatement period: ${figures.period_label}` : ''
  const notes  = figures.notes ? `\nNote: ${figures.notes}` : ''
  return `FINANCIAL STATEMENT FIGURES (auto-extracted from the uploaded CINC financial PDF — ` +
    `use these exact figures in the financial section; do not invent or recalculate any others):\n` +
    lines.join('\n') + period + notes
}
