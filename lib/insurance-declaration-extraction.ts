// =====================================================================
// lib/insurance-declaration-extraction.ts
//
// Read an association MASTER insurance declaration / policy with Claude
// and split it into PER-COVERAGE line items mapped to our POLICY_TYPES.
// One dec page often bundles many coverages (Property + GL + D&O + …) —
// this returns an array so the Insurance manager can pre-fill each row
// for staff to review before applying.
//
// Cost control: runs Haiku first; if its confidence is low (or it found
// nothing), auto-escalates the SAME document to Sonnet once. Mirrors the
// single-date extractor (lib/compliance-extraction.ts).
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { assertClaudeBudget } from '@/lib/anthropic-guard'
import { POLICY_TYPES, POLICY_TYPE_KEYS } from '@/lib/association-insurance'

const HAIKU  = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-4-20250514'
const ESCALATE_BELOW = 0.6   // overall confidence under this → retry on Sonnet

export interface ExtractedCoverage {
  policy_type:         string        // one of POLICY_TYPE_KEYS
  label:               string        // human label for the matched type
  carrier:             string | null
  policy_number:       string | null
  named_insured:       string | null
  effective_date:      string | null // YYYY-MM-DD
  expiration_date:     string | null // YYYY-MM-DD
  coverage_amount_usd: number | null
  confidence:          number        // 0..1 for THIS coverage
}
export interface DeclarationExtraction {
  coverages:  ExtractedCoverage[]
  confidence: number                 // overall 0..1
  note:       string | null
  model:      string                 // which model produced the kept result
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const conf = (v: unknown): number => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
}
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}
function isoDate(v: unknown): string | null {
  const s = str(v); if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function buildPrompt(): string {
  const catalog = POLICY_TYPES.map(p => `  "${p.key}" — ${p.label}`).join('\n')
  return `You are reading a MASTER insurance declaration / policy for a Florida HOA / condominium association. A single declaration page usually bundles SEVERAL coverages. Identify EVERY distinct coverage present and map each to one of these coverage keys:
${catalog}

Return a SINGLE JSON object and nothing else (no prose, no markdown fences):
{
  "coverages": [
    {
      "policy_type":         string,   // EXACTLY one of the keys above
      "carrier":             string|null,  // insurer for this coverage
      "policy_number":       string|null,
      "named_insured":       string|null,  // the association as named on the policy
      "effective_date":      string|null,  // ISO YYYY-MM-DD
      "expiration_date":     string|null,  // ISO YYYY-MM-DD
      "coverage_amount_usd": number|null,  // the limit FOR THIS coverage (number only, no $ or commas)
      "confidence":          number        // 0..1 for this single coverage
    }
  ],
  "confidence": number,   // 0..1 overall — how clearly this is an insurance dec page
  "note":       string|null   // one short line, e.g. "Package policy: Property + GL + D&O, all expire 2026-11-01"
}
Rules: Convert "5/1/2026" → "2026-05-01". Only include a coverage if it is actually present on the document — do NOT invent rows for coverages that aren't there. If a single carrier covers multiple keys with the same dates, still emit one row per key. Use null for any field not clearly stated. If the document is not insurance, return "coverages": [] and confidence below 0.3.`
}

function parse(text: string): { coverages: ExtractedCoverage[]; confidence: number; note: string | null } | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let obj: Record<string, unknown>
  try { obj = JSON.parse(cleaned) as Record<string, unknown> } catch { return null }
  const rawList = Array.isArray(obj.coverages) ? obj.coverages : []
  const coverages: ExtractedCoverage[] = []
  for (const r of rawList) {
    const rec = r as Record<string, unknown>
    const key = str(rec.policy_type) ?? ''
    if (!POLICY_TYPE_KEYS.has(key)) continue
    if (coverages.some(c => c.policy_type === key)) continue   // de-dupe by type
    coverages.push({
      policy_type:         key,
      label:               POLICY_TYPES.find(p => p.key === key)?.label ?? key,
      carrier:             str(rec.carrier),
      policy_number:       str(rec.policy_number),
      named_insured:       str(rec.named_insured),
      effective_date:      isoDate(rec.effective_date),
      expiration_date:     isoDate(rec.expiration_date),
      coverage_amount_usd: num(rec.coverage_amount_usd),
      confidence:          conf(rec.confidence),
    })
  }
  return { coverages, confidence: conf(obj.confidence), note: str(obj.note) }
}

async function runModel(model: string, block: unknown, prompt: string) {
  const anthropic = new Anthropic()
  const msg = await anthropic.messages.create({
    model, max_tokens: 1500,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: 'user', content: [block as any, { type: 'text', text: prompt }] }],
  })
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
  return text ? parse(text) : null
}

/** Read a declaration buffer (PDF or image) and return per-coverage rows.
 *  Haiku first; escalates to Sonnet once on low confidence / empty result. */
export async function extractInsuranceDeclaration(buf: Buffer, contentType?: string | null): Promise<DeclarationExtraction> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured')

  const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-' || (contentType ?? '').includes('pdf')
  const b64 = buf.toString('base64')
  const block = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaTypeFor(contentType), data: b64 } }
  const prompt = buildPrompt()

  await assertClaudeBudget('insurance-declaration')
  const first = await runModel(HAIKU, block, prompt)
  const firstOk = first && first.coverages.length > 0 && first.confidence >= ESCALATE_BELOW
  if (firstOk) return { ...first, model: HAIKU }

  // Escalate the same document to Sonnet once.
  await assertClaudeBudget('insurance-declaration-escalate')
  const second = await runModel(SONNET, block, prompt)
  if (second && (second.coverages.length > 0 || !first)) return { ...second, model: SONNET }
  return first ? { ...first, model: HAIKU } : { coverages: [], confidence: 0, note: null, model: SONNET }
}

function mediaTypeFor(contentType?: string | null): 'image/jpeg' | 'image/png' | 'image/webp' {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('png')) return 'image/png'
  if (ct.includes('webp')) return 'image/webp'
  return 'image/jpeg'
}
