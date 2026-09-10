// =====================================================================
// lib/onboarding.ts
//
// Association onboarding questionnaire — server side.
//
//   getOnboardingState(code)   everything the questionnaire page needs:
//                              the session, the latest decision per item,
//                              the live values today, board members, and
//                              the association's checklist rows.
//   recordDecisions(...)       append decision rows (never updates).
//   adoptSession(...)          stamp the meeting, then apply every
//                              unapplied decision to its live setting.
//
// Decisions are the audit trail; the live tables stay the source of truth
// at runtime. applyDecision() is the ONLY place a decision touches a live
// table, and it is idempotent — re-applying the same decision writes the
// same value again.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  CATALOG, catalogItem, isChecklistKey, CHECKLIST_KEY_RE, isFactKey, statuteFor,
  type ChecklistState,
} from '@/lib/onboarding-catalog'
import { APPLICATION_TYPES, type ApplicationType } from '@/lib/intake-documents'

export type DecisionSource = 'meeting' | 'email_consent' | 'staff_confirmed' | 'existing_config'
export type DecisionRole = 'board' | 'staff'

export interface OnboardingDecision {
  id: string
  item_key: string
  value: unknown
  note: string | null
  decided_by: string
  decided_by_role: DecisionRole
  source: DecisionSource
  source_ref: string | null
  decided_at: string
  recorded_by: string | null
  supersedes_id: string | null
  applied_at: string | null
  apply_error: string | null
}

export interface OnboardingSession {
  association_code: string
  status: 'draft' | 'adopted'
  current_section: string | null
  meeting_date: string | null
  motion_by: string | null
  vote: string | null
  minutes_path: string | null
  started_by: string | null
  adopted_by: string | null
  adopted_at: string | null
  updated_at: string
}

export interface BoardMemberLite { id: string; name: string; email: string; role: string | null }

/** One association_intake_documents row, INCLUDING inactive ones — the grid
 *  must be able to turn an "Off" document back on, and the runtime reader
 *  (getIntakeChecklistAll) deliberately hides inactive rows. */
export interface ChecklistRowLite { doc_key: string; label: string; required: boolean; note: string | null; sort_order: number; active: boolean }

export interface LiveSnapshot {
  association: {
    legal_name: string | null
    association_type: string | null
    service_type: string | null
    florida_statute: string | null
    principal_address: string | null
    city: string | null
    state: string | null
    zip: string | null
    sunbiz_document_number: string | null
    fei_ein_number: string | null
    screening_provider: string | null
    requires_interview_lease: boolean | null
    requires_interview_purchase: boolean | null
  }
  hideApplicationForms: boolean
  rules: Record<string, { value: unknown; enforcement: string; active: boolean; label: string }>
  boardConfig: { required_signatures: number | null; reminder_cadence: string | null; decision_window_days: number | null }
  committee: { board_member_id: string; member_type: string }[]
}

export interface OnboardingState {
  code: string
  name: string
  session: OnboardingSession
  /** Latest decision per item_key. */
  current: Record<string, OnboardingDecision>
  /** Every decision ever recorded, newest first. */
  history: OnboardingDecision[]
  live: LiveSnapshot
  boardMembers: BoardMemberLite[]
  checklist: Record<ApplicationType, ChecklistRowLite[]>
  applicationTypes: typeof APPLICATION_TYPES
  catalog: typeof CATALOG
}

const DECISION_COLS = 'id, item_key, value, note, decided_by, decided_by_role, source, source_ref, decided_at, recorded_by, supersedes_id, applied_at, apply_error'

function asDecision(r: Record<string, unknown>): OnboardingDecision {
  return {
    id: String(r.id), item_key: String(r.item_key), value: r.value, note: (r.note as string | null) ?? null,
    decided_by: String(r.decided_by), decided_by_role: r.decided_by_role as DecisionRole, source: r.source as DecisionSource,
    source_ref: (r.source_ref as string | null) ?? null, decided_at: String(r.decided_at), recorded_by: (r.recorded_by as string | null) ?? null,
    supersedes_id: (r.supersedes_id as string | null) ?? null, applied_at: (r.applied_at as string | null) ?? null, apply_error: (r.apply_error as string | null) ?? null,
  }
}

// ── State ──────────────────────────────────────────────────────────────

