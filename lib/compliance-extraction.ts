// =====================================================================
// lib/compliance-extraction.ts
//
// Read the key DEADLINE dates off an uploaded compliance document with
// Claude (PDF/image vision), so the Insurance / Safety managers can
// pre-fill the due-date field for staff to confirm. Mirrors the invoice
// extractor pattern (lib/invoice-extraction.ts): single user-turn, PDF or
// image inlined as base64, strict JSON-only response, confidence score.
//
// This only covers DOCUMENT-sourced deadlines (the date is printed on the
// cert / report). Rule-based deadlines that aren't on the document
// (e.g. Sunbiz's May 1) are NOT extracted here — those live in code
// (lib/sunbiz.ts) and are surfaced directly.
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { assertClaudeBudget } from '@/lib/anthropic-guard'

const EXTRACT_MODEL = 'claude-haiku-4-5-20251001'

export type ComplianceKind = 'insurance' | 'safety'

export interface ComplianceExtraction {
  effectiveDate:  string | null   // ISO YYYY-MM-DD — when coverage/inspection started
  expirationDate: string | null   // ISO — insurance: policy expiration (the deadline)
  inspectionDate: string | null   // ISO — safety: date the inspection was performed
  nextDueDate:    string | null   // ISO — safety: next required inspection/recert deadline
  issuer:         string | null   // carrier (insurance) or inspecting firm (safety)
  confidence:     number          // 0..1
  note:           string | null   // short human-readable summary of what was found
}

function promptFor(kind: ComplianceKind): string {
  const common = `Return a SINGLE JSON object and nothing else (no prose, no markdown fences). Dates MUST be ISO YYYY-MM-DD (convert "5/1/2026" → "2026-05-01"). Use null for anything not clearly present. "confidence" is 0..1 (1 = the document is clearly this type and the dates are unambiguous).`
  if (kind === 'insurance') {
    return `You are reading a Certificate of Insurance (COI) / insurance policy for an HOA / condo association.
${common}
Schema:
{
  "effective_date":  string or null,   // policy effective / inception date
  "expiration_date": string or null,   // policy EXPIRATION date — this is the compliance deadline
  "issuer":          string or null,   // the insurance carrier / company name
  "confidence":      number,
  "note":            string or null    // e.g. "Master property policy, expires 2026-11-01"
}
Rules: If multiple coverages list different expirations, return the EARLIEST expiration_date (the binding deadline). If it's not an insurance document, set fields null and confidence below 0.3.`
  }
  return `You are reading a building safety inspection / recertification report for an HOA / condo association (e.g. Milestone inspection, SIRS, wind mitigation, roof).
${common}
Schema:
{
  "inspection_date": string or null,   // date the inspection was performed / report issued
  "next_due_date":   string or null,   // next required inspection / recertification deadline, if stated
  "issuer":          string or null,   // the inspecting engineer / firm
  "confidence":      number,
  "note":            string or null    // e.g. "Milestone inspection performed 2026-03-01; recert due 2036"
}
Rules: next_due_date is often NOT printed (it's a code-driven cycle) — leave it null if not explicitly stated. If it's not an inspection report, set fields null and confidence below 0.3.`
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const conf = (v: unknown): number => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
}
function isoDate(v: unknown): string | null {
  const s = str(v); if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function empty(): ComplianceExtraction {
  return { effectiveDate: null, expirationDate: null, inspectionDate: null, nextDueDate: null, issuer: null, confidence: 0, note: null }
}

/** Extract deadline dates from a compliance document buffer (PDF or image).
 *  Throws only on API/config failure; a "doesn't look like this" doc comes
 *  back as a low-confidence empty-ish result for the caller to gate on. */
export async function extractComplianceDates(
  buf: Buffer,
  kind: ComplianceKind,
  contentType?: string | null,
): Promise<ComplianceExtraction> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured')

  const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-' || (contentType ?? '').includes('pdf')
  const b64 = buf.toString('base64')
  const block = isPdf
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: b64 } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: (mediaTypeFor(contentType)) , data: b64 } }

  const anthropic = new Anthropic()
  await assertClaudeBudget('compliance-extraction')
  const msg = await anthropic.messages.create({
    model:      EXTRACT_MODEL,
    max_tokens: 400,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: 'user', content: [block as any, { type: 'text', text: promptFor(kind) }] }],
  })

  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
  if (!text) return empty()

  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let obj: Record<string, unknown>
  try { obj = JSON.parse(cleaned) as Record<string, unknown> } catch { return empty() }

  return {
    effectiveDate:  isoDate(obj.effective_date),
    expirationDate: isoDate(obj.expiration_date),
    inspectionDate: isoDate(obj.inspection_date),
    nextDueDate:    isoDate(obj.next_due_date),
    issuer:         str(obj.issuer),
    confidence:     conf(obj.confidence),
    note:           str(obj.note),
  }
}

function mediaTypeFor(contentType?: string | null): 'image/jpeg' | 'image/png' | 'image/webp' {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('png')) return 'image/png'
  if (ct.includes('webp')) return 'image/webp'
  return 'image/jpeg'
}
