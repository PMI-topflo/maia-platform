// =====================================================================
// lib/onboarding-extraction.ts
//
// "What they have today" — MAIA reads an association's own documents
// (the current Application Procedures package, the Rules & Regulations,
// the Declaration / By-Laws already filed under association_documents)
// and PROPOSES answers to the onboarding questionnaire's applications
// sections, each with the quoted passage it came from. Staff accept or
// reject each proposal on the questionnaire page; accepted ones are
// recorded as `existing_config` decisions and applied at once, so an
// association goes live with exactly its current requirements — no board
// meeting needed for that step (user direction, 2026-09-11: "put live the
// 25 associations with their current requirements" first, the board
// assessment after).
//
// Two stages:
//   ensureDocumentText()  a scanned PDF (no extractable text) is read by
//                         Claude page by page once and the transcription is
//                         saved back on the row, so it is never paid twice.
//   extractProposals()    one Sonnet call over all the text → proposals for
//                         every catalog item + checklist cell, plus "extras"
//                         (fees, deadlines, requirements the catalog has no
//                         slot for yet) so nothing the package says is lost.
//
// Nothing here writes a decision or a live setting — that is the review
// route's job (app/api/admin/onboarding/[code]/proposals).
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { assertClaudeBudget, logClaudeUsage } from '@/lib/anthropic-guard'
import { STORAGE_BUCKET } from '@/lib/association-documents'
import { CATALOG, isFactKey, type CatalogItem } from '@/lib/onboarding-catalog'
import { validateValue } from '@/lib/onboarding'
import { APPLICATION_TYPES } from '@/lib/intake-documents'

const SONNET = 'claude-sonnet-5'
const HAIKU = 'claude-haiku-4-5-20251001'
/** Below this many characters a PDF is treated as a scan and transcribed. */
const MIN_TEXT_CHARS = 800
/** Pages per transcription request; Claude reads up to 100 pages/request,
 *  30 keeps each response well inside max_tokens. */
const OCR_CHUNK_PAGES = 30
/** A 300-page Declaration is mostly plats and legal boilerplate; the
 *  leasing / sale / approval articles are what the questionnaire needs. */
const OCR_MAX_PAGES = 150
/** Per-document cap fed to the extraction call. */
const DOC_CHARS_CAP = 70_000
const CATEGORIES = ['application_forms', 'rules_regs', 'condo_docs'] as const
const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], string> = {
  application_forms: 'Current application package',
  rules_regs: 'Rules & Regulations',
  condo_docs: 'Declaration / By-Laws / Articles',
}

export type Confidence = 'high' | 'medium' | 'low'

export interface Proposal {
  key: string
  value: unknown
  quote: string
  source: string           // filename
  confidence: Confidence
  rationale: string
  /** Set when the model's value did not validate; shown, not acceptable as-is. */
  invalid?: string
}

export interface ExtraFinding {
  topic: string
  finding: string
  quote: string
  source: string
}

export interface ExtractionResult {
  proposals: Proposal[]
  extras: ExtraFinding[]
  todaySummary: string
  documents: { id: string; category: string; filename: string; chars: number; transcribed: boolean }[]
  model: string
}

interface DocRow { id: string; category: string; filename: string; storage_path: string | null; extracted_text: string | null; mime_type: string | null }

// ── Stage 1: make sure every document has readable text ─────────────────

async function transcribePdf(buf: Buffer, label: string): Promise<string> {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true })
  const total = Math.min(src.getPageCount(), OCR_MAX_PAGES)
  const anthropic = new Anthropic()
  const parts: string[] = []
  for (let start = 0; start < total; start += OCR_CHUNK_PAGES) {
    const end = Math.min(start + OCR_CHUNK_PAGES, total)
    const chunk = await PDFDocument.create()
    const pages = await chunk.copyPages(src, Array.from({ length: end - start }, (_, i) => start + i))
    for (const p of pages) chunk.addPage(p)
    const b64 = Buffer.from(await chunk.save()).toString('base64')
    await assertClaudeBudget('onboarding-ocr')
    const msg = await anthropic.messages.create({
      model: HAIKU, max_tokens: 16_000,
      messages: [{
        role: 'user',
        content: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } } as any,
          { type: 'text', text: `Transcribe every word of this document (pages ${start + 1}–${end} of "${label}") as plain text. Keep headings, article and section numbers, numbered lists and paragraph breaks exactly as printed. Do not summarise, do not skip pages, do not add commentary. Where a page is blank or a plat/drawing, write "[page ${'N'}: no text]".` },
        ],
      }],
    })
    logClaudeUsage('onboarding-ocr', msg)
    parts.push(`\n\n=== ${label} — pages ${start + 1}–${end} ===\n` + msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join(''))
  }
  if (src.getPageCount() > OCR_MAX_PAGES) parts.push(`\n\n[${label}: ${src.getPageCount() - OCR_MAX_PAGES} further pages not transcribed]`)
  return parts.join('').trim()
}

