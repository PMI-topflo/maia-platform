'use client'

// =====================================================================
// MaintenanceTab.tsx
// The Association Hub Maintenance tab: stats + a preventive-maintenance
// CALENDAR (3-day / week / month) computed from preventive_schedules,
// the schedule list (add / remove), driven by the API routes under
// /api/admin/maintenance/schedules. Mounted only when the tab is open.
// =====================================================================

import { useEffect, useState } from 'react'
import {
  occurrencesInWindow, ymd, cadenceSummary, nextDue,
  CADENCES, CADENCE_LABEL, WEEKDAY_LABEL, GOVERNANCE_TASKS,
  type PreventiveSchedule, type Cadence, type CalEvent,
} from '@/lib/preventive-maintenance'

const EVK: Record<Cadence, string> = {
  weekly:     'bg-teal-100 text-teal-800',
  monthly:    'bg-green-100 text-green-800',
  quarterly:  'bg-indigo-100 text-indigo-800',
  semiannual: 'bg-amber-100 text-amber-800',
  annual:     'bg-sky-100 text-sky-800',
}
// Governance dates (budget prep, elections…) stand out from maintenance.
const GOV_STYLE = 'bg-[#fae8ff] text-[#86198f] font-semibold'
const evStyle = (e: CalEvent) => e.category === 'governance' ? GOV_STYLE : EVK[e.cadence]
type View = '3day' | 'week' | 'month'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtShort = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`

function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = new Date(first); start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
}
function span(anchor: Date, view: View): Date[] {
  if (view === 'month') return monthGrid(anchor)
  if (view === 'week') {
    const s = new Date(anchor); s.setDate(anchor.getDate() - anchor.getDay())
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d })
  }
  return Array.from({ length: 3 }, (_, i) => { const d = new Date(anchor); d.setDate(anchor.getDate() + i); return d })
}

export default function MaintenanceTab({ assoc, openWorkOrders }: { assoc: string; openWorkOrders: number }) {
  const [schedules, setSchedules] = useState<PreventiveSchedule[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('week')
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  const [addOpen, setAddOpen] = useState(false)
  const [addGovOpen, setAddGovOpen] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/admin/maintenance/schedules?assoc=${encodeURIComponent(assoc)}`)
      .then(r => r.json())
      .then((d: { schedules?: PreventiveSchedule[]; error?: string }) => {
        if (!live) return
        if (d.error) { setError(d.error); setLoading(false); return }
        setSchedules(d.schedules ?? []); setLoading(false)
      })
      .catch(e => { if (live) { setError(e instanceof Error ? e.message : String(e)); setLoading(false) } })
    return () => { live = false }
  }, [assoc])

  const list = schedules ?? []
  const maint = list.filter(s => s.category !== 'governance')
  const gov   = list.filter(s => s.category === 'governance')
  const days = span(anchor, view)
  const events = occurrencesInWindow(list, days[0], days[days.length - 1])
  const byDay = new Map<string, CalEvent[]>()
  for (const e of events) { const a = byDay.get(e.date) ?? []; a.push(e); byDay.set(e.date, a) }

  const today = ymd(new Date())
  const next7 = (() => { const e = new Date(); e.setDate(e.getDate() + 7); return occurrencesInWindow(list, new Date(), e).length })()

  function shift(dir: number) {
    const d = new Date(anchor)
    if (view === 'month') d.setMonth(d.getMonth() + dir)
    else if (view === 'week') d.setDate(d.getDate() + dir * 7)
    else d.setDate(d.getDate() + dir * 3)
    setAnchor(d)
  }
  const periodLabel = view === 'month'
    ? `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
    : `${fmtShort(days[0])} – ${fmtShort(days[days.length - 1])}`

  async function removeSchedule(id: string) {
    if (!window.confirm('Remove this preventive schedule?')) return
    setSchedules(prev => (prev ?? []).filter(s => s.id !== id))
    await fetch(`/api/admin/maintenance/schedules/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Preventive schedules" value={String(list.length)} />
        <Stat label="Due next 7 days" value={String(next7)} />
        <Stat label="Open work orders" value={String(openWorkOrders)} />
        <Stat label="Cadences" value={String(new Set(list.map(s => s.cadence)).size)} />
      </div>

      {/* Calendar */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button onClick={() => shift(-1)} className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50">‹</button>
            <button onClick={() => setAnchor(new Date())} className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">Today</button>
            <button onClick={() => shift(1)} className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50">›</button>
            <span className="ml-1 text-sm font-medium text-gray-700">{periodLabel}</span>
          </div>
          <div className="inline-flex overflow-hidden rounded border border-gray-200 text-xs">
            {(['3day', 'week', 'month'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)} className={`px-2.5 py-1 ${view === v ? 'bg-[#f26a1b] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {v === '3day' ? '3 days' : v === 'week' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
        </div>

        {loading ? <p className="text-xs text-gray-400">Loading schedule…</p> : view === 'month' ? (
          <div>
            <div className="grid grid-cols-7 text-center text-[10px] uppercase tracking-wide text-gray-400">
              {WEEKDAY_LABEL.map(d => <div key={d} className="pb-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded bg-gray-200">
              {days.map((d, i) => {
                const out = d.getMonth() !== anchor.getMonth()
                const evs = byDay.get(ymd(d)) ?? []
                return (
                  <div key={i} className={`min-h-[78px] p-1 ${out ? 'bg-gray-50' : 'bg-white'} ${ymd(d) === today ? 'ring-1 ring-inset ring-[#f26a1b]' : ''}`}>
                    <div className={`text-[11px] ${out ? 'text-gray-300' : 'text-gray-500'}`}>{d.getDate()}</div>
                    {evs.slice(0, 3).map((e, j) => <div key={j} className={`mt-0.5 truncate rounded px-1 py-0.5 text-[10px] ${evStyle(e)}`} title={e.task}>{e.task}</div>)}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((d, i) => {
              const evs = byDay.get(ymd(d)) ?? []
              return (
                <div key={i} className={`rounded border ${ymd(d) === today ? 'border-[#f26a1b]' : 'border-gray-200'}`}>
                  <div className="border-b border-gray-100 bg-gray-50 px-2 py-1 text-center text-[11px] text-gray-500">
                    {WEEKDAY_LABEL[d.getDay()]} <span className="font-semibold text-gray-800">{d.getDate()}</span>
                  </div>
                  <div className={`space-y-1 p-1.5 ${view === '3day' ? 'min-h-[160px]' : 'min-h-[120px]'}`}>
                    {evs.length === 0 ? <div className="text-[10px] text-gray-300">—</div> : evs.map((e, j) => (
                      <div key={j} className={`rounded px-1.5 py-1 text-[11px] ${evStyle(e)}`} title={e.vendor ?? undefined}>{e.task}{e.vendor && <span className="block text-[9px] opacity-70">{e.vendor}</span>}</div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-gray-500">
          {CADENCES.map(c => <span key={c} className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded ${EVK[c].split(' ')[0]}`} />{CADENCE_LABEL[c]}</span>)}
          <span className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded ${GOV_STYLE.split(' ')[0]}`} />Governance</span>
        </div>
      </div>

      {/* Governance dates (per condo docs) */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Governance dates <span className="font-normal text-gray-400">· per condo docs</span></h3>
          <button onClick={() => setAddGovOpen(true)} className="text-xs font-medium text-[#86198f] hover:text-[#a21caf]">+ Add governance date</button>
        </div>
        <p className="mb-2 text-[11px] text-gray-400">Annual milestones from the governing documents — budget preparation, elections, annual meeting, reserve study.</p>
        {!loading && gov.length === 0 && <p className="text-xs text-gray-400">No governance dates yet. Add the association&apos;s budget-prep and election dates.</p>}
        {gov.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className="pb-1 text-left font-semibold">Milestone</th><th className="pb-1 text-left font-semibold">When</th>
              <th className="pb-1 text-left font-semibold">Next</th><th className="pb-1"></th>
            </tr></thead>
            <tbody>
              {gov.map(s => (
                <tr key={s.id} className="border-t border-gray-100">
                  <td className="py-1.5 font-medium text-gray-900">{s.task}</td>
                  <td className="py-1.5 text-gray-500">{cadenceSummary(s)}</td>
                  <td className="py-1.5 text-gray-700">{nextDue(s) ?? '—'}</td>
                  <td className="py-1.5 text-right"><button onClick={() => removeSchedule(s.id)} className="text-xs text-gray-400 hover:text-red-600">Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Preventive maintenance schedule list */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Preventive maintenance schedule</h3>
          <button onClick={() => setAddOpen(true)} className="text-xs font-medium text-[#f26a1b] hover:text-[#d85a14]">+ Add schedule</button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!loading && maint.length === 0 && <p className="text-xs text-gray-400">No preventive schedules yet. Add one to populate the calendar.</p>}
        {maint.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className="pb-1 text-left font-semibold">Task</th><th className="pb-1 text-left font-semibold">Cadence</th>
              <th className="pb-1 text-left font-semibold">Vendor</th><th className="pb-1 text-left font-semibold">Next due</th><th className="pb-1"></th>
            </tr></thead>
            <tbody>
              {maint.map(s => (
                <tr key={s.id} className="border-t border-gray-100">
                  <td className="py-1.5 font-medium text-gray-900">{s.task}</td>
                  <td className="py-1.5 text-gray-500">{cadenceSummary(s)}</td>
                  <td className="py-1.5 text-gray-500">{s.vendor_name ?? '—'}</td>
                  <td className="py-1.5 text-gray-700">{nextDue(s) ?? '—'}</td>
                  <td className="py-1.5 text-right"><button onClick={() => removeSchedule(s.id)} className="text-xs text-gray-400 hover:text-red-600">Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {addOpen && (
        <AddScheduleModal
          assoc={assoc}
          onClose={() => setAddOpen(false)}
          onCreated={s => { setSchedules(prev => [...(prev ?? []), s]); setAddOpen(false) }}
        />
      )}
      {addGovOpen && (
        <AddGovernanceModal
          assoc={assoc}
          onClose={() => setAddGovOpen(false)}
          onCreated={s => { setSchedules(prev => [...(prev ?? []), s]); setAddGovOpen(false) }}
        />
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-gray-200 bg-white p-4"><div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-xl font-semibold text-gray-900">{value}</div></div>
}

function AddScheduleModal({ assoc, onClose, onCreated }: { assoc: string; onClose: () => void; onCreated: (s: PreventiveSchedule) => void }) {
  const todayYmd = ymd(new Date())
  const [task, setTask] = useState('')
  const [cadence, setCadence] = useState<Cadence>('monthly')
  const [weekday, setWeekday] = useState(1)
  const [dayOfMonth, setDayOfMonth] = useState(1)
  const [startDate, setStartDate] = useState(todayYmd)
  const [vendor, setVendor] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!task.trim()) { setErr('Task name is required.'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/admin/maintenance/schedules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          association_code: assoc, task: task.trim(), cadence, start_date: startDate,
          weekday: cadence === 'weekly' ? weekday : null,
          day_of_month: cadence !== 'weekly' ? dayOfMonth : null,
          vendor_name: vendor.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      onCreated(data.schedule as PreventiveSchedule)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/45 p-4">
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
        <div className="text-base font-bold text-gray-900">Add preventive schedule</div>
        <div className="mt-4 space-y-3">
          <Field label="Task"><input value={task} onChange={e => setTask(e.target.value)} placeholder="Pool chemical service" className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cadence">
              <select value={cadence} onChange={e => setCadence(e.target.value as Cadence)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                {CADENCES.map(c => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
              </select>
            </Field>
            {cadence === 'weekly' ? (
              <Field label="Weekday">
                <select value={weekday} onChange={e => setWeekday(Number(e.target.value))} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                  {WEEKDAY_LABEL.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="Day of month (1–28)">
                <input type="number" min={1} max={28} value={dayOfMonth} onChange={e => setDayOfMonth(Number(e.target.value))} className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" />
              </Field>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date"><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>
            <Field label="Vendor (optional)"><input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="AquaPro" className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>
          </div>
        </div>
        {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded bg-[#f26a1b] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d85a14] disabled:opacity-50">{busy ? 'Saving…' : 'Add schedule'}</button>
        </div>
      </div>
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</span>{children}</label>
}

// Governance dates are annual milestones from the condo docs. The picked
// date sets the month + day; it recurs every year (cadence='annual').
function AddGovernanceModal({ assoc, onClose, onCreated }: { assoc: string; onClose: () => void; onCreated: (s: PreventiveSchedule) => void }) {
  const [task, setTask] = useState<string>(GOVERNANCE_TASKS[0])
  const [date, setDate] = useState(ymd(new Date()))
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/admin/maintenance/schedules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          association_code: assoc, task, category: 'governance',
          cadence: 'annual', start_date: date,
          day_of_month: Math.min(28, Math.max(1, Number(date.slice(8, 10)))),
          notes: notes.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      onCreated(data.schedule as PreventiveSchedule)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/45 p-4">
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
        <div className="text-base font-bold text-gray-900">Add governance date</div>
        <div className="mt-1 text-xs text-gray-500">Annual milestone from this association&apos;s condo docs. Repeats every year on the date you pick.</div>
        <div className="mt-4 space-y-3">
          <Field label="Milestone">
            <select value={task} onChange={e => setTask(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
              {GOVERNANCE_TASKS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date (per docs)"><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>
            <Field label="Notes (optional)"><input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. 45 days before AGM" className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>
          </div>
        </div>
        {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded bg-[#86198f] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#a21caf] disabled:opacity-50">{busy ? 'Saving…' : 'Add date'}</button>
        </div>
      </div>
    </div>
  )
}
