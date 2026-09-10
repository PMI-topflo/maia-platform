'use client'

// =====================================================================
// OnboardingClient — the questionnaire UI (applications scope).
//
// Left rail: sections. Main: one section at a time, one row per item.
// Each row shows the control, the value currently live (if any), and the
// decision stamp once one is recorded. Recording needs an attribution
// (top bar): which board member decided, from which meeting or consent
// email — or "existing configuration" to snapshot what already runs.
// Identity facts are stamped as staff-confirmed regardless.
//
// The last section is the decision register + adoption. Adoption is the
// only action that writes to live settings.
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { SECTIONS, SOURCE_LABEL, isChecklistKey, sectionOf, type CatalogItem, type ChecklistState, type OnboardingSection } from '@/lib/onboarding-catalog'
import type { OnboardingState, OnboardingDecision, RuleValue, CommitteeValue } from '@/lib/onboarding'

type Panel = OnboardingSection | 'review'
const PANELS: { key: Panel; number: string; title: string }[] = [
  ...SECTIONS.map(s => ({ key: s.key as Panel, number: String(s.number), title: s.title })),
  { key: 'review', number: '6', title: 'Review & adopt' },
]

function fmtET(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : d
}

interface Attribution { kind: 'board' | 'existing_config'; boardMemberId: string; source: 'meeting' | 'email_consent'; sourceRef: string }

const inputCls = 'rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-[#f26a1b] focus:outline-none'
const btnCls = 'rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-[#f26a1b] hover:text-[#f26a1b] disabled:opacity-50'
const primaryCls = 'rounded bg-[#f26a1b] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d85a14] disabled:opacity-50'

