'use client'

// =====================================================================
// /admin/cinc-sync/[code]/safety/SafetyManager.tsx
//
// Florida structural-safety inspection checklist. One section per
// inspection type (Milestone, SIRS, Wind Mitigation, Roof); each can
// hold multiple building rows. Shows computed status (scheduled /
// due soon / overdue / missing / waived / not required), lets staff
// add/edit a building's inspection with year-built + stories (which
// drive applicability + the suggested deadline), upload the report, or
// waive a coverage that doesn't apply.
// =====================================================================

import { useEffect, useMemo, useState } from 'react'
import {
  INSPECTION_TYPES,
  inspectionStatus,
  suggestedNextDue,
  inspectionTypeDef,
  type AssociationSafetyInspection,
  type InspectionStatus,
  type InspectionTypeDef,
  type SafetyRequirement,
} from '@/lib/association-safety'

interface Props { assocCode: string }

const STATUS_BADGE: Record<InspectionStatus, { label: string; cls: string }> = {
  scheduled:    { label: 'Scheduled',    cls: 'bg-green-600 text-white' },
  due_soon:     { label: 'Due soon',     cls: 'bg-amber-500 text-white' },
  overdue:      { label: 'Overdue',      cls: 'bg-red-600 text-white' },
  completed:    { label: 'On file',      cls: 'bg-gray-400 text-white' },
  waived:       { label: 'Waived',       cls: 'bg-gray-300 text-gray-700' },
  not_required: { label: 'Not required', cls: 'bg-gray-100 text-gray-500 border border-gray-200' },
  missing:      { label: 'Missing',      cls: 'bg-red-100 text-red-700 border border-red-300' },
  not_tracked:  { label: 'Not on file',  cls: 'bg-gray-100 text-gray-500 border border-gray-200' },
}

