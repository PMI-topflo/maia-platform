// =====================================================================
// lib/document-validation.ts
//
// The "smart upload gate": read an uploaded file with Claude and decide
// whether it's the RIGHT, VALID document for where it's being uploaded —
// returning a human verdict ("Approved as a current COI" / "This is a
// W-9, not a COI — upload a better version"). Powers a reusable upload
// component so every upload button in MAIA can validate before accepting.
//
// Each upload point passes a spec_key (what it expects). Haiku first;
// auto-escalates the same doc to Sonnet once on low confidence.
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { assertClaudeBudget } from '@/lib/anthropic-guard'

const HAIKU  = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-5'
const ESCALATE_BELOW = 0.6

export interface DocSpec { key: string; label: string; expects: string; expiry?: boolean }

// What each upload point expects. Add a spec here, reference its key from
// the upload, and the gate validates against `expects`.
export const DOC_SPECS: Record<string, DocSpec> = {
  generic:               { key: 'generic',               label: 'Document',                     expects: 'any document — just identify what it is and whether it is legible' },
  vendor_coi:            { key: 'vendor_coi',            label: 'Certificate of Insurance',     expects: 'an ACORD Certificate of Insurance (COI) listing the vendor as the insured, with current general-liability and/or workers-comp coverage', expiry: true },
  vendor_w9:             { key: 'vendor_w9',             label: 'W-9',                          expects: 'an IRS Form W-9 (Request for Taxpayer Identification Number and Certification), filled in for the vendor' },
  vendor_license:        { key: 'vendor_license',        label: 'License',                      expects: 'a current contractor / professional / business license for the vendor', expiry: true },
  vendor_ach:            { key: 'vendor_ach',            label: 'ACH / banking form',           expects: 'a bank ACH authorization or voided check / direct-deposit form for the vendor' },
  applicant_id:          { key: 'applicant_id',          label: 'Government ID',                expects: 'a government-issued photo ID (driver license, passport, or state ID) — legible and not expired', expiry: true },
  applicant_income:      { key: 'applicant_income',      label: 'Proof of income',              expects: 'proof of income — a recent pay stub, employer letter, tax return, or bank statement evidencing income' },
  applicant_lease:       { key: 'applicant_lease',       label: 'Lease / purchase agreement',   expects: 'a signed lease agreement or purchase contract for the unit' },
  insurance_master:      { key: 'insurance_master',      label: 'Association master insurance', expects: "the association/HOA master insurance declaration (named insured is the association/condominium corporation)", expiry: true },
  insurance_ho6:         { key: 'insurance_ho6',         label: 'Unit HO-6 insurance',          expects: 'a unit-owner HO-6 condominium insurance declaration (named insured is an individual unit owner)', expiry: true },
  governing_declaration: { key: 'governing_declaration', label: 'Declaration of Condominium',   expects: 'the recorded Declaration of Condominium / CC&Rs / Covenants for the association' },
  governing_rules:       { key: 'governing_rules',       label: 'Rules & Regulations',          expects: 'the association Rules & Regulations document' },
  safety_milestone:      { key: 'safety_milestone',      label: 'Milestone inspection',         expects: 'a Phase 1 or Phase 2 Milestone structural inspection report by an engineer', expiry: true },
  safety_sirs:           { key: 'safety_sirs',           label: 'SIRS / reserve study',         expects: 'a Structural Integrity Reserve Study (SIRS) / reserve study report', expiry: true },
}
export function docSpec(key: string): DocSpec { return DOC_SPECS[key] ?? DOC_SPECS.generic }

export type Verdict = 'approved' | 'wrong_type' | 'unreadable' | 'expired'
export interface ValidationResult {
  verdict:         Verdict
  approved:        boolean
  identified_as:   string | null   // what MAIA thinks it actually is
  reason:          string          // short human sentence
  expiration_date: string | null
  confidence:      number
  model:           string
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const conf = (v: unknown): number => { const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0 }
function isoDate(v: unknown): string | null { const s = str(v); if (!s) return null; if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) }