export default function OnboardingClient({ code, name, staffName }: { code: string; name: string; staffName: string }) {
  const [state, setState] = useState<OnboardingState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>('identity')
  const [att, setAtt] = useState<Attribution>({ kind: 'board', boardMemberId: '', source: 'meeting', sourceRef: '' })
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoadError(null)
    const r = await fetch(`/api/admin/onboarding/${code}`, { cache: 'no-store' })
    const j = await r.json()
    if (!r.ok) { setLoadError(j.error ?? 'Could not load'); return }
    setState(j as OnboardingState)
  }, [code])
  useEffect(() => { void load() }, [load])

  // Save one or more decisions; merges the returned rows into state.
  const save = useCallback(async (items: { key: string; value: unknown; note?: string | null }[]) => {
    const keys = items.map(i => i.key)
    setBusy(b => new Set([...b, ...keys]))
    setErrors(e => { const n = { ...e }; for (const k of keys) delete n[k]; return n })
    try {
      const r = await fetch(`/api/admin/onboarding/${code}/decisions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions: items, attribution: att }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Could not save')
      const returned = j.decisions as OnboardingDecision[]
      setState(s => {
        if (!s) return s
        const current = { ...s.current }
        for (const d of returned) current[d.item_key] = d
        return { ...s, current, history: [...returned, ...s.history], session: { ...s.session, status: 'draft' } }
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErrors(er => { const n = { ...er }; for (const k of keys) n[k] = msg; return n })
    } finally {
      setBusy(b => { const n = new Set(b); for (const k of keys) n.delete(k); return n })
    }
  }, [code, att])

  const counts = useMemo(() => {
    if (!state) return {} as Record<Panel, { decided: number; total: number }>
    const out: Record<string, { decided: number; total: number }> = {}
    for (const s of SECTIONS) out[s.key] = { decided: 0, total: 0 }
    for (const it of state.catalog) { out[it.section].total++; if (state.current[it.key]) out[it.section].decided++ }
    for (const t of state.applicationTypes) for (const row of state.checklist[t.key] ?? []) {
      out.checklist.total++; if (state.current[`checklist.${t.key}.${row.doc_key}`]) out.checklist.decided++
    }
    return out as Record<Panel, { decided: number; total: number }>
  }, [state])

  const pendingCount = state ? Object.values(state.current).filter(d => !d.applied_at).length : 0

  if (loadError) return <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{loadError}</div>
  if (!state) return <div className="p-6 text-sm text-gray-400">Loading…</div>

  const totalDecided = Object.values(counts).reduce((n, c) => n + c.decided, 0)
  const totalItems = Object.values(counts).reduce((n, c) => n + c.total, 0)

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#f26a1b]">Association onboarding · applications</div>
          <h1 className="text-xl font-semibold text-gray-900">{name} — setup questionnaire</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">Every answer is recorded with who decided it and when. Nothing changes a live setting until the board adopts the answers in the last section.</p>
        </div>
        <AttributionBar att={att} setAtt={setAtt} members={state.boardMembers} staffName={staffName} />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-[240px_1fr]">
        <aside className="md:sticky md:top-4 self-start rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Progress</div>
            <div className="mt-1 flex items-baseline justify-between"><b className="text-lg text-gray-900">{totalDecided}</b><span className="text-[11px] text-gray-400">of {totalItems} items</span></div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-gray-100"><div className="h-full bg-[#f26a1b]" style={{ width: `${totalItems ? Math.round(totalDecided / totalItems * 100) : 0}%` }} /></div>
            <div className="mt-2 text-[11px] text-gray-500">
              {state.session.status === 'adopted' && pendingCount === 0
                ? <span className="text-emerald-700">✓ Adopted {fmtDate(state.session.meeting_date)}</span>
                : pendingCount > 0 ? <span className="text-amber-700">{pendingCount} pending adoption</span> : 'No decisions yet'}
            </div>
          </div>
          <nav>
            {PANELS.map(p => {
              const c = counts[p.key as OnboardingSection]
              return (
                <button key={p.key} onClick={() => setPanel(p.key)}
                  className={`flex w-full items-center gap-2 border-l-[3px] px-4 py-2 text-left text-sm ${panel === p.key ? 'border-[#f26a1b] bg-orange-50 text-gray-900' : 'border-transparent text-gray-700 hover:bg-gray-50'}`}>
                  <span className="w-4 font-mono text-[10px] text-gray-400">{p.number}</span>
                  <span className="flex-1">{p.title}</span>
                  {c && <span className={`font-mono text-[10px] ${c.decided === c.total && c.total > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{c.decided}/{c.total}</span>}
                  {p.key === 'review' && pendingCount > 0 && <span className="font-mono text-[10px] text-[#f26a1b]">{pendingCount}</span>}
                </button>
              )
            })}
          </nav>
        </aside>

        <main>
          {panel !== 'review' && (
            <SectionPanel section={panel} state={state} save={save} busy={busy} errors={errors} />
          )}
          {panel === 'review' && <ReviewPanel state={state} code={code} onAdopted={load} />}
          <div className="mt-4 flex justify-between">
            {PANELS.findIndex(p => p.key === panel) > 0
              ? <button className={btnCls} onClick={() => setPanel(PANELS[PANELS.findIndex(p => p.key === panel) - 1].key)}>← Back</button> : <span />}
            {PANELS.findIndex(p => p.key === panel) < PANELS.length - 1
              && <button className={primaryCls} onClick={() => setPanel(PANELS[PANELS.findIndex(p => p.key === panel) + 1].key)}>{PANELS[PANELS.findIndex(p => p.key === panel) + 1].title} →</button>}
          </div>
        </main>
      </div>
    </div>
  )
}

// ── Attribution bar ────────────────────────────────────────────────────

function AttributionBar({ att, setAtt, members, staffName }: { att: Attribution; setAtt: (a: Attribution) => void; members: OnboardingState['boardMembers']; staffName: string }) {
  return (
    <div className="grid min-w-[360px] grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs">
      <label className="text-gray-500">Recording</label>
      <select className={inputCls} value={att.kind} onChange={e => setAtt({ ...att, kind: e.target.value as Attribution['kind'] })}>
        <option value="board">A board decision</option>
        <option value="existing_config">Existing configuration (no board decision)</option>
      </select>
      {att.kind === 'board' && (
        <>
          <label className="text-gray-500">Decided by</label>
          <select className={inputCls} value={att.boardMemberId} onChange={e => setAtt({ ...att, boardMemberId: e.target.value })}>
            <option value="">Choose a board member…</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}{m.role ? ` — ${m.role}` : ''}</option>)}
          </select>
          <label className="text-gray-500">Source</label>
          <div className="flex gap-2">
            <select className={inputCls} value={att.source} onChange={e => setAtt({ ...att, source: e.target.value as Attribution['source'] })}>
              <option value="meeting">Board meeting on</option>
              <option value="email_consent">Email consent dated</option>
            </select>
            <input type="date" className={inputCls} value={att.sourceRef} onChange={e => setAtt({ ...att, sourceRef: e.target.value })} />
          </div>
        </>
      )}
      <div className="col-span-2 text-[11px] text-gray-400">Entered by {staffName}. Identity facts are stamped as staff-confirmed.</div>
    </div>
  )
}

