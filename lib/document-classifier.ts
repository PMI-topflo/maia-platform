// =====================================================================
// lib/document-classifier.ts
//
// Read ANY association/unit document with Claude and classify it. A single
// PDF often BUNDLES several policies (an ACORD packet = General Liability +
// Property + Umbrella sections, each its own form). So we return an ARRAY of
// detected compliance items, each with the PAGE RANGE of that policy in the
// PDF — the intake route splits the packet into one file per policy and files
// each separately.
//
// Association + unit scope. Haiku first; auto-escalates to Sonnet once on low
// confidence / no items found.
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { assertClaudeBudget } from '@/lib/anthropic-guard'
import { COMPLIANCE_TAXONOMY } from '@/lib/compliance-taxonomy'

const HAIKU  = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-5'
const ESCALATE_BELOW = 0.6

export interface AssociationRef {
  code: string; name: string
  address?: string | null; city?: string | null; state?: string | null; zip?: string | null
  aliases?: string[]
}

export interface DetectedItem {
  scope:           'association' | 'unit'
  unit_seen:       string | null   // owner/unit identifier text for unit docs
  category:        string | null
  item_key:        string | null
  doc_type:        string | null   // human label for this policy/section
  effective_date:  string | null
  expiration_date: string | null
  page_start:      number | null   // 1-based, inclusive — this policy's pages
  page_end:        number | null
  confidence:      number
}

export interface DocumentClassification {
  association_code: string | null   // matched code from the provided list, or null
  association_seen: string | null   // the name/address read on the document
  items:            DetectedItem[]  // every distinct policy/coverage found
  confidence:       number          // overall
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
function pageNum(v: unknown, pageCount: number): number | null {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseInt(v, 10) : NaN)
  return Number.isInteger(n) && n >= 1 && n <= pageCount ? n : null
}

const VALID_ITEMS = new Set(COMPLIANCE_TAXONOMY.flatMap(c => c.items.map(i => i.key)))
const VALID_CATS  = new Set(COMPLIANCE_TAXONOMY.map(c => c.key))
const ITEM_SCOPE  = new Map(COMPLIANCE_TAXONOMY.flatMap(c => c.items.map(i => [i.key, c.scope] as const)))

function buildPrompt(assocs: AssociationRef[], pageCount: number, contextHint?: string | null): string {
  const hint = contextHint ? `\nFILING CONTEXT (a hint only — the document itself wins): this file came from "${contextHint}". Folders are often named by association and document type; use it to help pick the association and item when the document is ambiguous.\n` : ''
  const assocList = assocs.map(a => {
    const addr = [a.address, [a.city, a.state, a.zip].filter(Boolean).join(' ').trim()].filter(Boolean).join(', ')
    const al = a.aliases && a.aliases.length ? ` (aka: ${a.aliases.join('; ')})` : ''
    return `  ${a.code} — ${a.name}${al}${addr ? ` — ${addr}` : ''}`
  }).join('\n')
  const taxonomy = COMPLIANCE_TAXONOMY
    .map(c => `${c.key} (${c.label}) [scope: ${c.scope}]:\n` + c.items.map(i => `    ${i.key} — ${i.label}`).join('\n'))
    .join('\n')
  return `You are filing documents for a Florida HOA / condominium management company. Read this ${pageCount}-page document and classify it.
${hint}
KNOWN ASSOCIATIONS — match by the association NAME, an alias, OR the PROPERTY ADDRESS (street number + city + ZIP) printed anywhere on the document, and return the CODE. The name is often NOT printed; when it isn't, identify the association by its address. Each entry is "CODE — name (aka aliases) — address":
${assocList}

IMPORTANT: a single PDF often BUNDLES MULTIPLE policies or coverages. For example an insurance ACORD packet typically contains separate sections — General Liability, Commercial Property, Umbrella/Excess, Crime, Workers Comp — each on its own page(s)/form. A lease packet may include the lease plus an HO-6 certificate. Identify EVERY distinct compliance item the document satisfies and return one entry per item, with the 1-based PAGE RANGE of that item's pages so we can split the packet into a separate file per policy.

Common insurance sections → the item to use (capture EVERY one present, even a single-page section — do NOT skip Crime):
  General Liability (ACORD 126) → insurance.general_liability
  Commercial Property / building (ACORD 140) → insurance.property
  Umbrella / Excess Liability (ACORD 131) → insurance.umbrella
  Crime / Fidelity / Employee Dishonesty (ACORD 146/5) → insurance.fidelity
  Workers Compensation (ACORD 130) → insurance.workers_comp
  Equipment Breakdown / Inland Marine → insurance.equipment
  Flood → insurance.flood ; Windstorm → insurance.windstorm ; Cyber → insurance.cyber
  D&O → insurance.do ; a combined Certificate of Insurance → insurance.coi
(ACORD 125 is the common application cover — not itself a coverage; skip it.)

A document/section is either ASSOCIATION-wide (insurance, Sunbiz, tax, audits) or UNIT-level (one owner/unit — lease, HO-6, registrations).

COMPLIANCE CATEGORIES and their items (each tagged association or unit — pick the single best item per policy):
${taxonomy}

Return a SINGLE JSON object and nothing else (no prose, no markdown fences):
{
  "association_code": string or null,   // EXACT code from the list; null if you cannot tell
  "association_seen": string or null,   // association name / address text you read
  "confidence":       number,           // 0..1 overall
  "summary":          string or null,   // one short line describing the whole document
  "items": [                            // ONE entry per distinct policy/coverage/item
    {
      "scope":           "association" or "unit",
      "unit_seen":       string or null,   // for UNIT items: EVERYTHING that identifies the owner/unit — the OWNER/insured/landlord name (PREFER the owner over any tenant), the unit/apartment number, the property street address + ZIP, and any account #
      "category":        string or null,   // category key
      "item_key":        string or null,   // item key from that category
      "doc_type":        string or null,   // short label, e.g. "General Liability (ACORD 126)", "Property (ACORD 140)", "Umbrella"
      "effective_date":  string or null,   // ISO YYYY-MM-DD for THIS policy
      "expiration_date": string or null,   // ISO YYYY-MM-DD for THIS policy
      "page_start":      number or null,   // 1-based first page of this policy in the PDF
      "page_end":        number or null,   // 1-based last page (inclusive)
      "confidence":      number            // 0..1 for this item
    }
  ]
}
Rules: Convert "5/1/2026" → "2026-05-01". Only return an association_code that EXACTLY matches one in the list — else null (do NOT guess). Return EVERY distinct policy as its own item (do not merge two coverages into one). Page numbers are 1-based and must be within 1..${pageCount}. If the whole document is a single policy, return one item spanning all pages. Use null for anything not clearly present.`
}

