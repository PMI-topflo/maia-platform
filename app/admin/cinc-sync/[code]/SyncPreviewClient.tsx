'use client'

// =====================================================================
// /admin/cinc-sync/[code]/SyncPreviewClient.tsx
// Fetches the diff from /api/admin/cinc-sync/[code]/preview, shows it
// as four tickable buckets, and POSTs the picked rows to /apply.
// =====================================================================

import { useEffect, useState } from 'react'

interface SyncPreview {
  assocCode:           string
  cincUnitCount:       number
  cincBoardCount:      number
  ownerInserts:        Array<{ cinc_property_id: number; unit_number: string | null; first_name: string | null; last_name: string | null; emails: string | null; phone: string | null; address: string | null }>
  ownerUpdates:        Array<{ owners_id: number; cinc_property_id: number; unit_number: string | null; changes: Record<string, { current: string | null; proposed: string | null }> }>
  boardInserts:        Array<{ cinc_board_member_id: number; name: string | null; email: string | null; role: string | null; phone: string | null }>
  boardDeactivations:  Array<{ abm_id: string; name: string | null; email: string | null; role: string | null }>
  ownerMatches:        number
  boardMatches:        number
}

interface ApplyResult {
  ownersInserted:   number
  ownersUpdated:    number
  boardInserted:    number
  boardDeactivated: number
  errors:           string[]
}

