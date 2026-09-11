// =====================================================================
// lib/onboarding-proposals.ts
//
// Persistence + review for "What they have today" (see
// lib/onboarding-extraction.ts for the reading itself).
//
//   runExtraction(code, by)      read the documents, supersede the previous
//                                pending proposals, store the new run.
//   listProposals(code)          the latest run + its proposals / extras.
//   reviewProposals(code, …, by) accept → existing_config decision, applied
//                                at once; reject → left as it is today.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { extractProposals, type Confidence } from '@/lib/onboarding-extraction'
import { recordDecisions, applyDecision, validateValue } from '@/lib/onboarding'

export interface ProposalRow {
  id: string
  kind: 'proposal' | 'extra'
  item_key: string | null
  proposed_value: unknown
  invalid_reason: string | null
  topic: string | null
  finding: string | null
  quote: string | null
  source: string | null
  confidence: Confidence
  rationale: string | null
  status: 'pending' | 'accepted' | 'rejected' | 'superseded'
  decision_id: string | null
  reviewed_by: string | null
  reviewed_at: string | null
}

export interface ExtractionRun {
  id: string
  model: string
  today_summary: string | null
  documents: { id: string; category: string; filename: string; chars: number; transcribed: boolean }[]
  created_by: string | null
  created_at: string
}

export interface ProposalsView { run: ExtractionRun | null; proposals: ProposalRow[]; extras: ProposalRow[] }

const COLS = 'id, kind, item_key, proposed_value, invalid_reason, topic, finding, quote, source, confidence, rationale, status, decision_id, reviewed_by, reviewed_at'

export async function runExtraction(codeRaw: string, by: string): Promise<ProposalsView> {
  const code = codeRaw.trim().toUpperCase()
  const result = await extractProposals(code)

  const { data: run, error } = await supabaseAdmin.from('association_onboarding_extractions')
    .insert({ association_code: code, model: result.model, today_summary: result.todaySummary, documents: result.documents, created_by: by })
    .select('id, model, today_summary, documents, created_by, created_at').single()
  if (error || !run) throw new Error(`Could not save the extraction: ${error?.message ?? 'unknown'}`)

  // A new run replaces whatever was still waiting; accepted / rejected rows stay as history.
  await supabaseAdmin.from('association_onboarding_proposals').update({ status: 'superseded' }).eq('association_code', code).eq('status', 'pending')

  const rows = [
    ...result.proposals.map(p => ({
      association_code: code, extraction_id: run.id, kind: 'proposal', item_key: p.key, proposed_value: p.value as never,
      invalid_reason: p.invalid ?? null, quote: p.quote, source: p.source, confidence: p.confidence, rationale: p.rationale,
    })),
    ...result.extras.map(x => ({
      association_code: code, extraction_id: run.id, kind: 'extra', item_key: null, proposed_value: null,
      invalid_reason: null, topic: x.topic, finding: x.finding, quote: x.quote, source: x.source, confidence: 'medium', rationale: null,
    })),
  ]
  if (rows.length) {
    const { error: insErr } = await supabaseAdmin.from('association_onboarding_proposals').insert(rows)
    if (insErr) throw new Error(`Could not save the proposals: ${insErr.message}`)
  }
  return listProposals(code)
}

export async function listProposals(codeRaw: string): Promise<ProposalsView> {
  const code = codeRaw.trim().toUpperCase()
  const { data: run } = await supabaseAdmin.from('association_onboarding_extractions')
    .select('id, model, today_summary, documents, created_by, created_at').eq('association_code', code)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!run) return { run: null, proposals: [], extras: [] }
  const { data } = await supabaseAdmin.from('association_onboarding_proposals').select(COLS)
    .eq('extraction_id', run.id).order('created_at', { ascending: true })
  const all = (data ?? []) as unknown as ProposalRow[]
  return {
    run: run as unknown as ExtractionRun,
    proposals: all.filter(r => r.kind === 'proposal'),
    extras: all.filter(r => r.kind === 'extra'),
  }
}

export interface ReviewInput { accept: { id: string; value?: unknown }[]; reject: string[] }
export interface ReviewResult { accepted: number; rejected: number; failed: { id: string; key: string; error: string }[] }

/** Accepted proposals become existing_config decisions under the reviewing
 *  staff member's name and are applied to the live setting immediately —
 *  they describe what the association already requires, so there is
 *  nothing for a board to adopt. A value edited on the review screen is
 *  validated the same way as a questionnaire answer. */
export async function reviewProposals(codeRaw: string, input: ReviewInput, by: string): Promise<ReviewResult> {
  const code = codeRaw.trim().toUpperCase()
  const now = new Date().toISOString()
  const ids = [...input.accept.map(a => a.id), ...input.reject]
  if (!ids.length) return { accepted: 0, rejected: 0, failed: [] }
  const { data } = await supabaseAdmin.from('association_onboarding_proposals').select(COLS)
    .eq('association_code', code).in('id', ids).eq('status', 'pending')
  const rows = new Map(((data ?? []) as unknown as ProposalRow[]).map(r => [r.id, r]))

  const failed: ReviewResult['failed'] = []
  let accepted = 0, rejected = 0

  for (const id of input.reject) {
    if (!rows.has(id)) continue
    await supabaseAdmin.from('association_onboarding_proposals').update({ status: 'rejected', reviewed_by: by, reviewed_at: now }).eq('id', id)
    rejected++
  }

  const { data: run } = await supabaseAdmin.from('association_onboarding_extractions').select('created_at').eq('association_code', code).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const sourceRef = `MAIA read the filed documents on ${run ? new Date(String(run.created_at)).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }) : 'file'}`

  for (const a of input.accept) {
    const row = rows.get(a.id)
    if (!row || row.kind !== 'proposal' || !row.item_key) continue
    const key = row.item_key
    try {
      const value = validateValue(key, a.value !== undefined ? a.value : row.proposed_value)
      const [decision] = await recordDecisions(code, [{ key, value, note: row.quote ? `"${row.quote.slice(0, 400)}" — ${row.source ?? ''}` : null }],
        { decidedBy: by, role: 'staff', source: 'existing_config', sourceRef }, by)
      await applyDecision(code, key, value)
      await supabaseAdmin.from('association_onboarding_decisions').update({ applied_at: now, apply_error: null }).eq('id', decision.id)
      await supabaseAdmin.from('association_onboarding_proposals').update({ status: 'accepted', decision_id: decision.id, reviewed_by: by, reviewed_at: now }).eq('id', a.id)
      accepted++
    } catch (e) {
      failed.push({ id: a.id, key, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { accepted, rejected, failed }
}