function parseItem(o: Record<string, unknown>, pageCount: number): DetectedItem | null {
  const itemKey = str(o.item_key)
  const valid = itemKey && VALID_ITEMS.has(itemKey) ? itemKey : null
  const category = str(o.category)
  const scopeRaw = str(o.scope)
  const scope: 'association' | 'unit' = valid
    ? (ITEM_SCOPE.get(valid) ?? 'association')
    : (scopeRaw === 'unit' ? 'unit' : 'association')
  return {
    scope,
    unit_seen:       str(o.unit_seen),
    category:        category && VALID_CATS.has(category) ? category : (valid ? valid.split('.')[0] : null),
    item_key:        valid,
    doc_type:        str(o.doc_type),
    effective_date:  isoDate(o.effective_date),
    expiration_date: isoDate(o.expiration_date),
    page_start:      pageNum(o.page_start, pageCount),
    page_end:        pageNum(o.page_end, pageCount),
    confidence:      conf(o.confidence),
  }
}

function parse(text: string, pageCount: number): Omit<DocumentClassification, 'model'> | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let o: Record<string, unknown>
  try { o = JSON.parse(cleaned) as Record<string, unknown> } catch { return null }
  const rawItems = Array.isArray(o.items) ? o.items : []
  const items = rawItems
    .map(r => parseItem(r as Record<string, unknown>, pageCount))
    .filter((i): i is DetectedItem => i !== null && i.item_key !== null)
  return {
    association_code: str(o.association_code),
    association_seen: str(o.association_seen),
    items,
    confidence:       conf(o.confidence),
    summary:          str(o.summary),
  }
}

async function runModel(model: string, block: unknown, prompt: string, pageCount: number) {
  const anthropic = new Anthropic()
  const msg = await anthropic.messages.create({
    model, max_tokens: 1500,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: 'user', content: [block as any, { type: 'text', text: prompt }] }],
  })
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
  return text ? parse(text, pageCount) : null
}

/** Classify one document buffer against the known associations + catalog,
 *  returning every policy it bundles with page ranges. Haiku → Sonnet once. */
export async function classifyDocument(buf: Buffer, contentType: string | null, assocs: AssociationRef[], pageCount = 1, contextHint: string | null = null): Promise<DocumentClassification> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured')

  const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-' || (contentType ?? '').includes('pdf')
  const b64 = buf.toString('base64')
  const block = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaTypeFor(contentType), data: b64 } }
  const prompt = buildPrompt(assocs, pageCount, contextHint)

  // Multi-page PDFs are usually multi-coverage packets where catching EVERY
  // section matters — use Sonnet directly for recall. Single-page docs start on
  // Haiku and escalate only when unsure.
  const packet = isPdf && pageCount > 2
  if (packet) {
    await assertClaudeBudget('document-classify-packet')
    const s = await runModel(SONNET, block, prompt, pageCount)
    if (s && s.items.length > 0) return { ...s, model: SONNET }
  }

  await assertClaudeBudget('document-classify')
  const first = await runModel(HAIKU, block, prompt, pageCount)
  if (first && first.confidence >= ESCALATE_BELOW && first.items.length > 0) return { ...first, model: HAIKU }

  await assertClaudeBudget('document-classify-escalate')
  const second = await runModel(SONNET, block, prompt, pageCount)
  if (second && second.items.length > 0) return { ...second, model: SONNET }
  return first
    ? { ...first, model: HAIKU }
    : { association_code: null, association_seen: null, items: [], confidence: 0, summary: null, model: SONNET }
}

function mediaTypeFor(contentType?: string | null): 'image/jpeg' | 'image/png' | 'image/webp' {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('png')) return 'image/png'
  if (ct.includes('webp')) return 'image/webp'
  return 'image/jpeg'
}