function buildPrompt(spec: DocSpec): string {
  return `You are the upload gate for a Florida HOA / condo management system. A user is uploading a file where the system EXPECTS: ${spec.expects}.

Read the document and judge it. Return a SINGLE JSON object and nothing else (no prose, no markdown fences):
{
  "identified_as":   string|null,   // what the document ACTUALLY is, in plain words
  "matches_expected": boolean,       // true only if it is the expected document type above
  "legible":         boolean,        // false if too blurry / cut off / unreadable to rely on
  "expiration_date": string|null,    // ISO YYYY-MM-DD if the document carries one
  "confidence":      number,         // 0..1
  "reason":          string          // ONE short sentence a staffer/vendor reads, e.g. "Valid COI, GL current through 2026-11-01" or "This is a W-9, not a Certificate of Insurance"
}
Rules: Convert "5/1/2026" → "2026-05-01". Judge ONLY against the expected type. If it's a different document, matches_expected=false and say what it actually is. If you cannot read it, legible=false.`
}

function parse(text: string, spec: DocSpec, now: Date): Omit<ValidationResult, 'model'> | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let o: Record<string, unknown>
  try { o = JSON.parse(cleaned) as Record<string, unknown> } catch { return null }
  const identified_as = str(o.identified_as)
  const expiration_date = isoDate(o.expiration_date)
  const legible = o.legible !== false
  const matches = o.matches_expected === true
  const expired = !!(spec.expiry && expiration_date && new Date(expiration_date) < new Date(now.toISOString().slice(0, 10)))

  let verdict: Verdict
  if (!legible) verdict = 'unreadable'
  else if (!matches) verdict = 'wrong_type'
  else if (expired) verdict = 'expired'
  else verdict = 'approved'

  const fallbackReason =
    verdict === 'approved'   ? `Approved as ${identified_as ?? spec.label}${expiration_date ? ` (valid through ${expiration_date})` : ''}.`
    : verdict === 'wrong_type' ? `This looks like ${identified_as ?? 'a different document'}, not a ${spec.label}. Upload the correct document.`
    : verdict === 'expired'    ? `This ${spec.label} is expired${expiration_date ? ` (${expiration_date})` : ''}. Upload a current one.`
    :                            `Couldn't read this clearly. Upload a better-quality version.`

  return { verdict, approved: verdict === 'approved', identified_as, reason: str(o.reason) ?? fallbackReason, expiration_date, confidence: conf(o.confidence) }
}

async function runModel(model: string, block: unknown, prompt: string, spec: DocSpec, now: Date) {
  const anthropic = new Anthropic()
  const msg = await anthropic.messages.create({
    model, max_tokens: 500,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: 'user', content: [block as any, { type: 'text', text: prompt }] }],
  })
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
  return text ? parse(text, spec, now) : null
}

/** Validate a document buffer against an expected spec. Haiku → Sonnet once. */
export async function validateDocument(buf: Buffer, contentType: string | null, specKey: string, now = new Date()): Promise<ValidationResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured')
  const spec = docSpec(specKey)
  const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-' || (contentType ?? '').includes('pdf')
  const b64 = buf.toString('base64')
  const block = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaTypeFor(contentType), data: b64 } }
  const prompt = buildPrompt(spec)

  await assertClaudeBudget('document-validate')
  const first = await runModel(HAIKU, block, prompt, spec, now)
  if (first && first.confidence >= ESCALATE_BELOW) return { ...first, model: HAIKU }

  await assertClaudeBudget('document-validate-escalate')
  const second = await runModel(SONNET, block, prompt, spec, now)
  if (second) return { ...second, model: SONNET }
  return first ? { ...first, model: HAIKU } : { verdict: 'unreadable', approved: false, identified_as: null, reason: "Couldn't read this clearly. Upload a better-quality version.", expiration_date: null, confidence: 0, model: SONNET }
}

function mediaTypeFor(contentType?: string | null): 'image/jpeg' | 'image/png' | 'image/webp' {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('png')) return 'image/png'
  if (ct.includes('webp')) return 'image/webp'
  return 'image/jpeg'
}