export default function SyncPreviewClient({ assocCode }: { assocCode: string }) {
  const [preview,  setPreview]  = useState<SyncPreview | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [selOwnerIns, setSelOwnerIns] = useState<Set<number>>(new Set())
  const [selOwnerUpd, setSelOwnerUpd] = useState<Set<number>>(new Set())
  const [selBoardIns, setSelBoardIns] = useState<Set<number>>(new Set())
  const [selBoardDe,  setSelBoardDe]  = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [result,   setResult]   = useState<ApplyResult | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetch(`/api/admin/cinc-sync/${assocCode}/preview`)
      .then(r => r.ok ? r.json() : r.json().then(b => { throw new Error(b?.error ?? 'preview failed') }))
      .then((data: SyncPreview) => {
        if (cancelled) return
        setPreview(data)
        // Pre-select everything by default — staff just unticks anything they don't want
        setSelOwnerIns(new Set(data.ownerInserts.map(p => p.cinc_property_id)))
        setSelOwnerUpd(new Set(data.ownerUpdates.map(p => p.owners_id)))
        setSelBoardIns(new Set(data.boardInserts.map(p => p.cinc_board_member_id)))
        setSelBoardDe (new Set(data.boardDeactivations.map(p => p.abm_id)))
      })
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [assocCode])

  async function onApply() {
    if (!preview) return
    setApplying(true); setError(null); setResult(null)
    try {
      const res = await fetch(`/api/admin/cinc-sync/${assocCode}/apply`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          insertOwnerCincIds: [...selOwnerIns],
          updateOwnerIds:     [...selOwnerUpd],
          insertBoardCincIds: [...selBoardIns],
          deactivateBoardIds: [...selBoardDe],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'apply failed')
      setResult(data as ApplyResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(false)
    }
  }

  if (loading)        return <div className="text-sm text-gray-500">Loading diff from CINC…</div>
  if (error)          return <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>
  if (!preview)       return null

  const totalToApply = selOwnerIns.size + selOwnerUpd.size + selBoardIns.size + selBoardDe.size
  const nothingPending =
    preview.ownerInserts.length      === 0 &&
    preview.ownerUpdates.length      === 0 &&
    preview.boardInserts.length      === 0 &&
    preview.boardDeactivations.length === 0

  return (
    <div className="space-y-4">
      {/* Top summary */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Stat label="Units in CINC"          value={preview.cincUnitCount}             color="text-gray-700" />
        <Stat label="Owner matches"          value={preview.ownerMatches}              color="text-green-700" />
        <Stat label="Board in CINC"          value={preview.cincBoardCount}            color="text-gray-700" />
        <Stat label="Board matches"          value={preview.boardMatches}              color="text-green-700" />
      </div>

      {result && (
        <div className="bg-white border border-green-300 rounded-lg p-4 text-sm text-green-800">
          <div className="font-semibold mb-1">Applied:</div>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>Owners inserted: {result.ownersInserted}</li>
            <li>Owners updated: {result.ownersUpdated}</li>
            <li>Board members inserted: {result.boardInserted}</li>
            <li>Board members deactivated: {result.boardDeactivated}</li>
          </ul>
          {result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="text-amber-700 cursor-pointer">{result.errors.length} error(s)</summary>
              <ul className="list-disc pl-5 mt-1 text-amber-700 text-xs">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Owner inserts */}
      {preview.ownerInserts.length > 0 && (
        <Bucket
          title={`New owners to insert (${preview.ownerInserts.length})`}
          headers={['', 'Unit', 'Name', 'Email', 'Phone']}
          rows={preview.ownerInserts.map(p => ({
            id:    p.cinc_property_id,
            cells: [
              p.unit_number ?? '—',
              [p.first_name, p.last_name].filter(Boolean).join(' ') || '—',
              p.emails ?? '—',
              p.phone  ?? '—',
            ],
          }))}
          selected={selOwnerIns}
          onToggle={id => setSelOwnerIns(prev => toggleNum(prev, id as number))}
        />
      )}

      {/* Owner updates */}
      {preview.ownerUpdates.length > 0 && (
        <Bucket
          title={`Owner records to update (${preview.ownerUpdates.length})`}
          headers={['', 'Unit', 'Changed fields']}
          rows={preview.ownerUpdates.map(u => ({
            id:    u.owners_id,
            cells: [
              u.unit_number ?? '—',
              <span key="d" className="text-xs text-gray-600">
                {Object.entries(u.changes).map(([f, d]) => (
                  <div key={f}><span className="font-mono">{f}</span>: <s className="text-red-500">{d.current ?? '—'}</s> → <strong className="text-green-700">{d.proposed ?? '—'}</strong></div>
                ))}
              </span>,
            ],
          }))}
          selected={selOwnerUpd}
          onToggle={id => setSelOwnerUpd(prev => toggleNum(prev, id as number))}
        />
      )}

      {/* Board inserts */}
      {preview.boardInserts.length > 0 && (
        <Bucket
          title={`New board members to insert (${preview.boardInserts.length})`}
          headers={['', 'Name', 'Role', 'Email', 'Phone']}
          rows={preview.boardInserts.map(b => ({
            id:    b.cinc_board_member_id,
            cells: [b.name ?? '—', b.role ?? '—', b.email ?? '—', b.phone ?? '—'],
          }))}
          selected={selBoardIns}
          onToggle={id => setSelBoardIns(prev => toggleNum(prev, id as number))}
        />
      )}

      {/* Board deactivations */}
      {preview.boardDeactivations.length > 0 && (
        <Bucket
          title={`Board members to deactivate — no longer in CINC (${preview.boardDeactivations.length})`}
          headers={['', 'Name', 'Role', 'Email']}
          rows={preview.boardDeactivations.map(b => ({
            id:    b.abm_id,
            cells: [b.name ?? '—', b.role ?? '—', b.email ?? '—'],
          }))}
          selected={selBoardDe}
          onToggle={id => setSelBoardDe(prev => toggleStr(prev, id as string))}
        />
      )}

      {/* Apply bar */}
      {!nothingPending && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between sticky bottom-4">
          <div className="text-sm text-gray-600">
            <strong>{totalToApply}</strong> change{totalToApply === 1 ? '' : 's'} selected
          </div>
          <button
            onClick={onApply}
            disabled={applying || totalToApply === 0}
            className="bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white text-xs font-medium uppercase tracking-wide px-5 py-2 rounded transition-colors [font-family:var(--font-mono)]"
          >
            {applying ? 'Applying…' : `Apply ${totalToApply} change${totalToApply === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {nothingPending && !result && (
        <div className="bg-white border border-green-300 rounded-lg p-6 text-center text-sm text-green-700">
          ✓ Everything matches. No changes needed.
        </div>
      )}
    </div>
  )
}

function toggleNum(prev: Set<number>, n: number): Set<number> {
  const next = new Set(prev)
  if (next.has(n)) next.delete(n); else next.add(n)
  return next
}
function toggleStr(prev: Set<string>, s: string): Set<string> {
  const next = new Set(prev)
  if (next.has(s)) next.delete(s); else next.add(s)
  return next
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="text-[0.6rem] font-mono uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  )
}

function Bucket(props: {
  title:    string
  headers:  string[]
  rows:     Array<{ id: number | string; cells: React.ReactNode[] }>
  selected: Set<number> | Set<string>
  onToggle: (id: number | string) => void
}) {
  function allSelected(): boolean {
    if (props.rows.length === 0) return false
    return props.rows.every(r => (props.selected as Set<unknown>).has(r.id))
  }
  function toggleAll() {
    for (const r of props.rows) {
      if (allSelected()) props.onToggle(r.id)
      else if (!(props.selected as Set<unknown>).has(r.id)) props.onToggle(r.id)
    }
  }
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide [font-family:var(--font-mono)]">{props.title}</span>
        <button onClick={toggleAll} className="text-[10px] font-mono text-gray-500 hover:text-[#f26a1b] uppercase tracking-wide">
          {allSelected() ? 'Deselect all' : 'Select all'}
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50">
            {props.headers.map((h, i) => (
              <th key={i} className="text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {props.rows.map(r => (
            <tr key={r.id}>
              <td className="px-4 py-2 w-8">
                <input
                  type="checkbox"
                  checked={(props.selected as Set<unknown>).has(r.id)}
                  onChange={() => props.onToggle(r.id)}
                  className="accent-[#f26a1b]"
                />
              </td>
              {r.cells.map((c, i) => (
                <td key={i} className="px-4 py-2 text-sm text-gray-800 align-top">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