/** Returns the row's text, transcribing (and persisting) a scan once. */
export async function ensureDocumentText(doc: DocRow): Promise<{ text: string; transcribed: boolean }> {
  const have = String(doc.extracted_text ?? '')
  if (have.length >= MIN_TEXT_CHARS || !doc.storage_path) return { text: have, transcribed: false }
  const { data: blob, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(doc.storage_path)
  if (error || !blob) return { text: have, transcribed: false }
  const buf = Buffer.from(await blob.arrayBuffer())
  const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-'
  if (!isPdf) return { text: have, transcribed: false }
  const text = await transcribePdf(buf, doc.filename)
  if (text.length < MIN_TEXT_CHARS) return { text: have, transcribed: false }
  await supabaseAdmin.from('association_documents').update({ extracted_text: text, updated_at: new Date().toISOString() }).eq('id', doc.id)
  return { text, transcribed: true }
}

// ── Stage 2: the extraction call ────────────────────────────────────────

function describeItem(i: CatalogItem): string {
  const parts = [`- key: ${i.key}`, `label: ${i.label}`]
  if (i.help) parts.push(`help: ${i.help}`)
  switch (i.kind) {
    case 'boolean': parts.push('value: true | false'); break
    case 'number': parts.push(`value: number${i.suffix ? ` (${i.suffix})` : ''}`); break
    case 'select': parts.push(`value: one of ${i.options?.map(o => `"${o.value}" (${o.label})`).join(', ')}`); break
    case 'text': parts.push('value: string'); break
    case 'rule': parts.push(i.ruleNumeric
      ? `value: {"enabled": true|false, "value": number${i.suffix ? ` (${i.suffix})` : ''}, "enforcement": "block"|"warn"}`
      : 'value: {"enabled": true|false, "enforcement": "block"|"warn"}'); break
    case 'committee': parts.push('(skip — people, not documents)'); break
  }
  return parts.join(' · ')
}

function buildPrompt(assocName: string, checklist: { application_type: string; doc_key: string; label: string; required: boolean; active: boolean }[], docs: { category: string; filename: string; text: string }[]): string {
  const items = CATALOG.filter(i => !isFactKey(i.key) && i.kind !== 'committee' && i.key !== 'board.reminder_cadence')
  const byType = new Map<string, typeof checklist>()
  for (const r of checklist) { const a = byType.get(r.application_type) ?? []; a.push(r); byType.set(r.application_type, a) }
  const checklistText = APPLICATION_TYPES.map(t => {
    const rows = byType.get(t.key) ?? []
    return `${t.key} (${t.label}):\n` + rows.map(r => `  - checklist.${t.key}.${r.doc_key} — "${r.label}" (today: ${!r.active ? 'off' : r.required ? 'required' : 'optional'})`).join('\n')
  }).join('\n')
  const docsText = docs.map(d => `\n\n########## ${CATEGORY_LABEL[d.category as keyof typeof CATEGORY_LABEL] ?? d.category} — file "${d.filename}" ##########\n${d.text.slice(0, DOC_CHARS_CAP)}${d.text.length > DOC_CHARS_CAP ? '\n[truncated]' : ''}`).join('')

  return `You are MAIA, the property-management assistant of PMI Top Florida Properties. You are reading the documents of the association "${assocName}" to record WHAT THEY REQUIRE TODAY for sale and lease applications, so the association can go live in MAIA with exactly its current requirements.

Answer ONLY from the documents below. Every proposal must carry the verbatim passage it rests on ("quote") and the file it came from ("source"). If the documents are silent on an item, do not propose it. Never invent a value.

## Items (propose a value for each one the documents answer)
${items.map(describeItem).join('\n')}

Guidance:
- apps.enabled: true when the package describes an application / approval process for sales or leases at all.
- apps.screening_provider: "maia_checkr" when the package says applicants are screened online through PMI / Top Florida Properties / a link, or a background check fee is collected by the management; "tenant_evaluation" only when Tenant Evaluation is named.
- apps.interview_lease / apps.interview_purchase: true only when an interview with the board (or a committee) is required before approval for that transaction type. If the document says "interview" without distinguishing, propose both.
- rules.*: enabled=true with enforcement "block" when the document states an absolute prohibition or minimum; "warn" when it is discretionary or subject to board approval. Numbers as plain numbers (12 months → 365 days for min_lease_days; "one year" waiting period → 1 year; percentages as the number only).
- board.decision_window_days: the number of days the board has to decide, in calendar days; if the document says business days, still give the number and say so in rationale.
- board.required_signatures: how many board signatures / approvals the document requires; propose only if stated.

## Document checklist (propose "required", "optional" or "off" for each cell the documents settle; leave out cells they do not mention)
${checklistText}
Map the package's language onto these doc_keys (e.g. "copy of driver's license or passport" → drivers_license; "vehicle registration" → car_registration; "copy of lease" → signed_lease; "HO-6 / owner's insurance" → property_insurance; "renter's insurance" → renters_insurance; "background check / credit report" → background_credit; "rules acknowledgment / rules knowledge signed" → governing_docs_ack; "pet form / pet registration" → pet_registration). If the package requires a document that has NO doc_key here, report it under "extras" instead.

## Extras
Anything else the package or rules require that the items above cannot hold: application / processing / move-in fees and amounts, deposits, notice periods (e.g. "30 days before occupancy"), where the application is sent, required forms with no doc_key, occupancy limits, age restrictions, vehicle / parking rules for applicants, pet limits, estoppel instructions. One entry each, with quote and source.

## Output
Return ONLY a JSON object, no prose, no code fence:
{
  "today_summary": "3–6 sentences, plain English, describing how this association handles applications today according to its documents",
  "proposals": [ { "key": "...", "value": ..., "quote": "...", "source": "filename", "confidence": "high"|"medium"|"low", "rationale": "one sentence" } ],
  "extras": [ { "topic": "short label", "finding": "one or two sentences", "quote": "...", "source": "filename" } ]
}
confidence: "high" when the document states it plainly; "medium" when inferred from wording; "low" when it is a reasonable reading of an ambiguous passage.

## Documents
${docsText}`
}

function parseJson(text: string): Record<string, unknown> | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(t) } catch { /* fall through */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) } catch { return null } }
  return null
}

