// =====================================================================
// lib/vendor-doc-extraction.ts
//
// Read a vendor-uploaded document with Claude (PDF/image vision) BEFORE it
// is compressed for storage, so we capture the real data off the best-
// quality input. Classifies the document (W-9 / COI / ACH / license /
// insurance / estimate / invoice / other) and pulls a few key fields.
//
// SECURITY: never store full tax IDs or bank numbers. We ask Claude for
// masked last-4 only (e.g. "••1234") so the DB holds enough to identify
// the doc without retaining sensitive account/EIN values.
//
// Mirrors lib/compliance-extraction.ts: single user turn, base64-inlined
// PDF/image, strict JSON-only response, confidence score. Throws only on
// API/config failure; a non-document comes back as low-confidence 'other'.
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { assertClaudeBudget } from '@/lib/anthropic-guard'

const EXTRACT_MODEL = 'claude-haiku-4-5-20251001'

export type VendorDocType =
  | 'w9' | 'coi' | 'ach' | 'license' | 'insurance'
  | 'estimate' | 'invoice' | 'other'

/** An entity named on a COI — an additional insured or the certificate holder. */
export interface CoiEntity {
  name:    string
  address: string | null
}

export interface VendorDocExtraction {
  docType:    VendorDocType
  confidence: number                       // 0..1
  summary:    string | null                // short human label
  fields:     Record<string, string>       // type-specific, sensitive values masked
  // Populated only for coi/insurance docs — the entities the certificate
  // protects. Used by lib/coi-validation.ts to verify PMI + the association
  // are listed as additional insured. Never sensitive, never masked.
  coi?: {
    additionalInsured:  CoiEntity[]
    certificateHolder:  CoiEntity | null
  }
}

const PROMPT = `You are classifying and reading a document a vendor sent to a property-management company. The document is ONE of: a W-9, a Certificate of Insurance (COI), an ACH / bank authorization form, a business/contractor license, an insurance policy, a job estimate/quote, an invoice, or something else.

Return a SINGLE JSON object and nothing else (no prose, no markdown fences):
{
  "doc_type":   "w9" | "coi" | "ach" | "license" | "insurance" | "estimate" | "invoice" | "other",
  "confidence": number,            // 0..1, how sure you are of doc_type
  "summary":    string,            // one short line, e.g. "W-9 for Green Shield Lawn Solutions"
  "fields": {                      // include ONLY keys relevant to doc_type; omit the rest
    // w9:        "legal_name", "business_name", "tax_classification", "ein_last4", "ssn_last4", "address"
    // coi/insurance: "insured_name", "carrier", "policy_number", "effective_date", "expiration_date", "general_liability_limit"
    // ach:       "account_holder", "bank_name", "routing_last4", "account_last4", "account_type"
    // license:   "license_name", "license_number", "license_type", "issuer", "expiration_date"
    // estimate/invoice: "vendor_name", "amount", "invoice_number", "date", "scope"
  },
  // ONLY when doc_type is "coi" or "insurance" — otherwise omit both keys:
  "additional_insured": [           // every entity named as ADDITIONAL INSURED (often in the Description box / endorsements)
    { "name": string, "address": string or null }
  ],
  "certificate_holder": { "name": string, "address": string or null }  // the CERTIFICATE HOLDER box, or null if none
}

CRITICAL RULES:
- Dates MUST be ISO YYYY-MM-DD (convert "5/1/2026" → "2026-05-01").
- For additional_insured: read the Description of Operations box AND any attached endorsement pages; copy each entity's name and (if printed) its full address EXACTLY as shown, typos and all. Include the certificate holder there too if the form says the holder is also an additional insured. Empty array if none.
%%SENSITIVE%%
- Omit any field you can't read; do not guess. Use a string for every value you include.
- If it isn't clearly one of the listed types, use "other" with confidence below 0.3.`

const MASK_CLAUSE  = `- NEVER output a full Tax ID / EIN / SSN or full bank routing/account number. Output only the LAST 4 digits, prefixed with "••" (e.g. "••1234"). If you can only see part, give what you have, still masked.`
const FULL_CLAUSE  = `- Output the COMPLETE values exactly as printed, including full routing and account numbers and full Tax ID / EIN — do NOT mask or truncate. (These are needed to update the vendor's banking record and are not stored.)`
function promptFor(mask: boolean): string {
  return PROMPT.replace('%%SENSITIVE%%', mask ? MASK_CLAUSE : FULL_CLAUSE)
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const conf = (v: unknown): number => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
}
const DOC_TYPES: VendorDocType[] = ['w9', 'coi', 'ach', 'license', 'insurance', 'estimate', 'invoice', 'other']