async function ensureSession(code: string, startedBy: string | null): Promise<OnboardingSession> {
  const { data } = await supabaseAdmin.from('association_onboarding_sessions').select('*').eq('association_code', code).maybeSingle()
  if (data) return data as OnboardingSession
  const { data: created, error } = await supabaseAdmin.from('association_onboarding_sessions')
    .insert({ association_code: code, started_by: startedBy }).select('*').single()
  if (error) throw new Error(`Could not start onboarding session: ${error.message}`)
  return created as OnboardingSession
}

export async function getOnboardingState(codeRaw: string, startedBy: string | null): Promise<OnboardingState | null> {
  const code = codeRaw.trim().toUpperCase()
  const { data: assoc } = await supabaseAdmin.from('associations')
    .select('association_code, association_name, legal_name, association_type, service_type, florida_statute, principal_address, city, state, zip, sunbiz_document_number, fei_ein_number, screening_provider, requires_interview_lease, requires_interview_purchase')
    .eq('association_code', code).maybeSingle()
  if (!assoc) return null

  const [session, decisionsRes, configRes, rulesRes, boardCfgRes, committeeRes, membersRes, checklistRes] = await Promise.all([
    ensureSession(code, startedBy),
    supabaseAdmin.from('association_onboarding_decisions').select(DECISION_COLS).eq('association_code', code).order('decided_at', { ascending: false }),
    supabaseAdmin.from('association_config').select('hide_application_forms').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('association_application_rules').select('rule_key, value, enforcement, active, label').eq('association_code', code),
    supabaseAdmin.from('board_approval_config').select('required_signatures, reminder_cadence, decision_window_days').eq('association_code', code).eq('purpose', 'application').maybeSingle(),
    supabaseAdmin.from('board_approval_members').select('board_member_id, member_type').eq('association_code', code).eq('purpose', 'application'),
    supabaseAdmin.from('association_board_members').select('id, name, email, role').eq('association_code', code).eq('active', true).order('sort_order'),
    supabaseAdmin.from('association_intake_documents').select('application_type, doc_key, label, required, note, sort_order, active').eq('association_code', code).order('sort_order'),
  ])
  for (const [label, res] of [['decisions', decisionsRes], ['association_config', configRes], ['rules', rulesRes], ['board_approval_config', boardCfgRes], ['board_approval_members', committeeRes], ['board_members', membersRes], ['intake_documents', checklistRes]] as const) {
    if (res.error) console.error(`[onboarding] getOnboardingState(${code}) ${label} query failed:`, res.error.message)
  }

  const history = (decisionsRes.data ?? []).map(r => asDecision(r as Record<string, unknown>))
  const current: Record<string, OnboardingDecision> = {}
  for (const d of history) if (!current[d.item_key]) current[d.item_key] = d   // newest first → first wins

  const checklist = { lease: [], purchase: [], additional_occupant: [], lease_renewal: [] } as Record<ApplicationType, ChecklistRowLite[]>
  for (const r of checklistRes.data ?? []) {
    const t = String(r.application_type) as ApplicationType
    if (!(t in checklist)) continue
    checklist[t].push({ doc_key: String(r.doc_key), label: String(r.label), required: !!r.required, note: (r.note as string | null) ?? null, sort_order: Number(r.sort_order ?? 0), active: !!r.active })
  }

  const rules: LiveSnapshot['rules'] = {}
  for (const r of rulesRes.data ?? []) rules[String(r.rule_key)] = { value: r.value, enforcement: String(r.enforcement), active: !!r.active, label: String(r.label) }

  return {
    code,
    name: String(assoc.association_name ?? code),
    session,
    current,
    history,
    live: {
      association: {
        legal_name: assoc.legal_name ?? null, association_type: assoc.association_type ?? null, service_type: assoc.service_type ?? null,
        florida_statute: assoc.florida_statute ?? null, principal_address: assoc.principal_address ?? null, city: assoc.city ?? null,
        state: assoc.state ?? null, zip: assoc.zip ?? null, sunbiz_document_number: assoc.sunbiz_document_number ?? null,
        fei_ein_number: assoc.fei_ein_number ?? null, screening_provider: assoc.screening_provider ?? null,
        requires_interview_lease: assoc.requires_interview_lease ?? null, requires_interview_purchase: assoc.requires_interview_purchase ?? null,
      },
      hideApplicationForms: !!configRes.data?.hide_application_forms,
      rules,
      boardConfig: {
        required_signatures: boardCfgRes.data?.required_signatures ?? null,
        reminder_cadence: boardCfgRes.data?.reminder_cadence ?? null,
        decision_window_days: boardCfgRes.data?.decision_window_days ?? null,
      },
      committee: (committeeRes.data ?? []).map(c => ({ board_member_id: String(c.board_member_id), member_type: String(c.member_type) })),
    },
    boardMembers: (membersRes.data ?? []).map(m => ({ id: String(m.id), name: String(m.name), email: String(m.email), role: (m.role as string | null) ?? null })),
    checklist,
    applicationTypes: APPLICATION_TYPES,
    catalog: CATALOG,
  }
}