// ── Section panel ──────────────────────────────────────────────────────

function SectionPanel({ section, state, save, busy, errors }: {
  section: OnboardingSection; state: OnboardingState
  save: (items: { key: string; value: unknown; note?: string | null }[]) => Promise<void>
  busy: Set<string>; errors: Record<string, string>
}) {
  const meta = SECTIONS.find(s => s.key === section)!
  const items = state.catalog.filter(i => i.section === section)
  return (
    <div>
      <div className="mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#f26a1b]">Section {meta.number} · {meta.facts ? 'facts, confirmed by staff' : 'board decisions'}</div>
        <h2 className="text-lg font-semibold text-gray-900">{meta.title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">{meta.blurb}</p>
      </div>
      {section === 'checklist'
        ? <ChecklistGrid state={state} save={save} busy={busy} errors={errors} />
        : (
          <div className="rounded-lg border border-gray-200 bg-white">
            {items.map(item => (
              <ItemRow key={item.key} item={item} state={state} save={save} busy={busy.has(item.key)} error={errors[item.key]} />
            ))}
          </div>
        )}
    </div>
  )
}

function liveValue(item: CatalogItem, live: OnboardingState['live']): unknown {
  const a = live.association
  switch (item.key) {
    case 'identity.legal_name': return a.legal_name
    case 'identity.association_type': return a.association_type
    case 'identity.service_type': return a.service_type
    case 'identity.principal_address': return a.principal_address
    case 'identity.city': return a.city
    case 'identity.state': return a.state
    case 'identity.zip': return a.zip
    case 'identity.sunbiz_document_number': return a.sunbiz_document_number
    case 'identity.fei_ein_number': return a.fei_ein_number
    case 'apps.enabled': return !live.hideApplicationForms
    case 'apps.screening_provider': return a.screening_provider
    case 'apps.interview_lease': return a.requires_interview_lease
    case 'apps.interview_purchase': return a.requires_interview_purchase
    case 'board.required_signatures': return live.boardConfig.required_signatures != null ? String(live.boardConfig.required_signatures) : null
    case 'board.reminder_cadence': return live.boardConfig.reminder_cadence
    case 'board.decision_window_days': return live.boardConfig.decision_window_days
    case 'board.committee': return { members: live.committee.filter(c => c.member_type === 'decider' || c.member_type === 'voter') } as CommitteeValue
  }
  if (item.kind === 'rule') {
    const r = live.rules[item.key.replace(/^rules\./, '')]
    if (!r) return null
    return { enabled: r.active, value: typeof r.value === 'number' ? r.value : undefined, enforcement: r.enforcement } as RuleValue
  }
  return null
}

function Stamp({ d, fact }: { d: OnboardingDecision | undefined; fact?: boolean }) {
  if (!d) return <div className="col-span-full flex items-center gap-2 font-mono text-[11px] text-gray-400"><span className="inline-block h-1.5 w-1.5 rounded-full bg-gray-300" />{fact ? 'not yet confirmed' : 'not yet decided'}</div>
  const src = d.source === 'meeting' || d.source === 'email_consent' ? `${SOURCE_LABEL[d.source]} ${fmtDate(d.source_ref)}` : SOURCE_LABEL[d.source]
  return (
    <div className="col-span-full flex flex-wrap items-center gap-2 font-mono text-[11px] text-emerald-700">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600" />
      {fact ? 'confirmed' : 'decided'} · {d.decided_by} · {src} · recorded {fmtET(d.decided_at)}
      {d.apply_error && !d.applied_at
        ? <span className="rounded bg-red-50 px-1.5 text-red-700" title={d.apply_error}>apply failed</span>
        : d.applied_at ? <span className="rounded bg-emerald-50 px-1.5">applied</span> : <span className="rounded bg-amber-50 px-1.5 text-amber-700">pending adoption</span>}
    </div>
  )
}

function ItemRow({ item, state, save, busy, error }: {
  item: CatalogItem; state: OnboardingState
  save: (items: { key: string; value: unknown; note?: string | null }[]) => Promise<void>
  busy: boolean; error?: string
}) {
  const d = state.current[item.key]
  const live = liveValue(item, state.live)
  const value = d ? d.value : live
  const hasDecision = !!d
  return (
    <div className={`grid grid-cols-1 gap-x-5 gap-y-2 border-b border-gray-100 px-4 py-3 last:border-b-0 md:grid-cols-[1fr_300px] ${busy ? 'opacity-60' : ''}`}>
      <div>
        <div className="text-sm font-medium text-gray-900">{item.label}</div>
        {item.help && <div className="mt-0.5 max-w-xl text-xs text-gray-500">{item.help}</div>}
        {!hasDecision && live != null && live !== '' && (
          <div className="mt-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">current setting shown — not yet recorded</div>
        )}
        {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
      </div>
      <div className="flex flex-col items-start gap-1.5 md:items-end">
        <Control key={JSON.stringify(value ?? null)} item={item} value={value} members={state.boardMembers} onChange={v => save([{ key: item.key, value: v }])} />
      </div>
      <Stamp d={d} fact={item.fact} />
    </div>
  )
}

function Seg({ options, value, onChange }: { options: { value: string; label: string; tone?: 'yes' | 'no' }[]; value: string | null; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-gray-300 bg-gray-50">
      {options.map((o, i) => {
        const on = value === o.value
        const onCls = o.tone === 'no' ? 'bg-gray-800 text-white' : 'bg-emerald-700 text-white'
        return <button key={o.value} onClick={() => onChange(o.value)} className={`px-3 py-1 text-sm font-medium ${i > 0 ? 'border-l border-gray-300' : ''} ${on ? onCls : 'text-gray-600 hover:bg-white'}`}>{o.label}</button>
      })}
    </div>
  )
}

function Control({ item, value, members, onChange }: { item: CatalogItem; value: unknown; members: OnboardingState['boardMembers']; onChange: (v: unknown) => void }) {
  // Local text state seeds from the prop; the parent remounts this control
  // (key={...}) whenever the recorded value changes, so no effect is needed.
  const [text, setText] = useState<string>(value == null ? '' : String(value))

  switch (item.kind) {
    case 'boolean':
      return <Seg options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No', tone: 'no' }]} value={value == null ? null : String(!!value)} onChange={v => onChange(v === 'true')} />
    case 'select':
      return (
        <select className={inputCls + ' w-full max-w-[300px]'} value={value == null ? '' : String(value)} onChange={e => e.target.value && onChange(e.target.value)}>
          <option value="">Choose…</option>
          {item.options!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    case 'text':
      return <input className={inputCls + ' w-full max-w-[300px]'} value={text} onChange={e => setText(e.target.value)} onBlur={() => { if ((text.trim() || null) !== (value ?? null)) onChange(text) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} placeholder="—" />
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <input type="number" min={0} className={inputCls + ' w-24'} value={text} onChange={e => setText(e.target.value)} onBlur={() => { if (text !== '' && Number(text) !== value) onChange(Number(text)) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
          {item.suffix && <span className="text-xs text-gray-500">{item.suffix}</span>}
        </div>
      )
    case 'rule':
      return <RuleControl item={item} value={(value ?? null) as RuleValue | null} onChange={onChange} />
    case 'committee':
      return <CommitteeControl value={(value ?? { members: [] }) as CommitteeValue} members={members} onChange={onChange} />
  }
}

function RuleControl({ item, value, onChange }: { item: CatalogItem; value: RuleValue | null; onChange: (v: RuleValue) => void }) {
  const [num, setNum] = useState(value?.value != null ? String(value.value) : '')   // remounted by key on value change
  const enabled = value?.enabled ?? null
  const enforcement = value?.enforcement ?? 'warn'
  const emit = (patch: Partial<RuleValue>) => {
    const next: RuleValue = { enabled: enabled ?? false, value: item.ruleNumeric ? (num === '' ? undefined : Number(num)) : undefined, enforcement, ...patch }
    if (next.enabled && item.ruleNumeric && (next.value == null || !Number.isFinite(next.value) || next.value <= 0)) return   // wait for a number
    onChange(next)
  }
  return (
    <div className="flex flex-col items-start gap-1.5 md:items-end">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Seg options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No', tone: 'no' }]} value={enabled == null ? null : String(enabled)} onChange={v => emit({ enabled: v === 'true' })} />
        {item.ruleNumeric && (
          <>
            <input type="number" min={1} className={inputCls + ' w-20'} value={num} onChange={e => setNum(e.target.value)} onBlur={() => { if (enabled && num !== '' && Number(num) !== value?.value) emit({ enabled: true, value: Number(num) }) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
            <span className="text-xs text-gray-500">{item.suffix}</span>
          </>
        )}
      </div>
      {enabled && (
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={enforcement === 'block'} onChange={e => emit({ enabled: true, enforcement: e.target.checked ? 'block' : 'warn' })} />
          Block the application (otherwise: warn the board)
        </label>
      )}
    </div>
  )
}

function CommitteeControl({ value, members, onChange }: { value: CommitteeValue; members: OnboardingState['boardMembers']; onChange: (v: CommitteeValue) => void }) {
  const [draft, setDraft] = useState<Record<string, 'decider' | 'voter' | ''>>(() => {   // remounted by key on value change
    const d: Record<string, 'decider' | 'voter' | ''> = {}
    for (const m of members) d[m.id] = (value.members.find(x => x.board_member_id === m.id)?.member_type ?? '') as 'decider' | 'voter' | ''
    return d
  })
  const dirty = members.some(m => (draft[m.id] ?? '') !== (value.members.find(x => x.board_member_id === m.id)?.member_type ?? ''))
  if (!members.length) return <div className="text-xs text-gray-400">No active board members synced yet — sync the board first.</div>
  return (
    <div className="w-full max-w-[300px]">
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-xs">
        {members.map(m => (
          <div key={m.id} className="contents">
            <span className="text-gray-700">{m.name}{m.role ? <span className="text-gray-400"> — {m.role}</span> : null}</span>
            <select className={inputCls + ' w-[120px]'} value={draft[m.id] ?? ''} onChange={e => setDraft({ ...draft, [m.id]: e.target.value as 'decider' | 'voter' | '' })}>
              <option value="">Not on it</option><option value="decider">Decider</option><option value="voter">Voter</option>
            </select>
          </div>
        ))}
      </div>
      <button className={primaryCls + ' mt-2 w-full'} disabled={!dirty} onClick={() => onChange({ members: members.filter(m => draft[m.id]).map(m => ({ board_member_id: m.id, member_type: draft[m.id] as 'decider' | 'voter' })) })}>Record committee</button>
    </div>
  )
}

// ── Checklist grid ─────────────────────────────────────────────────────

function ChecklistGrid({ state, save, busy, errors }: {
  state: OnboardingState
  save: (items: { key: string; value: unknown }[]) => Promise<void>
  busy: Set<string>; errors: Record<string, string>
}) {
  const types = state.applicationTypes
  // Union of doc_keys across types, ordered by first appearance's sort_order.
  const rows: { doc_key: string; label: string; note: string | null }[] = []
  const seen = new Set<string>()
  for (const t of types) for (const r of [...(state.checklist[t.key] ?? [])].sort((a, b) => a.sort_order - b.sort_order)) {
    if (!seen.has(r.doc_key)) { seen.add(r.doc_key); rows.push({ doc_key: r.doc_key, label: r.label, note: r.note }) }
  }
  const cellState = (type: string, docKey: string): ChecklistState | null => {
    const key = `checklist.${type}.${docKey}`
    const d = state.current[key]
    if (d) return d.value as ChecklistState
    const row = (state.checklist[type as keyof typeof state.checklist] ?? []).find(r => r.doc_key === docKey)
    if (!row) return null
    return !row.active ? 'off' : row.required ? 'required' : 'optional'
  }
  const cycle = (s: ChecklistState): ChecklistState => s === 'required' ? 'optional' : s === 'optional' ? 'off' : 'required'
  const decidedCount = rows.reduce((n, r) => n + types.filter(t => state.current[`checklist.${t.key}.${r.doc_key}`]).length, 0)
  const anyError = Object.entries(errors).find(([k]) => isChecklistKey(k))?.[1]

  if (!rows.length) return <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">This association has no intake checklist rows yet. Seed the default template from the Association Hub’s Checklist tab first.</div>

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5 text-xs text-gray-500">
        <span>Click a cell to cycle <b>Required → Optional → Off</b>. Each click is one recorded decision. Cells showing the current setting are not recorded until clicked.</span>
        <span className="font-mono text-[10px]">{decidedCount} recorded</span>
      </div>
      {anyError && <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">{anyError}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left font-mono text-[10px] uppercase tracking-wide text-gray-500">
            <th className="px-4 py-2">Document</th>
            {types.map(t => <th key={t.key} className="px-3 py-2 text-center">{t.label}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.doc_key} className="border-t border-gray-100">
                <td className="px-4 py-1.5 text-gray-800">{r.label}{r.note && <span className="ml-1 text-xs text-gray-400">· {r.note}</span>}</td>
                {types.map(t => {
                  const s = cellState(t.key, r.doc_key)
                  const key = `checklist.${t.key}.${r.doc_key}`
                  const recorded = !!state.current[key]
                  if (s == null) return <td key={t.key} className="px-3 py-1.5 text-center text-gray-300">—</td>
                  const cls = s === 'required' ? 'text-emerald-700 font-semibold' : s === 'optional' ? 'text-gray-600' : 'text-gray-300'
                  return (
                    <td key={t.key} className="px-3 py-1.5 text-center">
                      <button disabled={busy.has(key)} onClick={() => save([{ key, value: cycle(s) }])}
                        className={`rounded px-2 py-0.5 text-xs ${cls} ${recorded ? 'ring-1 ring-emerald-200' : 'hover:bg-gray-50'} disabled:opacity-50`}
                        title={recorded ? 'Recorded' : 'Current setting — click to record a decision'}>
                        {s === 'required' ? 'Required' : s === 'optional' ? 'Optional' : 'Off'}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Review & adopt ─────────────────────────────────────────────────────

function ReviewPanel({ state, code, onAdopted }: { state: OnboardingState; code: string; onAdopted: () => Promise<void> }) {
  const [meetingDate, setMeetingDate] = useState(state.session.meeting_date ?? '')
  const [motionBy, setMotionBy] = useState(state.session.motion_by ?? '')
  const [vote, setVote] = useState(state.session.vote ?? '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ applied: number; failed: { key: string; error: string }[]; adopted: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const order: Record<string, number> = { identity: 1, applications: 2, rules: 3, checklist: 4, board: 5 }
  const rows = Object.values(state.current).sort((a, b) => (order[sectionOf(a.item_key) ?? ''] ?? 9) - (order[sectionOf(b.item_key) ?? ''] ?? 9) || a.item_key.localeCompare(b.item_key))
  const pending = rows.filter(r => !r.applied_at)
  const labelFor = (key: string) => {
    if (isChecklistKey(key)) { const [, t, dk] = key.split('.'); const row = (state.checklist[t as keyof typeof state.checklist] ?? []).find(r => r.doc_key === dk); return `${row?.label ?? dk} — ${state.applicationTypes.find(x => x.key === t)?.label ?? t}` }
    return state.catalog.find(i => i.key === key)?.label ?? key
  }
  const valueText = (key: string, v: unknown): string => {
    if (isChecklistKey(key)) return String(v)
    const item = state.catalog.find(i => i.key === key)
    if (!item) return JSON.stringify(v)
    switch (item.kind) {
      case 'boolean': return v ? 'Yes' : 'No'
      case 'select': return item.options?.find(o => o.value === String(v))?.label ?? String(v)
      case 'number': return `${v} ${item.suffix ?? ''}`.trim()
      case 'text': return v == null ? '—' : String(v)
      case 'rule': { const r = v as RuleValue; return r.enabled ? `Yes${r.value != null ? `, ${r.value} ${item.suffix ?? ''}`.trimEnd() : ''} · ${r.enforcement === 'block' ? 'block' : 'warn'}` : 'No' }
      case 'committee': { const c = v as CommitteeValue; return c.members.length ? c.members.map(m => `${state.boardMembers.find(b => b.id === m.board_member_id)?.name ?? m.board_member_id} (${m.member_type})`).join(', ') : 'Nobody' }
    }
  }

  const adopt = async () => {
    setBusy(true); setErr(null); setResult(null)
    try {
      const r = await fetch(`/api/admin/onboarding/${code}/adopt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingDate, motionBy, vote }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Adoption failed')
      setResult(j)
      await onAdopted()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div>
      <div className="mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#f26a1b]">Section 6 · adoption</div>
        <h2 className="text-lg font-semibold text-gray-900">Review & adopt</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">The register is the audit trail. Adoption stamps the meeting on every pending decision and applies it to MAIA’s live settings. Decisions recorded later are amendments and need their own adoption.</p>
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5"><h3 className="text-sm font-semibold text-gray-900">Decision register</h3><span className="font-mono text-[10px] text-gray-500">{rows.length} recorded · {pending.length} pending adoption</span></div>
        {rows.length === 0 ? <div className="p-6 text-sm text-gray-400">No decisions recorded yet.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left font-mono text-[10px] uppercase tracking-wide text-gray-500"><th className="px-4 py-2">Item</th><th className="px-3 py-2">Decision</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Decided by</th><th className="px-3 py-2">Recorded (ET)</th><th className="px-3 py-2">Status</th></tr></thead>
              <tbody>
                {rows.map(d => (
                  <tr key={d.id} className="border-t border-gray-100 align-top">
                    <td className="px-4 py-1.5 text-gray-800">{labelFor(d.item_key)}</td>
                    <td className="px-3 py-1.5 text-gray-800">{valueText(d.item_key, d.value)}{d.note && <div className="text-gray-400">{d.note}</div>}</td>
                    <td className="px-3 py-1.5 text-gray-600">{SOURCE_LABEL[d.source]}{d.source_ref ? ` ${fmtDate(d.source_ref)}` : ''}</td>
                    <td className="px-3 py-1.5 text-gray-600">{d.decided_by}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-gray-500">{fmtET(d.decided_at)}</td>
                    <td className="px-3 py-1.5">
                      {d.applied_at ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700">applied {fmtDate(d.applied_at)}</span>
                        : d.apply_error ? <span className="rounded bg-red-50 px-1.5 py-0.5 font-mono text-[10px] text-red-700" title={d.apply_error}>failed</span>
                        : <span className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-700">pending adoption</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Adopt</h3>
        <p className="mt-1 text-xs text-gray-500">Adoption applies the {pending.length} pending decision{pending.length === 1 ? '' : 's'} to MAIA. Items not yet decided keep their current setting.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="text-xs text-gray-500">Meeting date<input type="date" className={inputCls + ' mt-1 w-full'} value={meetingDate} onChange={e => setMeetingDate(e.target.value)} /></label>
          <label className="text-xs text-gray-500">Motion by<input className={inputCls + ' mt-1 w-full'} value={motionBy} onChange={e => setMotionBy(e.target.value)} placeholder="Board member" /></label>
          <label className="text-xs text-gray-500">Vote<input className={inputCls + ' mt-1 w-full'} value={vote} onChange={e => setVote(e.target.value)} placeholder="e.g. 3–0" /></label>
        </div>
        {err && <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
        {result && (
          <div className={`mt-3 rounded border px-3 py-2 text-xs ${result.adopted ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            {result.adopted ? `✓ Adopted. ${result.applied} decision${result.applied === 1 ? '' : 's'} applied to MAIA.` : `${result.applied} applied, ${result.failed.length} failed — fix and adopt again:`}
            {result.failed.map(f => <div key={f.key} className="mt-1 font-mono text-[11px]">{f.key}: {f.error}</div>)}
          </div>
        )}
        <button className={primaryCls + ' mt-4 w-full py-2'} disabled={busy || !meetingDate || pending.length === 0} onClick={adopt}>
          {busy ? 'Applying…' : `Record adoption and apply ${pending.length} decision${pending.length === 1 ? '' : 's'} to MAIA`}
        </button>
        {state.session.status === 'adopted' && pending.length === 0 && <p className="mt-2 text-xs text-emerald-700">Adopted {fmtDate(state.session.meeting_date)}{state.session.motion_by ? ` · motion by ${state.session.motion_by}` : ''}{state.session.vote ? ` · vote ${state.session.vote}` : ''} · recorded by {state.session.adopted_by}</p>}
      </div>
    </div>
  )
}