function mediaTypeFor(contentType?: string | null): 'image/jpeg' | 'image/png' | 'image/webp' {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('png')) return 'image/png'
  if (ct.includes('webp')) return 'image/webp'
  return 'image/jpeg'
}

// Redact anything that looks like a full 9-digit EIN/SSN or a long bank
// number that slipped through, as a belt-and-suspenders guard before we
// persist Claude's output.
function maskValue(v: string): string {
  return v
    .replace(/\b\d{2}-?\d{7}\b/g, m => '••' + m.slice(-4))          // EIN 12-3456789
    .replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, m => '••' + m.slice(-4))   // SSN
    .replace(/\b\d{6,}\b/g, m => '••' + m.slice(-4))                // long account/routing
}

/** Extract structured data from a vendor document buffer (PDF or image).
 *  Returns null only when extraction is not applicable (not a PDF/image)
 *  or the API is unavailable — callers treat null as "skip, no harm".
 *
 *  `opts.mask` (default true) masks sensitive values to last-4 for STORAGE.
 *  Pass `mask: false` ONLY for a transient server-side push to CINC (the
 *  full Routing/Account/EIN are needed to write the vendor record) — the
 *  unmasked result must never be persisted or returned to the browser. */
export async function extractVendorDocument(
  buf: Buffer,
  filename: string,
  contentType?: string | null,
  opts: { mask?: boolean } = {},
): Promise<VendorDocExtraction | null> {
  const mask = opts.mask !== false
  if (!process.env.ANTHROPIC_API_KEY) return null

  const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-' || (contentType ?? '').includes('pdf')
  const isImg = /\.(png|jpe?g|webp|heic|heif)$/i.test(filename) || (contentType ?? '').startsWith('image/')
  if (!isPdf && !isImg) return null

  const b64 = buf.toString('base64')
  const block = isPdf
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: b64 } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaTypeFor(contentType), data: b64 } }

  let text = ''
  try {
    const anthropic = new Anthropic()
    await assertClaudeBudget('vendor-doc-extraction')
    const msg = await anthropic.messages.create({
      model:      EXTRACT_MODEL,
      max_tokens: 600,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: [block as any, { type: 'text', text: promptFor(mask) }] }],
    })
    text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
  } catch {
    return null   // API failure must never block the upload
  }
  if (!text) return null

  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let obj: Record<string, unknown>
  try { obj = JSON.parse(cleaned) as Record<string, unknown> } catch { return null }

  const rawType = str(obj.doc_type)?.toLowerCase() ?? 'other'
  const docType = (DOC_TYPES.includes(rawType as VendorDocType) ? rawType : 'other') as VendorDocType

  const fields: Record<string, string> = {}
  if (obj.fields && typeof obj.fields === 'object') {
    for (const [k, v] of Object.entries(obj.fields as Record<string, unknown>)) {
      const s = str(v)
      if (s) fields[k] = mask ? maskValue(s) : s
    }
  }

  // COI entities (additional insured + certificate holder) — only for coi/insurance.
  let coi: VendorDocExtraction['coi']
  if (docType === 'coi' || docType === 'insurance') {
    const toEntity = (v: unknown): CoiEntity | null => {
      if (!v || typeof v !== 'object') return null
      const name = str((v as Record<string, unknown>).name)
      if (!name) return null
      return { name, address: str((v as Record<string, unknown>).address) }
    }
    const ai = Array.isArray(obj.additional_insured)
      ? (obj.additional_insured as unknown[]).map(toEntity).filter((e): e is CoiEntity => e !== null)
      : []
    coi = { additionalInsured: ai, certificateHolder: toEntity(obj.certificate_holder) }
  }

  return { docType, confidence: conf(obj.confidence), summary: str(obj.summary), fields, coi }
}

const DOC_TYPE_LABEL: Record<VendorDocType, string> = {
  w9: 'W-9', coi: 'COI', ach: 'ACH form', license: 'License',
  insurance: 'Insurance', estimate: 'Estimate', invoice: 'Invoice', other: 'Document',
}
export function vendorDocTypeLabel(t: VendorDocType | null | undefined): string {
  return t ? (DOC_TYPE_LABEL[t] ?? 'Document') : 'Document'
}