// ── Validation ─────────────────────────────────────────────────────────

export interface RuleValue { enabled: boolean; value?: number; enforcement: 'block' | 'warn' }
export interface CommitteeValue { members: { board_member_id: string; member_type: 'decider' | 'voter' }[] }

/** Normalises and validates a submitted value for an item. Throws on a bad value. */
export function validateValue(key: string, raw: unknown): unknown {
  if (isChecklistKey(key)) {
    if (raw !== 'required' && raw !== 'optional' && raw !== 'off') throw new Error(`${key}: value must be required, optional or off`)
    return raw as ChecklistState
  }
  const item = catalogItem(key)
  if (!item) throw new Error(`Unknown item "${key}"`)
  switch (item.kind) {
    case 'boolean':
      if (typeof raw !== 'boolean') throw new Error(`${key}: expected true/false`)
      return raw
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n) || n < 0) throw new Error(`${key}: expected a number`)
      return n
    }
    case 'select': {
      const v = String(raw ?? '')
      if (!item.options?.some(o => o.value === v)) throw new Error(`${key}: "${v}" is not one of the allowed options`)
      return v
    }
    case 'text': {
      const s = String(raw ?? '').trim()
      return s.length ? s : null
    }
    case 'rule': {
      const o = (raw ?? {}) as Partial<RuleValue>
      const enabled = !!o.enabled
      const enforcement = o.enforcement === 'block' ? 'block' : 'warn'
      if (item.ruleNumeric) {
        const n = Number(o.value)
        if (enabled && (!Number.isFinite(n) || n <= 0)) throw new Error(`${key}: a number is required when the rule is on`)
        return { enabled, value: enabled ? n : undefined, enforcement } as RuleValue
      }
      return { enabled, enforcement } as RuleValue
    }
    case 'committee': {
      const o = (raw ?? {}) as Partial<CommitteeValue>
      const members = Array.isArray(o.members) ? o.members : []
      const out: CommitteeValue['members'] = []
      for (const m of members) {
        if (!m || typeof m.board_member_id !== 'string') throw new Error(`${key}: bad member`)
        if (m.member_type !== 'decider' && m.member_type !== 'voter') throw new Error(`${key}: member_type must be decider or voter`)
        out.push({ board_member_id: m.board_member_id, member_type: m.member_type })
      }
      return { members: out } as CommitteeValue
    }
  }
}

// ── Recording ──────────────────────────────────────────────────────────

export interface Attribution {
  decidedBy: string          // display: 'Walter Giles (President)' or staff name
  role: DecisionRole
  source: DecisionSource
  sourceRef: string | null
}

export async function recordDecisions(
  codeRaw: string,
  items: { key: string; value: unknown; note?: string | null }[],
  attribution: Attribution,
  recordedBy: string,
): Promise<OnboardingDecision[]> {
  const code = codeRaw.trim().toUpperCase()
  if (!items.length) return []

  // Facts are always staff-confirmed; board decisions must carry a board source.
  const rows = []
  for (const it of items) {
    const value = validateValue(it.key, it.value)
    const fact = isFactKey(it.key)
    const att: Attribution = fact
      ? { decidedBy: recordedBy, role: 'staff', source: 'staff_confirmed', sourceRef: null }
      : attribution
    if (!fact && att.role === 'board' && att.source !== 'meeting' && att.source !== 'email_consent') {
      throw new Error('A board decision needs a source: a board meeting or an email consent')
    }
    if (!fact && att.role === 'board' && !att.sourceRef) throw new Error('A board decision needs the meeting date or the consent email date')
    if (!fact && att.role === 'staff' && att.source !== 'existing_config') {
      throw new Error('Only a board member can decide this item; staff may record an existing configuration or a board decision on the board’s behalf')
    }
    const { data: prev } = await supabaseAdmin.from('association_onboarding_decisions').select('id')
      .eq('association_code', code).eq('item_key', it.key).order('decided_at', { ascending: false }).limit(1).maybeSingle()
    rows.push({
      association_code: code, item_key: it.key, value: value as never, note: it.note?.trim() || null,
      decided_by: att.decidedBy, decided_by_role: att.role, source: att.source, source_ref: att.sourceRef,
      recorded_by: recordedBy, supersedes_id: prev?.id ?? null,
    })
  }
  const { data, error } = await supabaseAdmin.from('association_onboarding_decisions').insert(rows).select(DECISION_COLS)
  if (error) throw new Error(error.message)
  // A new decision after adoption reopens the session — it is an amendment awaiting its own adoption.
  await supabaseAdmin.from('association_onboarding_sessions')
    .update({ status: 'draft', updated_at: new Date().toISOString() }).eq('association_code', code)
  return (data ?? []).map(r => asDecision(r as Record<string, unknown>))
}

