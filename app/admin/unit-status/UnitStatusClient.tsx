'use client'

import { useEffect, useMemo, useState } from 'react'
import DriveImport from '@/app/admin/documents/inbox/DriveImport'
import UnitDetailModal from './UnitDetailModal'
import ManualUnitUpload from './ManualUnitUpload'

interface UnitRow {
  associationCode: string; associationName: string | null; unit: string | null; accountNumber: string
  ownerName: string; occupancy: 'owner_occupied' | 'leased' | 'vacant' | null; kind: string
  tenantName: string | null; leaseEndDate: string | null; missingCount: number
}

const OCCUPANCY_LABEL: Record<string, string> = { owner_occupied: 'Owner-occupied', leased: 'Leased', vacant: 'Vacant' }

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const ms = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(ms / (24 * 60 * 60 * 1000))
}

function OccupancyBadge({ status }: { status: UnitRow['occupancy'] }) {
  if (!status) return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">Not set</span>
  const cls = status === 'vacant' ? 'bg-amber-100 text-amber-800' : status === 'leased' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>{OCCUPANCY_LABEL[status]}</span>
}

export default function UnitStatusClient({ associations }: { associations: Array<{ association_code: string; association_name: string }> }) {
  const [rows, setRows] = useState<UnitRow[] | null>(null)
  const [assocFilter, setAssocFilter] = useState('')
  const [occFilter, setOccFilter] = useState('')
  const [expiringOnly, setExpiringOnly] = useState(false)
  const [surveyPreview, setSurveyPreview] = useState<{ sent: number; scanned: number } | null>(null)
  const [surveyBusy, setSurveyBusy] = useState(false)
  const [surveyMsg, setSurveyMsg] = useState<string | null>(null)
  const [detailFor, setDetailFor] = useState<{ assoc: string; account: string } | null>(null)

  useEffect(() => {
    fetch('/api/admin/unit-status').then(r => r.json()).then(d => setRows(d.rows ?? [])).catch(() => setRows([]))
  }, [])

  const filtered = useMemo(() => {
    if (!rows) return []
    return rows.filter(r => {
      if (assocFilter && r.associationCode !== assocFilter) return false
      if (occFilter === 'unset' && r.occupancy) return false
      if (occFilter && occFilter !== 'unset' && r.occupancy !== occFilter) return false
      if (expiringOnly) {
        const d = daysUntil(r.leaseEndDate)
        if (d === null || d > 30) return false
      }
      return true
    }).sort((a, b) => {
      const da = daysUntil(a.leaseEndDate); const db = daysUntil(b.leaseEndDate)
      if (da !== null && db !== null) return da - db
      if (da !== null) return -1
      if (db !== null) return 1
      return (a.associationCode + a.unit).localeCompare(b.associationCode + b.unit)
    })
  }, [rows, assocFilter, occFilter, expiringOnly])

  const unitsByAssoc = useMemo(() => {
    const out: Record<string, { accountNumber: string; unit: string | null; ownerName: string }[]> = {}
    for (const r of rows ?? []) {
      if (!out[r.associationCode]) out[r.associationCode] = []
      out[r.associationCode].push({ accountNumber: r.accountNumber, unit: r.unit, ownerName: r.ownerName })
    }
    return out
  }, [rows])

  if (!rows) return <p className="text-sm text-gray-400">Loading…</p>

  const selectCls = 'rounded border border-gray-300 px-2.5 py-1.5 text-xs'

  async function previewSurvey() {
    setSurveyBusy(true); setSurveyMsg(null); setSurveyPreview(null)
    try {
      const res = await fetch('/api/admin/unit-status/send-survey', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assoc: assocFilter || undefined }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'failed')
      setSurveyPreview({ sent: j.sent, scanned: j.scanned })
    } catch (e) { setSurveyMsg(e instanceof Error ? e.message : String(e)) } finally { setSurveyBusy(false) }
  }

  async function sendSurveyForReal() {
    setSurveyBusy(true); setSurveyMsg(null)
    try {
      const res = await fetch('/api/admin/unit-status/send-survey', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assoc: assocFilter || undefined, confirm: true }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'failed')
      setSurveyMsg(`Sent to ${j.sent} owner(s).`)
      setSurveyPreview(null)
    } catch (e) { setSurveyMsg(e instanceof Error ? e.message : String(e)) } finally { setSurveyBusy(false) }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={assocFilter} onChange={e => { setAssocFilter(e.target.value); setSurveyPreview(null); setSurveyMsg(null) }} className={selectCls}>
          <option value="">All associations</option>
          {associations.map(a => <option key={a.association_code} value={a.association_code}>{a.association_name} ({a.association_code})</option>)}
        </select>
        <select value={occFilter} onChange={e => setOccFilter(e.target.value)} className={selectCls}>
          <option value="">All occupancy</option>
          <option value="owner_occupied">Owner-occupied</option>
          <option value="leased">Leased</option>
          <option value="vacant">Vacant</option>
          <option value="unset">Not set</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={expiringOnly} onChange={e => setExpiringOnly(e.target.checked)} />
          Lease expiring within 30 days
        </label>
        <span className="text-xs text-gray-400">{filtered.length} of {rows.length} units</span>

        <div className="ml-auto flex items-center gap-2">
          {surveyPreview ? (
            <>
              <span className="text-xs text-gray-600">Would email {surveyPreview.sent} of {surveyPreview.scanned} owner(s){assocFilter ? ` in ${assocFilter}` : ''}.</span>
              <button onClick={sendSurveyForReal} disabled={surveyBusy} className="rounded bg-[#f26a1b] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#d85a10] disabled:opacity-50">
                {surveyBusy ? 'Sending…' : 'Confirm send'}
              </button>
              <button onClick={() => setSurveyPreview(null)} className="text-xs text-gray-400 hover:underline">Cancel</button>
            </>
          ) : (
            <button onClick={previewSurvey} disabled={surveyBusy} className="rounded border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {surveyBusy ? 'Checking…' : 'Send occupancy & insurance survey…'}
            </button>
          )}
        </div>
      </div>
      {surveyMsg && <div className="mb-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">{surveyMsg}</div>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Association / Unit</th>
              <th className="px-4 py-2.5 font-medium">Owner</th>
              <th className="px-4 py-2.5 font-medium">Occupancy</th>
              <th className="px-4 py-2.5 font-medium">Tenant</th>
              <th className="px-4 py-2.5 font-medium">Lease end</th>
              <th className="px-4 py-2.5 font-medium">Docs missing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((r, i) => {
              const d = daysUntil(r.leaseEndDate)
              const expiring = d !== null && d <= 30
              return (
                <tr key={`${r.associationCode}-${r.accountNumber}-${i}`} className="align-top hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-700">
                    {r.associationName ?? r.associationCode}{r.unit ? ` · Unit ${r.unit}` : ''} <span className="text-gray-400">({r.accountNumber})</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{r.ownerName || '—'}</td>
                  <td className="px-4 py-2.5"><OccupancyBadge status={r.occupancy} /></td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{r.tenantName ?? '—'}</td>
                  <td className={`px-4 py-2.5 text-xs ${expiring ? 'font-semibold text-red-700' : 'text-gray-600'}`}>
                    {r.leaseEndDate ?? '—'}{expiring ? ` (${d! < 0 ? 'expired' : `${d}d`})` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <button onClick={() => setDetailFor({ assoc: r.associationCode, account: r.accountNumber })} className="hover:underline">
                      {r.missingCount === 0
                        ? <span className="text-emerald-700">✓ complete</span>
                        : <span className="text-amber-700">{r.missingCount} missing</span>}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="p-6 text-center text-sm text-gray-400">No units match this filter.</p>}
      </div>

      <div className="mt-4 space-y-3">
        <ManualUnitUpload associations={associations} unitsByAssoc={unitsByAssoc} />
        <DriveImport onImported={() => setSurveyMsg('Imported — review in Document Inbox to file it.')} />
      </div>

      {detailFor && (
        <UnitDetailModal assoc={detailFor.assoc} account={detailFor.account} onClose={() => setDetailFor(null)} />
      )}
    </div>
  )
}
