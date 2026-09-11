'use client'

// =====================================================================
// TodayPanel — "What they have today".
//
// MAIA reads the association's filed documents (application package,
// Rules & Regulations, Declaration / By-Laws) and proposes the answers to
// the questionnaire, each with the quoted passage. Staff accept or reject;
// accepted proposals are recorded as existing configuration under the
// staff member's name and applied immediately — this is how an
// association goes live with exactly its current requirements, with no
// board meeting. The board's own decisions come later in the sections.
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { catalogItem } from '@/lib/onboarding-catalog'
import type { OnboardingState, RuleValue } from '@/lib/onboarding'
import type { ProposalsView, ProposalRow } from '@/lib/onboarding-proposals'

const TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease renewal', additional_occupant: 'Additional occupant' }
const SECTION_ORDER = ['Applications & screening', 'Eligibility rules', 'Board & approvals', 'Document checklist']
const CATEGORY_LABEL: Record<string, string> = { application_forms: 'Application package', rules_regs: 'Rules & Regulations', condo_docs: 'Governing document' }
const primaryCls = 'rounded bg-[#f26a1b] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d85a14] disabled:opacity-50'
const btnCls = 'rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-[#f26a1b] hover:text-[#f26a1b] disabled:opacity-50'

function fmtET(iso: string) {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'
}

function sectionOf(key: string): string {
  if (key.startsWith('apps.')) return 'Applications & screening'
  if (key.startsWith('rules.')) return 'Eligibility rules'
  if (key.startsWith('board.')) return 'Board & approvals'
  return 'Document checklist'
}

function labelFor(state: OnboardingState, key: string): string {
  const m = /^checklist\.([a-z_]+)\.([a-z0-9_]+)$/.exec(key)
  if (m) {
    const row = (state.checklist[m[1] as keyof typeof state.checklist] ?? []).find(r => r.doc_key === m[2])
    return `${TYPE_LABEL[m[1]] ?? m[1]} · ${row?.label ?? m[2]}`
  }
  return catalogItem(key)?.label ?? key
}