export async function extractProposals(codeRaw: string): Promise<ExtractionResult> {
  const code = codeRaw.trim().toUpperCase()
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured')

  const [{ data: assoc }, { data: docRows }, { data: checklistRows }] = await Promise.all([
    supabaseAdmin.from('associations').select('association_name, legal_name').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('association_documents').select('id, category, filename, storage_path, extracted_text, mime_type').eq('association_code', code).in('category', [...CATEGORIES]).order('created_at', { ascending: false }),
    supabaseAdmin.from('association_intake_documents').select('application_type, doc_key, label, required, active').eq('association_code', code).order('sort_order'),
  ])
  if (!assoc) throw new Error(`Unknown association ${code}`)
  const rows = (docRows ?? []) as DocRow[]
  if (!rows.length) throw new Error('No application package, rules or governing documents are on file for this association — upload them on the Documents page first.')

  // Newest file per category+filename wins; a duplicate upload is skipped.
  const seen = new Set<string>()
  const docs: { id: string; category: string; filename: string; text: string; transcribed: boolean }[] = []
  for (const r of rows) {
    const k = `${r.category}|${r.filename.toLowerCase()}`
    if (seen.has(k)) continue
    seen.add(k)
    const { text, transcribed } = await ensureDocumentText(r)
    if (text.trim().length) docs.push({ id: r.id, category: r.category, filename: r.filename, text, transcribed })
  }
  if (!docs.length) throw new Error('None of the documents on file has readable text.')
  // Application package first — it is the most specific source.
  const order = { application_forms: 0, rules_regs: 1, condo_docs: 2 } as Record<string, number>
  docs.sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9))

  const checklist = (checklistRows ?? []).map(r => ({ application_type: String(r.application_type), doc_key: String(r.doc_key), label: String(r.label), required: !!r.required, active: !!r.active }))
  const prompt = buildPrompt(String(assoc.legal_name || assoc.association_name || code), checklist, docs)

  await assertClaudeBudget('onboarding-extraction')
  const anthropic = new Anthropic()
  const msg = await anthropic.messages.create({ model: SONNET, max_tokens: 12_000, messages: [{ role: 'user', content: prompt }] })
  logClaudeUsage('onboarding-extraction', msg)
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('')
  const json = parseJson(text)
  if (!json) throw new Error('MAIA returned no readable proposals — try again.')

  const validKeys = new Set(CATALOG.map(i => i.key))
  const checklistKeys = new Set(checklist.map(r => `checklist.${r.application_type}.${r.doc_key}`))
  const proposals: Proposal[] = []
  for (const raw of Array.isArray(json.proposals) ? json.proposals as Record<string, unknown>[] : []) {
    const key = String(raw.key ?? '')
    if (!validKeys.has(key) && !checklistKeys.has(key)) continue
    const p: Proposal = {
      key, value: raw.value, quote: String(raw.quote ?? '').trim(), source: String(raw.source ?? '').trim(),
      confidence: raw.confidence === 'high' || raw.confidence === 'low' ? raw.confidence : 'medium',
      rationale: String(raw.rationale ?? '').trim(),
    }
    try { p.value = validateValue(key, raw.value) } catch (e) { p.invalid = e instanceof Error ? e.message : String(e) }
    proposals.push(p)
  }
  const extras: ExtraFinding[] = (Array.isArray(json.extras) ? json.extras as Record<string, unknown>[] : [])
    .map(x => ({ topic: String(x.topic ?? '').trim(), finding: String(x.finding ?? '').trim(), quote: String(x.quote ?? '').trim(), source: String(x.source ?? '').trim() }))
    .filter(x => x.topic && x.finding)

  return {
    proposals, extras,
    todaySummary: String(json.today_summary ?? '').trim(),
    documents: docs.map(d => ({ id: d.id, category: d.category, filename: d.filename, chars: d.text.length, transcribed: d.transcribed })),
    model: SONNET,
  }
}
