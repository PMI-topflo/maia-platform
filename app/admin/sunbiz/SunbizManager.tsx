'use client'

// =====================================================================
// /admin/sunbiz/SunbizManager.tsx
//
// Table of every active association with its annual-report filing status
// for the selected year + a per-row "mark filed" form. Status is derived
// client-side from lib/sunbiz.ts so the deadline math matches the cron.
// =====================================================================

import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  currentReportYear, dueDate, dissolutionDate, sunbizStatus, statusLabel, statusNeedsAttention,
  SUNBIZ_LATE_FEE_USD, type AssociationAnnualReport, type SunbizStatus,
} from '@/lib/sunbiz'

interface Row {
  association_code:       string
  association_name:       string | null
  sunbiz_document_number: string | null
  sunbiz_status:          string | null
  report:                 AssociationAnnualReport | null
}

const STATUS_BADGE: Record<SunbizStatus, string> = {
  filed:            'bg-green-600 text-white',
  late_filed:       'bg-green-700 text-white',
  upcoming:         'bg-gray-100 text-gray-500 border border-gray-200',
  due_soon:         'bg-amber-500 text-white',
  overdue:          'bg-red-600 text-white',
  dissolution_risk: 'bg-red-800 text-white',
}

export default function SunbizManager() {
  const thisYear = currentReportYear()
  const [year, setYear] = useState(thisYear)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)  // association_code

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetch(`/api/admin/sunbiz?year=${year}`)
      .then(r => r.ok ? r.json() : r.json().then(b => { throw new Error(b?.error ?? 'load failed') }))
      .then(d => { if (!cancelled) setRows(d.rows ?? []) })
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [year, reloadKey])

  function refresh() { setReloadKey(k => k + 1); setEditing(null) }

  const summary = useMemo(() => {
    let filed = 0, attention = 0, risk = 0
    for (const r of rows) {
      const st = sunbizStatus(year, r.report?.filed_date ?? null)
      if (st === 'filed' || st === 'late_filed') filed++
      if (statusNeedsAttention(st)) attention++
      if (st === 'dissolution_risk') risk++
    }
    return { filed, attention, risk, total: rows.length }
  }, [rows, year])

  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className={[
          'rounded-lg border px-4 py-3 text-sm font-medium flex-1',
          summary.risk > 0 ? 'bg-red-50 border-red-300 text-red-900'
            : summary.attention > 0 ? 'bg-amber-50 border-amber-200 text-amber-800'
            : 'bg-green-50 border-green-200 text-green-800',
        ].join(' ')}>
          {summary.risk > 0 && `🚨 ${summary.risk} at DISSOLUTION RISK · `}
          {summary.attention > 0
            ? `⚠ ${summary.attention} need filing (due ${dueDate(year)})`
            : `✓ All ${summary.total} associations filed for ${year}`}
          <span className="text-xs font-mono text-gray-500 ml-2">{summary.filed}/{summary.total} filed</span>
        </div>
        <label className="text-xs font-mono uppercase text-gray-600 flex items-center gap-2">
          Year
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="text-sm border border-gray-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-[#f26a1b]">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      {/* Rule-based deadline (not on any document — defined by Florida statute). */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-[11px] text-gray-600 font-mono">
        <span className="font-semibold text-gray-800">Last date to file without penalty: {dueDate(year)}</span>
        {' · '}${SUNBIZ_LATE_FEE_USD} non-waivable late fee after
        {' · '}administrative dissolution {dissolutionDate(year)} (4th Friday of September) if still unfiled
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>}
      {loading && <div className="text-sm text-gray-500">Loading…</div>}

      {!loading && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-mono uppercase tracking-wide text-gray-500">
                <th className="text-left px-4 py-2">Association</th>
                <th className="text-left px-4 py-2">Doc #</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Filed</th>
                <th className="text-left px-4 py-2">Confirmation</th>
                <th className="text-right px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => {
                const st = sunbizStatus(year, r.report?.filed_date ?? null)
                const isEditing = editing === r.association_code
                return (
                  <Fragment key={r.association_code}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-800">{r.association_name ?? r.association_code}</div>
                        <div className="text-[10px] font-mono text-gray-400">{r.association_code}</div>
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-gray-500">{r.sunbiz_document_number ?? '—'}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold uppercase ${STATUS_BADGE[st]}`}>
                          {statusLabel(st)}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-gray-600">{r.report?.filed_date ?? '—'}</td>
                      <td className="px-4 py-2 font-mono text-[11px] text-gray-600">{r.report?.confirmation_number ?? '—'}</td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => setEditing(isEditing ? null : r.association_code)}
                          className="text-[10px] font-mono uppercase text-[#f26a1b] hover:text-white hover:bg-[#f26a1b] px-2 py-1 rounded border border-[#f26a1b] transition-colors">
                          {r.report?.filed_date ? 'Edit' : 'Mark filed'}
                        </button>
                      </td>
                    </tr>
                    {isEditing && (
                      <tr className="bg-gray-50/60">
                        <td colSpan={6} className="px-4 py-3">
                          <FileForm row={r} year={year} status={st} onSaved={refresh} onCancel={() => setEditing(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FileForm({ row, year, status, onSaved, onCancel }: {
  row: Row; year: number; status: SunbizStatus; onSaved: () => void; onCancel: () => void
}) {
  const isLate = status === 'overdue' || status === 'dissolution_risk' || status === 'late_filed'
  const [filedDate, setFiledDate] = useState(row.report?.filed_date ?? '')
  const [confirmation, setConfirmation] = useState(row.report?.confirmation_number ?? '')
  const [fee, setFee] = useState(row.report?.fee_paid_usd?.toString() ?? (isLate ? String(61.25 + SUNBIZ_LATE_FEE_USD) : '61.25'))
  const [notes, setNotes] = useState(row.report?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(clear = false) {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/admin/sunbiz', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          association_code: row.association_code,
          report_year: year,
          filed_date: clear ? null : (filedDate || null),
          confirmation_number: clear ? null : confirmation,
          fee_paid_usd: clear ? null : fee,
          notes,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'Save failed')
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
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <label className="block"><span className={lblCls}>Filed date</span>
          <input type="date" value={filedDate} onChange={e => setFiledDate(e.target.value)} disabled={busy} className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Confirmation #</span>
          <input value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Fee paid (USD){isLate ? ' · incl. late fee' : ''}</span>
          <input inputMode="numeric" value={fee} onChange={e => setFee(e.target.value)} disabled={busy} className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Notes</span>
          <input value={notes} onChange={e => setNotes(e.target.value)} disabled={busy} className={inputCls} /></label>
      </div>
      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
      <div className="flex items-center justify-end gap-2">
        {row.report?.filed_date && (
          <button type="button" onClick={() => save(true)} disabled={busy}
            className="text-[10px] font-mono uppercase text-gray-400 hover:text-red-700 px-2 py-1.5">Clear filing</button>
        )}
        <button type="button" onClick={onCancel} disabled={busy} className="text-xs font-mono uppercase text-gray-500 hover:text-gray-800 px-3 py-1.5">Cancel</button>
        <button type="button" onClick={() => save(false)} disabled={busy}
          className="bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white text-xs font-semibold uppercase tracking-wide px-4 py-1.5 rounded [font-family:var(--font-mono)]">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