// ── Applying to live settings ──────────────────────────────────────────

async function updateAssociation(code: string, patch: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from('associations').update(patch).eq('association_code', code)
  if (error) throw new Error(error.message)
}

async function upsertBoardConfig(code: string, patch: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from('board_approval_config')
    .upsert({ association_code: code, purpose: 'application', ...patch }, { onConflict: 'association_code,purpose' })
  if (error) throw new Error(error.message)
}

/** Writes ONE decision to the live table it targets. Idempotent. */
export async function applyDecision(code: string, key: string, value: unknown): Promise<void> {
  if (isChecklistKey(key)) {
    const [, type, docKey] = key.match(CHECKLIST_KEY_RE)!
    const state = value as ChecklistState
    const patch = state === 'off' ? { active: false } : { active: true, required: state === 'required' }
    const { data, error } = await supabaseAdmin.from('association_intake_documents')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('association_code', code).eq('application_type', type).eq('doc_key', docKey).select('id')
    if (error) throw new Error(error.message)
    if (!data?.length) throw new Error(`No checklist row ${type}/${docKey} for ${code}`)
    return
  }
  const item = catalogItem(key)
  if (!item) throw new Error(`Unknown item "${key}"`)

  switch (key) {
    case 'identity.legal_name':             return updateAssociation(code, { legal_name: value })
    case 'identity.association_type':       return updateAssociation(code, { association_type: value, florida_statute: statuteFor(value as string) })
    case 'identity.service_type':           return updateAssociation(code, { service_type: value })
    case 'identity.principal_address':      return updateAssociation(code, { principal_address: value })
    case 'identity.city':                   return updateAssociation(code, { city: value })
    case 'identity.state':                  return updateAssociation(code, { state: typeof value === 'string' ? value.toUpperCase().slice(0, 2) : null })
    case 'identity.zip':                    return updateAssociation(code, { zip: value })
    case 'identity.sunbiz_document_number': return updateAssociation(code, { sunbiz_document_number: value })
    case 'identity.fei_ein_number':         return updateAssociation(code, { fei_ein_number: value })

    case 'apps.enabled': {
      const { error } = await supabaseAdmin.from('association_config')
        .upsert({ association_code: code, hide_application_forms: !(value as boolean), updated_at: new Date().toISOString() }, { onConflict: 'association_code' })
      if (error) throw new Error(error.message)
      return
    }
    case 'apps.screening_provider': return updateAssociation(code, { screening_provider: value })
    case 'apps.interview_lease':    return updateAssociation(code, { requires_interview_lease: value })
    case 'apps.interview_purchase': return updateAssociation(code, { requires_interview_purchase: value })

    case 'board.required_signatures':  return upsertBoardConfig(code, { required_signatures: Number(value) })
    case 'board.reminder_cadence':     return upsertBoardConfig(code, { reminder_cadence: value })
    case 'board.decision_window_days': return upsertBoardConfig(code, { decision_window_days: Number(value) })
    case 'board.committee': {
      const v = value as CommitteeValue
      const { error: delErr } = await supabaseAdmin.from('board_approval_members').delete().eq('association_code', code).eq('purpose', 'application')
      if (delErr) throw new Error(delErr.message)
      if (v.members.length) {
        const { error } = await supabaseAdmin.from('board_approval_members')
          .insert(v.members.map(m => ({ association_code: code, purpose: 'application', board_member_id: m.board_member_id, member_type: m.member_type })))
        if (error) throw new Error(error.message)
      }
      return
    }
  }

  if (item.kind === 'rule') {
    const ruleKey = key.replace(/^rules\./, '')
    const v = value as RuleValue
    if (!v.enabled) {
      const { error } = await supabaseAdmin.from('association_application_rules')
        .update({ active: false, updated_at: new Date().toISOString() }).eq('association_code', code).eq('rule_key', ruleKey)
      if (error) throw new Error(error.message)
      return
    }
    const ruleValue = item.ruleNumeric ? v.value : true
    const label = (item.ruleLabel ?? item.label).replace('{value}', String(v.value ?? ''))
    const { error } = await supabaseAdmin.from('association_application_rules').upsert({
      association_code: code, rule_key: ruleKey, value: ruleValue as never, label, enforcement: v.enforcement,
      active: true, created_by: 'onboarding_questionnaire', updated_at: new Date().toISOString(),
    }, { onConflict: 'association_code,rule_key' })
    if (error) throw new Error(error.message)
    return
  }

  throw new Error(`No live target wired for "${key}"`)
}

