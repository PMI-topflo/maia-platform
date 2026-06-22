// =====================================================================
// lib/maia-knowledge.ts
//
// "Teach MAIA" knowledge layer. Staff upload PDFs / images / text in the
// /admin/teach studio; MAIA reads them, proposes what she understood, and
// staff approve or correct. Approved rows are injected into MAIA's prompts
// — scoped per association AND per persona — alongside the existing
// association_faq, association_documents, and maia_skills blocks.
//
// This module owns:
//   • the canonical persona list used by the studio + injection
//   • buildKnowledgePromptBlock()  — injection (read path, hot)
//   • understandContent() / refineKnowledge() — the Claude teach loop
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type KnowledgeStatus = 'needs_review' | 'approved' | 'rejected'
export type KnowledgeSource = 'text' | 'pdf' | 'image' | 'chat'

export interface KnowledgeRow {
  id:                 string
  association_code:   string | null
  persona:            string | null
  account_number:     string | null
  unit_number:        string | null
  title:              string
  source_kind:        KnowledgeSource
  source_filename:    string | null
  source_path:        string | null
  raw_extract:        string | null
  understood_summary: string | null
  approved_body:      string | null
  status:             KnowledgeStatus
  created_by:         string | null
  reviewed_by:        string | null
  created_at:         string
  updated_at:         string
}

// The personas a piece of knowledge can be scoped to. The keys MUST match
// the `persona` values the chat route receives (PERSONA_PROMPTS keys in
// app/api/chat/route.ts) so injection is a simple equality match. `null`
// scope = "all personas".
export const TEACH_PERSONAS = [
  { key: 'homeowner', label: 'Owner / Homeowner' },
  { key: 'tenant',    label: 'Tenant' },
  { key: 'board',     label: 'Board Member' },
  { key: 'vendor',    label: 'Vendor' },
  { key: 'buyer',     label: 'Buyer' },
  { key: 'agent',     label: 'Realtor / Agent' },
] as const

export type TeachPersonaKey = (typeof TEACH_PERSONAS)[number]['key']

export function personaLabel(key: string | null | undefined): string {
  if (!key) return 'All personas'
  return TEACH_PERSONAS.find(p => p.key === key)?.label ?? key
}

// Total characters of taught knowledge we inline into a single system
// prompt. ~4 chars/token → ~7.5k tokens. Sits alongside the skills (55k
// chars) and document (120k chars) budgets, so keep it modest.
const MAX_KNOWLEDGE_CHARS = 30_000

// MAIA's teach/understanding model. Haiku 4.5 is capable enough for
// reading docs + summarizing, and keeps the cost profile in line with the
// chat route which uses the same model.
const TEACH_MODEL = 'claude-haiku-4-5-20251001'

// ── Injection (hot read path) ────────────────────────────────────────
// Pull approved knowledge that applies to this (association, persona) and
// return a system-prompt block. Empty string when nothing applies, so the
// caller can interpolate it unconditionally.
export async function buildKnowledgePromptBlock(
  associationCode: string | null | undefined,
  persona: string | null | undefined,
  accountNumber?: string | null,
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('maia_knowledge')
    .select('title, approved_body, association_code, persona, account_number')
    .eq('status', 'approved')
    .order('updated_at', { ascending: false })
    .limit(200)

  if (error || !data?.length) return ''

  // (association global OR matches) AND (persona global OR matches) AND
  // (unit/account global OR matches the caller's account). Unit-scoped
  // knowledge only surfaces when we know who's asking (logged-in resident).
  const relevant = data.filter(r =>
    (r.association_code == null || r.association_code === associationCode) &&
    (r.persona == null || r.persona === persona) &&
    (r.account_number == null || r.account_number === accountNumber),
  )
  if (!relevant.length) return ''

  let total = 0
  const blocks: string[] = []
  for (const r of relevant) {
    const body = (r.approved_body ?? '').trim()
    if (!body) continue
    const scope = r.persona ? ` (for ${personaLabel(r.persona)})` : ''
    const block = `• ${r.title}${scope}\n${body}`
    if (total + block.length > MAX_KNOWLEDGE_CHARS) break
    blocks.push(block)
    total += block.length + 2
  }
  if (!blocks.length) return ''

  return `\n\nTAUGHT KNOWLEDGE (curated and approved by PMI staff — this is authoritative for this community; answer directly from it and prefer it over general assumptions):\n${blocks.join('\n\n')}`
}