function fmtValue(key: string, v: unknown): string {
  const item = catalogItem(key)
  if (item?.kind === 'rule') {
    const r = (v ?? {}) as Partial<RuleValue>
    if (!r.enabled) return 'Off'
    const n = r.value != null ? `${r.value}${item.suffix ? ` ${item.suffix}` : ''}` : 'On'
    return `${n} · ${r.enforcement === 'block' ? 'Block' : 'Warn'}`
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (item?.kind === 'select') return item.options?.find(o => o.value === String(v))?.label ?? String(v)
  if (item?.kind === 'number') return `${v}${item.suffix ? ` ${item.suffix}` : ''}`
  if (typeof v === 'string') return v.charAt(0).toUpperCase() + v.slice(1)
  return v == null ? '—' : String(v)
}

/** What MAIA has live for this key right now (the same reading the section panels use). */
function liveValue(state: OnboardingState, key: string): string {
  const a = state.live.association
  switch (key) {
    case 'apps.enabled': return state.live.hideApplicationForms ? 'No' : 'Yes'
    case 'apps.screening_provider': return a.screening_provider ? fmtValue(key, a.screening_provider) : 'Not set'
    case 'apps.interview_lease': return a.requires_interview_lease ? 'Yes' : 'No'
    case 'apps.interview_purchase': return a.requires_interview_purchase ? 'Yes' : 'No'
    case 'board.required_signatures': return state.live.boardConfig.required_signatures ? String(state.live.boardConfig.required_signatures) : 'Not set'
    case 'board.decision_window_days': return state.live.boardConfig.decision_window_days ? `${state.live.boardConfig.decision_window_days} calendar days` : 'Not set'
  }
  if (key.startsWith('rules.')) {
    const r = state.live.rules[key.slice(6)]
    if (!r || !r.active) return 'Off'
    return fmtValue(key, { enabled: true, value: typeof r.value === 'number' ? r.value : undefined, enforcement: r.enforcement })
  }
  const m = /^checklist\.([a-z_]+)\.([a-z0-9_]+)$/.exec(key)
  if (m) {
    const row = (state.checklist[m[1] as keyof typeof state.checklist] ?? []).find(r => r.doc_key === m[2])
    return !row ? '—' : !row.active ? 'Off' : row.required ? 'Required' : 'Optional'
  }
  return '—'
}

export default function TodayPanel({ code, state, onApplied }: { code: string; state: OnboardingState; onApplied: () => Promise<void> }) {
  const [view, setView] = useState<ProposalsView | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rejected, setRejected] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoadErr(null)
    const r = await fetch(`/api/admin/onboarding/${code}/proposals`, { cache: 'no-store' })
    const j = await r.json()
    if (!r.ok) { setLoadErr(j.error ?? 'Could not load'); return }
    const v = j as ProposalsView
    setView(v)
    // High and medium confidence rows start selected; low ones wait for a human.
    setSelected(new Set(v.proposals.filter(p => p.status === 'pending' && !p.invalid_reason && p.confidence !== 'low').map(p => p.id)))
    setRejected(new Set())
  }, [code])
  useEffect(() => { void load() }, [load])

  async function read() {
    if (view?.run && !confirm('Read the documents again? Proposals still waiting for a decision are replaced; accepted and rejected ones are kept.')) return
    setReading(true); setMsg(null)
    try {
      const r = await fetch(`/api/admin/onboarding/${code}/extract`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'failed')
      await load()
      setMsg(`MAIA read ${(j as ProposalsView).run?.documents.length ?? 0} document(s) and made ${(j as ProposalsView).proposals.length} proposal(s).`)
    } catch (e) { setMsg(`Could not read the documents: ${(e as Error).message}`) } finally { setReading(false) }
  }

  async function apply() {
    const accept = [...selected].map(id => ({ id }))
    const reject = [...rejected]
    if (!accept.length && !reject.length) return
    if (!confirm(`Apply ${accept.length} proposal(s) as existing configuration${reject.length ? ` and reject ${reject.length}` : ''}? Accepted items change the live setting now.`)) return
    setApplying(true); setMsg(null)
    try {
      const r = await fetch(`/api/admin/onboarding/${code}/proposals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accept, reject }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'failed')
      const failed = (j.failed ?? []) as { key: string; error: string }[]
      setMsg(`${j.accepted} applied, ${j.rejected} rejected.${failed.length ? ` ${failed.length} failed: ${failed.map(f => `${f.key} (${f.error})`).join('; ')}` : ''}`)
      await onApplied()
      await load()
    } catch (e) { setMsg(`Could not apply: ${(e as Error).message}`) } finally { setApplying(false) }
  }

  const groups = useMemo(() => {
    const g = new Map<string, ProposalRow[]>()
    for (const p of view?.proposals ?? []) { const s = sectionOf(p.item_key ?? ''); g.set(s, [...(g.get(s) ?? []), p]) }
    return SECTION_ORDER.filter(s => g.has(s)).map(s => ({ section: s, rows: g.get(s)! }))
  }, [view])

  const pending = (view?.proposals ?? []).filter(p => p.status === 'pending')
  const differs = pending.filter(p => p.item_key && fmtValue(p.item_key, p.proposed_value) !== liveValue(state, p.item_key)).length

  if (loadErr) return <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{loadErr}</div>

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
        <div className="max-w-2xl">
          <h2 className="text-base font-semibold text-gray-900">What they have today</h2>
          <p className="mt-1 text-sm text-gray-500">MAIA reads the application package, the Rules and the governing documents filed on the Documents page and proposes the answers below with the passage each one rests on. Accepted items are recorded as existing configuration under your name and applied now — no board meeting needed for this step.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className={view?.run ? btnCls : primaryCls} disabled={reading} onClick={read}>{reading ? 'MAIA is reading… (up to a few minutes for scans)' : view?.run ? '↻ Read the documents again' : '📖 Read the documents'}</button>
        </div>
      </div>

      {msg && <div className={`mx-5 mt-3 rounded border px-3 py-2 text-sm ${msg.startsWith('Could not') ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{msg}</div>}

      {!view?.run && !reading && (
        <div className="px-5 py-8 text-sm text-gray-500">No reading yet. Press <b>Read the documents</b> — the package, Rules and governing documents must be on the Documents page first.</div>
      )}

      {view?.run && (
        <>
          <div className="grid grid-cols-1 gap-5 border-b border-gray-200 px-5 py-4 md:grid-cols-[1.6fr_1fr]">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">How they handle applications today</div>
              <p className="mt-1 max-w-[64ch] text-sm text-gray-800">{view.run.today_summary}</p>
              <div className="mt-2 text-[11px] text-gray-400">Read {fmtET(view.run.created_at)}{view.run.created_by ? ` by ${view.run.created_by}` : ''}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Documents read</div>
              <ul className="mt-1 space-y-1 text-[13px]">
                {view.run.documents.map(d => (
                  <li key={d.id} className="flex items-baseline gap-2">
                    <span className="w-[140px] shrink-0 text-[10px] uppercase tracking-wide text-gray-400">{CATEGORY_LABEL[d.category] ?? d.category}</span>
                    <span className="min-w-0 flex-1 truncate text-gray-800" title={d.filename}>{d.filename.replace(/\.pdf$/i, '')}</span>
                    <span className="shrink-0 font-mono text-[11px] text-gray-400">{Math.round(d.chars / 1000)}k{d.transcribed ? ' · scan' : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap gap-5 px-5 py-3 text-[13px] text-gray-500">
            <span><b className="text-gray-900">{pending.length}</b> waiting for a decision</span>
            <span><b className="text-gray-900">{differs}</b> differ from what MAIA has today</span>
            <span><b className="text-gray-900">{(view.proposals).filter(p => p.status === 'accepted').length}</b> accepted</span>
            <span><b className="text-gray-900">{view.extras.length}</b> extras with no slot yet</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                  <th className="border-b border-gray-200 px-4 py-2">Item</th>
                  <th className="border-b border-gray-200 px-4 py-2">Documents say</th>
                  <th className="border-b border-gray-200 px-4 py-2">In MAIA today</th>
                  <th className="border-b border-gray-200 px-4 py-2">Evidence</th>
                  <th className="border-b border-gray-200 px-4 py-2">Confidence</th>
                  <th className="border-b border-gray-200 px-4 py-2">Decision</th>
                </tr>
              </thead>
              {groups.map(g => (
                <tbody key={g.section}>
                  <tr><th colSpan={6} className="border-t border-gray-200 bg-gray-50 px-4 py-2 text-left text-[13px] font-semibold text-[#1f2a44]">{g.section} <span className="ml-1 font-normal text-gray-400">{g.rows.length}</span></th></tr>
                  {g.rows.map(p => {
                    const key = p.item_key ?? ''
                    const say = fmtValue(key, p.proposed_value), today = liveValue(state, key)
                    const diff = say !== today
                    const isPending = p.status === 'pending'
                    const isRej = rejected.has(p.id)
                    return (
                      <tr key={p.id} className={`align-top ${isRej ? 'opacity-40' : ''} ${!isPending ? 'text-gray-400' : ''}`}>
                        <td className="w-[20%] border-t border-gray-100 px-4 py-2.5">
                          <div className={isPending ? 'text-gray-900' : ''}>{labelFor(state, key)}</div>
                          <div className="font-mono text-[10px] text-gray-400">{key}</div>
                        </td>
                        <td className={`w-[15%] whitespace-nowrap border-t border-gray-100 px-4 py-2.5 ${diff && isPending ? 'bg-orange-50' : ''}`}>
                          <b className={isPending ? 'text-gray-900' : ''}>{say}</b>
                          {isPending && <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${diff ? 'bg-orange-100 text-[#c2500d]' : 'bg-emerald-50 text-emerald-700'}`}>{diff ? 'differs' : 'same'}</span>}
                          {p.invalid_reason && <div className="mt-1 text-[11px] text-red-700">Not usable as-is: {p.invalid_reason}</div>}
                        </td>
                        <td className="w-[13%] border-t border-gray-100 px-4 py-2.5 text-gray-500">{today}</td>
                        <td className="w-[36%] border-t border-gray-100 px-4 py-2.5">
                          {p.quote && <blockquote className="rounded-r border-l-[3px] border-gray-200 bg-[#f9f8f5] px-2.5 py-1.5 text-[13px] text-gray-800">“{p.quote.length > 240 ? p.quote.slice(0, 240) + '…' : p.quote}”</blockquote>}
                          <div className="mt-1 text-[11px] text-gray-400">{(p.source ?? '').replace(/\.pdf$/i, '')}</div>
                          {p.rationale && <div className="mt-0.5 text-[12px] text-gray-500">{p.rationale}</div>}
                        </td>
                        <td className="border-t border-gray-100 px-4 py-2.5">
                          <span className={`text-[11px] font-bold uppercase tracking-wide ${p.confidence === 'high' ? 'text-emerald-700' : p.confidence === 'low' ? 'text-red-700' : 'text-amber-700'}`}>{p.confidence}</span>
                        </td>
                        <td className="w-[13%] whitespace-nowrap border-t border-gray-100 px-4 py-2.5">
                          {isPending ? (
                            <>
                              <label className="inline-flex items-center gap-1.5 font-medium text-gray-800">
                                <input type="checkbox" disabled={!!p.invalid_reason || isRej} checked={selected.has(p.id)}
                                  onChange={e => setSelected(s => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n })} /> Accept
                              </label>
                              <button type="button" className="ml-2 rounded border border-gray-200 px-2 py-0.5 text-[12px] text-gray-500 hover:border-red-300 hover:text-red-700"
                                onClick={() => { setRejected(r => { const n = new Set(r); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n }); setSelected(s => { const n = new Set(s); n.delete(p.id); return n }) }}>
                                {isRej ? 'Undo' : 'Reject'}
                              </button>
                            </>
                          ) : (
                            <span className={`text-[12px] ${p.status === 'accepted' ? 'text-emerald-700' : ''}`}>{p.status === 'accepted' ? '✓ Applied' : p.status === 'rejected' ? 'Rejected' : 'Replaced'}{p.reviewed_by ? ` · ${p.reviewed_by}` : ''}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              ))}
            </table>
          </div>

          {pending.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-3">
              <span className="text-[13px] text-gray-500">{selected.size} of {pending.length} selected · applied as existing configuration, staff-confirmed{rejected.size ? ` · ${rejected.size} to reject` : ''}</span>
              <div className="flex gap-2">
                <button className={btnCls} onClick={() => setSelected(new Set(pending.filter(p => !p.invalid_reason && !rejected.has(p.id)).map(p => p.id)))}>Select all</button>
                <button className={btnCls} onClick={() => setSelected(new Set())}>Clear</button>
                <button className={primaryCls} disabled={applying || (!selected.size && !rejected.size)} onClick={apply}>{applying ? 'Applying…' : `Accept selected → apply as existing configuration`}</button>
              </div>
            </div>
          )}
          <p className="px-5 py-3 text-[12px] text-gray-400">A rejected item stays as it is today. Anything accepted can still be changed by a board decision in the sections; the register keeps both.</p>

          {view.extras.length > 0 && (
            <div className="border-t border-gray-200 px-5 py-4">
              <h3 className="text-sm font-semibold text-[#1f2a44]">Also in the documents — no questionnaire slot yet</h3>
              <ul className="mt-2 space-y-2">
                {view.extras.map(x => (
                  <li key={x.id} className="rounded border border-gray-200 px-3 py-2 text-[13px]">
                    <b className="text-gray-900">{x.topic}</b> <span className="text-gray-800">{x.finding}</span>
                    {x.quote && <div className="mt-0.5 text-[11.5px] text-gray-400">“{x.quote.length > 160 ? x.quote.slice(0, 160) + '…' : x.quote}” — {(x.source ?? '').replace(/\.pdf$/i, '')}</div>}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-gray-400">Kept with the association so nothing the package says is lost. Fees, notice periods and forms without a doc key get their own questions when those sections are built.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