export interface AdoptInput { meetingDate: string; motionBy: string | null; vote: string | null; adoptedBy: string }
export interface AdoptResult { applied: number; failed: { key: string; error: string }[]; adopted: boolean }

/** Records the adoption and applies every unapplied CURRENT decision.
 *  Superseded decisions are marked applied too (with a note) so they never
 *  fire later. A failure on one item is recorded on that row and does not
 *  stop the others; the session becomes 'adopted' only when nothing failed. */
export async function adoptSession(codeRaw: string, input: AdoptInput): Promise<AdoptResult> {
  const code = codeRaw.trim().toUpperCase()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.meetingDate)) throw new Error('A meeting date is required')

  const { data: rows, error } = await supabaseAdmin.from('association_onboarding_decisions').select(DECISION_COLS)
    .eq('association_code', code).is('applied_at', null).order('decided_at', { ascending: false })
  if (error) throw new Error(error.message)
  const unapplied = (rows ?? []).map(r => asDecision(r as Record<string, unknown>))
  if (!unapplied.length) throw new Error('Nothing to adopt — no decisions are waiting to be applied')

  const now = new Date().toISOString()
  const seen = new Set<string>()
  const failed: { key: string; error: string }[] = []
  let applied = 0
  for (const d of unapplied) {              // newest first: the first row per key is the current one
    if (seen.has(d.item_key)) {
      await supabaseAdmin.from('association_onboarding_decisions').update({ applied_at: now, apply_error: 'superseded before adoption' }).eq('id', d.id)
      continue
    }
    seen.add(d.item_key)
    try {
      await applyDecision(code, d.item_key, d.value)
      await supabaseAdmin.from('association_onboarding_decisions').update({ applied_at: now, apply_error: null }).eq('id', d.id)
      applied++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failed.push({ key: d.item_key, error: msg })
      await supabaseAdmin.from('association_onboarding_decisions').update({ apply_error: msg }).eq('id', d.id)
    }
  }

  const adopted = failed.length === 0
  const { error: sErr } = await supabaseAdmin.from('association_onboarding_sessions').update({
    meeting_date: input.meetingDate, motion_by: input.motionBy, vote: input.vote,
    status: adopted ? 'adopted' : 'draft', adopted_by: input.adoptedBy, adopted_at: adopted ? now : null, updated_at: now,
  }).eq('association_code', code)
  if (sErr) throw new Error(sErr.message)
  return { applied, failed, adopted }
}

/** Compact status for the Association Hub card. */
export async function getOnboardingSummary(codeRaw: string): Promise<{ status: 'not_started' | 'draft' | 'adopted'; decided: number; pending: number; adoptedAt: string | null }> {
  const code = codeRaw.trim().toUpperCase()
  const [{ data: s }, { data: rows }] = await Promise.all([
    supabaseAdmin.from('association_onboarding_sessions').select('status, adopted_at').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('association_onboarding_decisions').select('item_key, applied_at').eq('association_code', code),
  ])
  const keys = new Set<string>(), pendingKeys = new Set<string>()
  for (const r of rows ?? []) { keys.add(String(r.item_key)); if (!r.applied_at) pendingKeys.add(String(r.item_key)) }
  return { status: s ? (s.status as 'draft' | 'adopted') : 'not_started', decided: keys.size, pending: pendingKeys.size, adoptedAt: (s?.adopted_at as string | null) ?? null }
}