// ── The teach loop (Claude) ──────────────────────────────────────────
interface UnderstoodResult {
  understood: string   // plain "here's what I understood" for staff to confirm
  knowledge:  string   // clean canonical knowledge to store + inject
  title:      string   // a short title MAIA proposes for this item
}

function clampJson(text: string): string {
  // Models occasionally wrap JSON in ```json fences or prose. Grab the
  // outermost object.
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text
}

function scopeLine(associationName: string | null, persona: string | null): string {
  const who = persona ? personaLabel(persona) : 'all residents/contacts'
  const where = associationName ? `the ${associationName} community` : 'all PMI-managed communities'
  return `You are being taught knowledge to use when answering ${who} at ${where}.`
}

const client = new Anthropic()

// Read raw source text and propose what MAIA understood + the canonical
// knowledge to remember. Best-effort — throws only on hard API failure.
export async function understandContent(
  rawText: string,
  opts: { associationName: string | null; persona: string | null; hint?: string },
): Promise<UnderstoodResult> {
  const system = `You are MAIA's knowledge editor for PMI Top Florida Properties (HOA/condo management in South Florida). ${scopeLine(opts.associationName, opts.persona)}

PMI staff have given you a SOURCE to learn from. Produce a JSON object with exactly these keys:
- "title": a short (3-8 word) title for this knowledge item.
- "understood": a plain-language summary, as 3-6 short bullet lines (use "• "), of what you understood from the source — so staff can confirm you read it correctly. Be specific (names, hours, amounts, rules). If something is ambiguous, say so.
- "knowledge": the clean, factual knowledge you will remember and use when answering. Concise, only what the source supports, no filler, no greetings. Write it as you would want to recall it.

Return ONLY the JSON object — no prose, no code fences.`

  const userText = opts.hint
    ? `Context note from staff: ${opts.hint}\n\nSOURCE:\n${rawText}`
    : `SOURCE:\n${rawText}`

  const resp = await client.messages.create({
    model: TEACH_MODEL,
    max_tokens: 1200,
    system,
    messages: [{ role: 'user', content: userText.slice(0, 200_000) }],
  })
  const text = resp.content[0]?.type === 'text' ? resp.content[0].text : '{}'
  return parseUnderstood(text, rawText)
}

// Apply a staff correction to the current understanding/knowledge.
export async function refineKnowledge(
  current: { understood: string | null; knowledge: string | null; title: string },
  correction: string,
  opts: { associationName: string | null; persona: string | null },
): Promise<UnderstoodResult> {
  const system = `You are MAIA's knowledge editor for PMI Top Florida Properties. ${scopeLine(opts.associationName, opts.persona)}

Here is the current knowledge item:
TITLE: ${current.title}
WHAT YOU UNDERSTOOD:
${current.understood ?? '(none)'}
CANONICAL KNOWLEDGE:
${current.knowledge ?? '(none)'}

A staff member is correcting or refining you. Apply their feedback and return a JSON object with keys "title", "understood" (3-6 "• " bullet lines), and "knowledge" (clean canonical text). Keep everything still supported; only change what the correction implies. Return ONLY the JSON object.`

  const resp = await client.messages.create({
    model: TEACH_MODEL,
    max_tokens: 1200,
    system,
    messages: [{ role: 'user', content: `Staff correction: ${correction}` }],
  })
  const text = resp.content[0]?.type === 'text' ? resp.content[0].text : '{}'
  return parseUnderstood(text, current.knowledge ?? '')
}

function parseUnderstood(modelText: string, fallbackKnowledge: string): UnderstoodResult {
  try {
    const obj = JSON.parse(clampJson(modelText)) as Partial<UnderstoodResult>
    return {
      title:      (obj.title ?? '').toString().trim() || 'Untitled knowledge',
      understood: (obj.understood ?? '').toString().trim() || '• (no summary produced)',
      knowledge:  (obj.knowledge ?? '').toString().trim() || fallbackKnowledge.slice(0, 4000),
    }
  } catch {
    // Model didn't return clean JSON — degrade gracefully so the upload
    // still produces a reviewable item instead of failing.
    return {
      title:      'Untitled knowledge',
      understood: modelText.trim().slice(0, 1500) || '• (no summary produced)',
      knowledge:  fallbackKnowledge.slice(0, 4000),
    }
  }
}