const REQ_BADGE: Record<SafetyRequirement, { label: string; cls: string }> = {
  required_if_3plus: { label: 'Required · 3+ stories', cls: 'bg-red-50 text-red-700 border border-red-200' },
  recommended:       { label: 'Recommended',           cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
}

export default function SafetyManager({ assocCode }: Props) {
  const [rows, setRows] = useState<AssociationSafetyInspection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // editor state: which type + which row id (null id = new building)
  const [editing, setEditing] = useState<{ type: string; row: AssociationSafetyInspection | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetch(`/api/admin/associations/${assocCode}/safety`)
      .then(r => r.ok ? r.json() : r.json().then(b => { throw new Error(b?.error ?? 'load failed') }))
      .then(d => { if (!cancelled) setRows(d.inspections ?? []) })
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [assocCode, reloadKey])

  function refresh() { setReloadKey(k => k + 1); setEditing(null) }

  const byType = useMemo(() => {
    const m = new Map<string, AssociationSafetyInspection[]>()
    for (const r of rows) { const a = m.get(r.inspection_type) ?? []; a.push(r); m.set(r.inspection_type, a) }
    return m
  }, [rows])

  const attention = useMemo(() => {
    let n = 0
    for (const def of INSPECTION_TYPES) {
      const list = byType.get(def.key) ?? []
      if (list.length === 0) {
        const st = inspectionStatus(def, null, null)
        if (st === 'missing') n++
      } else {
        for (const r of list) {
          const st = inspectionStatus(def, r, r.stories)
          if (st === 'overdue' || st === 'due_soon' || st === 'missing') n++
        }
      }
    }
    return n
  }, [byType])

  return (
    <div className="space-y-4">
      <div className={[
        'rounded-lg border px-4 py-3 text-sm font-medium',
        attention > 0 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800',
      ].join(' ')}>
        {attention > 0
          ? `⚠ ${attention} inspection${attention === 1 ? '' : 's'} need attention (overdue, due soon, or missing)`
          : '✓ No structural-safety inspections need attention'}
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>}
      {loading && <div className="text-sm text-gray-500">Loading inspections…</div>}

      {!loading && INSPECTION_TYPES.map(def => {
        const list = byType.get(def.key) ?? []
        const emptyStatus = inspectionStatus(def, null, null)
        const isEditingType = editing?.type === def.key
        return (
          <section key={def.key} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-semibold text-gray-900">{def.label}</h2>
                    <span className={`inline-flex items-center px-1.5 py-0 rounded text-[9px] font-mono font-semibold uppercase ${REQ_BADGE[def.requirement].cls}`}>
                      {REQ_BADGE[def.requirement].label}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1 leading-snug max-w-2xl">{def.description}</p>
                </div>
                <button
                  onClick={() => setEditing(isEditingType && editing?.row === null ? null : { type: def.key, row: null })}
                  className="text-[10px] font-mono uppercase text-[#f26a1b] hover:text-white hover:bg-[#f26a1b] px-2 py-1 rounded border border-[#f26a1b] transition-colors flex-shrink-0"
                >
                  + Add building
                </button>
              </div>

              {list.length === 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold uppercase ${STATUS_BADGE[emptyStatus].cls}`}>
                    {STATUS_BADGE[emptyStatus].label}
                  </span>
                  <span className="text-[11px] text-gray-400">Nothing on file.</span>
                </div>
              )}

              {list.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {list.map(r => (
                    <InspectionRow key={r.id} def={def} row={r} assocCode={assocCode}
                      onEdit={() => setEditing({ type: def.key, row: r })} onChanged={refresh} />
                  ))}
                </ul>
              )}
            </div>

            {isEditingType && (
              <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-3">
                <InspectionEditor
                  assocCode={assocCode}
                  inspectionType={def.key}
                  existing={editing?.row ?? null}
                  onSaved={refresh}
                  onCancel={() => setEditing(null)}
                />
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function fmtDays(dateStr: string | null): { txt: string; cls: string } | null {
  if (!dateStr) return null
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0)
  const t = new Date(); t.setHours(0, 0, 0, 0)
  const days = Math.round((d.getTime() - t.getTime()) / 86_400_000)
  if (days < 0) return { txt: `overdue ${Math.abs(days)}d`, cls: 'text-red-600 font-semibold' }
  if (days <= 90) return { txt: `in ${days}d`, cls: 'text-amber-700 font-medium' }
  return { txt: `in ${days}d`, cls: 'text-gray-400' }
}

function InspectionRow({ def, row, assocCode, onEdit, onChanged }: {
  def: InspectionTypeDef
  row: AssociationSafetyInspection
  assocCode: string
  onEdit: () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const status = inspectionStatus(def, row, row.stories)
  const due = fmtDays(row.next_due_date)

  async function openReport() {
    const res = await fetch(`/api/admin/associations/${assocCode}/safety/${row.id}`)
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(`Open failed: ${d?.error ?? res.status}`); return }
    const d = await res.json()
    if (d?.url) window.open(d.url, '_blank', 'noopener,noreferrer')
  }
  async function archive() {
    if (!confirm('Archive this inspection record? It moves to history.')) return
    setBusy(true)
    const res = await fetch(`/api/admin/associations/${assocCode}/safety/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive' }),
    })
    setBusy(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(`Archive failed: ${d?.error ?? res.status}`); return }
    onChanged()
  }

  return (
    <li className="bg-gray-50 border border-gray-200 rounded p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold uppercase ${STATUS_BADGE[status].cls}`}>
          {STATUS_BADGE[status].label}
        </span>
        <span className="text-sm font-medium text-gray-800">{row.building_label ?? 'Whole association'}</span>
        {row.stories != null && <span className="text-[10px] font-mono text-gray-400">{row.stories} stories</span>}
        {row.year_built != null && <span className="text-[10px] font-mono text-gray-400">built {row.year_built}</span>}
        {row.coastal && <span className="text-[9px] font-mono uppercase bg-blue-50 text-blue-600 px-1 rounded">coastal</span>}
        <span className="flex-1" />
        <button onClick={onEdit} className="text-[10px] font-mono uppercase text-gray-500 hover:text-[#f26a1b] px-1.5 py-0.5 rounded border border-gray-200 hover:border-[#f26a1b]">Edit</button>
        <button onClick={archive} disabled={busy} className="text-[10px] font-mono uppercase text-gray-400 hover:text-amber-700 px-1.5 py-0.5">{busy ? '…' : 'Archive'}</button>
      </div>
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[11px]">
        <Field k="Last completed" v={row.last_completed_date ?? '—'} />
        <Field k="Next due" v={row.next_due_date ?? '—'} extra={due ? <span className={`ml-1 ${due.cls}`}>· {due.txt}</span> : null} />
        <Field k="Provider" v={row.provider ?? '—'} />
        <div>
          <dt className="text-gray-400 font-mono uppercase tracking-wide text-[9px]">Report</dt>
          <dd>{row.report_storage_path
            ? <button onClick={openReport} className="text-[#f26a1b] hover:underline font-mono text-[11px]">📦 view <span className="text-gray-400">(system)</span></button>
            : row.drive_url
              ? <button onClick={openReport} className="text-[#f26a1b] hover:underline font-mono text-[11px]">🗂 view <span className="text-gray-400">(Drive)</span></button>
              : <span className="text-amber-600 font-mono text-[11px]">none</span>}</dd>
        </div>
      </div>
      {row.waived && <div className="mt-1 text-[11px] text-gray-500">Waived{row.waived_reason ? `: ${row.waived_reason}` : ''}</div>}
      {row.notes && <div className="mt-1 text-[11px] text-gray-500">{row.notes}</div>}
    </li>
  )
}

function Field({ k, v, extra }: { k: string; v: string; extra?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-gray-400 font-mono uppercase tracking-wide text-[9px]">{k}</dt>
      <dd className="text-gray-800">{v}{extra}</dd>
    </div>
  )
}

function InspectionEditor({ assocCode, inspectionType, existing, onSaved, onCancel }: {
  assocCode: string; inspectionType: string; existing: AssociationSafetyInspection | null
  onSaved: () => void; onCancel: () => void
}) {
  const def = inspectionTypeDef(inspectionType)!
  const [buildingLabel, setBuildingLabel] = useState(existing?.building_label ?? '')
  const [yearBuilt, setYearBuilt] = useState(existing?.year_built?.toString() ?? '')
  const [stories, setStories] = useState(existing?.stories?.toString() ?? '')
  const [coastal, setCoastal] = useState(existing?.coastal ?? false)
  const [lastCompleted, setLastCompleted] = useState(existing?.last_completed_date ?? '')
  const [nextDue, setNextDue] = useState(existing?.next_due_date ?? '')
  const [provider, setProvider] = useState(existing?.provider ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [waived, setWaived] = useState(existing?.waived ?? false)
  const [waivedReason, setWaivedReason] = useState(existing?.waived_reason ?? '')
  const [driveUrl, setDriveUrl] = useState(existing?.drive_url ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suggested = suggestedNextDue(def, lastCompleted || null, yearBuilt ? Number(yearBuilt) : null, coastal)

  async function uploadReport() {
    if (!file) return null
    const urlRes = await fetch(`/api/admin/associations/${assocCode}/safety/upload-url`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, inspection_type: inspectionType }),
    })
    const urlData = await urlRes.json()
    if (!urlRes.ok) throw new Error(urlData?.error ?? 'Could not get upload URL')
    const put = await fetch(urlData.signed_url, {
      method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/pdf', 'x-upsert': 'false' },
    })
    if (!put.ok) {
      let detail = `HTTP ${put.status}`
      try { const j = await put.json() as { message?: string; error?: string }; detail = j?.message ?? j?.error ?? detail } catch {}
      throw new Error(`Report upload failed: ${detail}`)
    }
    return {
      report_storage_path: urlData.storage_path, report_filename: file.name,
      report_mime_type: file.type || 'application/pdf', report_file_size_bytes: file.size,
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const report = await uploadReport()
      const payload: Record<string, unknown> = {
        building_label: buildingLabel || null,
        year_built: yearBuilt || null, stories: stories || null, coastal,
        last_completed_date: lastCompleted || null, next_due_date: nextDue || null,
        provider, notes, waived, waived_reason: waived ? waivedReason : null,
        drive_url: driveUrl || null,
        ...(report ?? {}),
      }
      let res: Response
      if (existing) {
        res = await fetch(`/api/admin/associations/${assocCode}/safety/${existing.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
      } else {
        res = await fetch(`/api/admin/associations/${assocCode}/safety`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inspection_type: inspectionType, ...payload }),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Save failed')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b] bg-white'
  const lblCls = 'text-[10px] font-mono uppercase tracking-wide text-gray-600'

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="text-[11px] text-gray-500 font-mono uppercase">
        {existing ? 'Edit inspection record' : 'Add a building / inspection record'}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="block"><span className={lblCls}>Building label</span>
          <input value={buildingLabel} onChange={e => setBuildingLabel(e.target.value)} disabled={busy} placeholder="e.g. Building A (blank = whole assoc)" className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Year built</span>
          <input inputMode="numeric" value={yearBuilt} onChange={e => setYearBuilt(e.target.value)} disabled={busy} className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Stories</span>
          <input inputMode="numeric" value={stories} onChange={e => setStories(e.target.value)} disabled={busy} className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Last completed</span>
          <input type="date" value={lastCompleted} onChange={e => setLastCompleted(e.target.value)} disabled={busy} className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Next due</span>
          <input type="date" value={nextDue} onChange={e => setNextDue(e.target.value)} disabled={busy} className={inputCls} />
          {suggested && suggested !== nextDue && (
            <button type="button" onClick={() => setNextDue(suggested)} className="mt-1 text-[10px] font-mono text-[#f26a1b] hover:underline">
              Use suggested: {suggested}
            </button>
          )}
        </label>
        <label className="block"><span className={lblCls}>Inspection firm</span>
          <input value={provider} onChange={e => setProvider(e.target.value)} disabled={busy} className={inputCls} /></label>
      </div>

      <label className="inline-flex items-center gap-2 text-[11px] text-gray-700">
        <input type="checkbox" checked={coastal} onChange={e => setCoastal(e.target.checked)} disabled={busy} />
        Within 3 miles of the coast (Milestone clock is 25 years instead of 30)
      </label>

      <label className="block"><span className={lblCls}>Notes</span>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} disabled={busy} rows={2} className={inputCls} /></label>

      <div>
        <span className={lblCls}>Inspection report / study (PDF)</span>
        <input type="file" accept="application/pdf,.pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} disabled={busy}
          className="mt-1 block text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-mono file:uppercase file:bg-[#f26a1b]/10 file:text-[#f26a1b] hover:file:bg-[#f26a1b]/20" />
        {existing?.report_storage_path && !file && (
          <span className="text-[10px] text-gray-400 block mt-1">Current: {existing.report_filename ?? 'on file'} — choose a file to replace.</span>
        )}
      </div>

      <label className="block"><span className={lblCls}>…or Google Drive link</span>
        <input value={driveUrl} onChange={e => setDriveUrl(e.target.value)} disabled={busy}
          placeholder="https://drive.google.com/…  (paste instead of uploading; update anytime)" className={inputCls} />
        <span className="text-[10px] text-gray-500 block mt-0.5">Use this when the report stays in Drive. The uploaded file takes priority if both are set.</span>
      </label>

      <label className="inline-flex items-center gap-2 text-[11px] text-gray-700">
        <input type="checkbox" checked={waived} onChange={e => setWaived(e.target.checked)} disabled={busy} />
        Not applicable / waived
      </label>
      {waived && (
        <input value={waivedReason} onChange={e => setWaivedReason(e.target.value)} disabled={busy}
          placeholder="Why? e.g. building is 2 stories — Milestone/SIRS not triggered" className={inputCls} />
      )}

      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="text-xs font-mono uppercase text-gray-500 hover:text-gray-800 px-3 py-1.5">Cancel</button>
        <button type="submit" disabled={busy}
          className="bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white text-xs font-semibold uppercase tracking-wide px-4 py-1.5 rounded [font-family:var(--font-mono)]">
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Save inspection'}
        </button>
      </div>
    </form>
  )
}
