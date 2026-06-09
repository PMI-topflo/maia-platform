// =====================================================================
// lib/document-classifier.ts
//
// Read ANY association document with Claude and classify it: which
// association it belongs to, which compliance item it satisfies, and the
// key dates. Powers the MAIA Document Inbox — Jonathan bulk-uploads, MAIA
// suggests where each files, he reviews/applies.
//
// Association scope only (v1). Haiku first; auto-escalates the same doc to
// Sonnet once on low confidence. Mirrors the insurance/COI extractors.
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { assertClaudeBudget } from '@/lib/anthropic-guard'
import { categoriesForScope, COMPLIANCE_TAXONOMY } from '@/lib/compliance-taxonomy'

const HAIKU  = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-4-20250514'
const ESCALATE_BELOW = 0.6

export interface AssociationRef { code: string; name: string }

export interface DocumentClassification {
  association_code: string | null   // matched code from the provided list, or null when unsure
  association_seen: string | null   // the name/address MAIA read on the document
  category:         string | null   // compliance category key
  item_key:         string | null   // compliance item key
  doc_type:         string | null   // human label
  effective_date:   string | null
  expiration_date:  string | null
  confidence:       number
  summary:          string | null
  model:            string
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

const VALID_ITEMS = new Set(COMPLIANCE_TAXONOMY.flatMap(c => c.items.map(i => i.key)))
const VALID_CATS  = new Set(categoriesForScope('association').map(c => c.key))

function buildPrompt(assocs: AssociationRef[]): string {
  const assocList = assocs.map(a => `  ${a.code} — ${a.name}`).join('\n')
  const taxonomy = categoriesForScope('association')
    .map(c => `${c.key} (${c.label}):\n` + c.items.map(i => `    ${i.key} — ${i.label}`).join('\n'))
    .join('\n')
  return `You are filing a document for a Florida HOA / condominium management company. Read the document and classify it.

KNOWN ASSOCIATIONS (match by the association name or property address printed on the document — return the CODE):
${assocList}

COMPLIANCE CATEGORIES and their items (pick the single best item this document satisfies):
${taxonomy}

Return a SINGLE JSON object and nothing else (no prose, no markdown fences):
{
  "association_code": string or null,   // EXACT code from the list above; null if you cannot tell which association
  "association_seen": string or null,   // the association name / address text you read
  "category":         string or null,   // category key from the list
  "item_key":         string or null,   // item key from that category
  "doc_type":         string or null,   // short human label, e.g. "SIRS report", "Master property dec page", "Fire alarm inspection"
  "effective_date":   string or null,   // ISO YYYY-MM-DD — issue / effective / inspection date
  "expiration_date":  string or null,   // ISO YYYY-MM-DD — expiration / next-due / renewal date if stated
  "confidence":       number,           // 0..1 overall
  "summary":          string or null    // one short line of what this is
}
Rules: Convert "5/1/2026" → "2026-05-01". Only return an association_code that EXACTLY matches one in the list — if the name/address doesn't clearly match one, return null (do NOT guess). Pick the most specific item_key. Use null for anything not clearly present.`
}

function parse(text: string): Omit<DocumentClassification, 'model'> | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let o: Record<string, unknown>
  try { o = JSON.parse(cleaned) as Record<string, unknown> } catch { return null }
  const category = str(o.category)
  const itemKey  = str(o.item_key)
  return {
    association_code: str(o.association_code),
    association_seen: str(o.association_seen),
    category:         category && VALID_CATS.has(category) ? category : null,
    item_key:         itemKey && VALID_ITEMS.has(itemKey) ? itemKey : null,
    doc_type:         str(o.doc_type),
    effective_date:   isoDate(o.effective_date),
    expiration_date:  isoDate(o.expiration_date),
    confidence:       conf(o.confidence),
    summary:          str(o.summary),
  }
}

async function runModel(model: string, block: unknown, prompt: string) {
  const anthropic = new Anthropic()
  const msg = await anthropic.messages.create({
    model, max_tokens: 600,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: 'user', content: [block as any, { type: 'text', text: prompt }] }],
  })
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
  return text ? parse(text) : null
}

/** Classify one document buffer (PDF or image) against the known
 *  associations + compliance catalog. Haiku → Sonnet escalation once. */
export async function classifyDocument(buf: Buffer, contentType: string | null, assocs: AssociationRef[]): Promise<DocumentClassification> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured')

  const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-' || (contentType ?? '').includes('pdf')
  const b64 = buf.toString('base64')
  const block = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaTypeFor(contentType), data: b64 } }
  const prompt = buildPrompt(assocs)

  await assertClaudeBudget('document-classify')
  const first = await runModel(HAIKU, block, prompt)
  if (first && first.confidence >= ESCALATE_BELOW && first.item_key) return { ...first, model: HAIKU }

  await assertClaudeBudget('document-classify-escalate')
  const second = await runModel(SONNET, block, prompt)
  if (second) return { ...second, model: SONNET }
  return first
    ? { ...first, model: HAIKU }
    : { association_code: null, association_seen: null, category: null, item_key: null, doc_type: null, effective_date: null, expiration_date: null, confidence: 0, summary: null, model: SONNET }
}

function mediaTypeFor(contentType?: string | null): 'image/jpeg' | 'image/png' | 'image/webp' {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('png')) return 'image/png'
  if (ct.includes('webp')) return 'image/webp'
  return 'image/jpeg'
}
