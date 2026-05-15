'use client'

// =====================================================================
// /admin/cinc-sync/[code]/SyncPreviewClient.tsx
// Side-by-side comparison. One row per unit (and one row per board
// member) — left side is what MAIA has, right side is what CINC has,
// status badge tells staff what'll happen on Apply.
// =====================================================================

import { useEffect, useMemo, useState, Fragment } from 'react'

interface OwnerSnap {
  account_number: string | null
  unit_number:    string | null
  first_name:     string | null
  last_name:      string | null
  emails:         string | null
  phone:          string | null
  address:        string | null
}
interface BoardSnap {
  name:  string | null
  email: string | null
  role:  string | null
  phone: string | null
}
interface OwnerCmp {
  status:           'insert' | 'update' | 'match' | 'only_in_maia'
  account_number:   string | null
  unit_number:      string | null
  owner_number:     number | null
  cinc_property_id: number | null
  owners_id:        number | null
  maia:             OwnerSnap | null
  cinc:             OwnerSnap | null
  changes?:         Record<string, { current: string | null; proposed: string | null }>
}
interface BoardCmp {
  status:               'insert' | 'match' | 'only_in_maia'
  cinc_board_member_id: number | null
  abm_id:               string | null
  maia:                 BoardSnap | null
  cinc:                 BoardSnap | null
}
interface SyncPreview {
  assocCode:                 string
  associationName:           string | null
  cincNumberOfUnits:         number | null
  cincPropertyRowsReturned:  number
  cincOwnerRowsConsidered:   number
  cincBoardCount:            number
  maiaActiveOwners:          number
  maiaActiveBoard:           number
  owners:                    OwnerCmp[]
  board:                     BoardCmp[]
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
  const [showMatched, setShowMatched] = useState(false)
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
        // Pre-select every actionable row (staff unticks what they don't want).
        const insOwners = data.owners.filter(o => o.status === 'insert' && o.cinc_property_id != null).map(o => o.cinc_property_id as number)
        const updOwners = data.owners.filter(o => o.status === 'update' && o.owners_id != null).map(o => o.owners_id as number)
        const insBoard  = data.board.filter(b => b.status === 'insert' && b.cinc_board_member_id != null).map(b => b.cinc_board_member_id as number)
        const deBoard   = data.board.filter(b => b.status === 'only_in_maia' && b.abm_id != null).map(b => b.abm_id as string)
        setSelOwnerIns(new Set(insOwners))
        setSelOwnerUpd(new Set(updOwners))
        setSelBoardIns(new Set(insBoard))
        setSelBoardDe(new Set(deBoard))
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
      // Re-fetch the preview so it reflects what's in DB now
      const fresh = await fetch(`/api/admin/cinc-sync/${assocCode}/preview`).then(r => r.json())
      setPreview(fresh)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(false)
    }
  }

  const visibleOwners = useMemo(() => {
    if (!preview) return []
    return showMatched ? preview.owners : preview.owners.filter(o => o.status !== 'match')
  }, [preview, showMatched])
  const visibleBoard = useMemo(() => {
    if (!preview) return []
    return showMatched ? preview.board : preview.board.filter(b => b.status !== 'match')
  }, [preview, showMatched])

  if (loading) return <div className="text-sm text-gray-500">Loading diff from CINC…</div>
  if (error)   return <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>
  if (!preview) return null

  const totalToApply = selOwnerIns.size + selOwnerUpd.size + selBoardIns.size + selBoardDe.size

  return (
    <div className="space-y-4">
      {/* Top summary */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-6 text-sm">
          <Stat label="CINC: units" value={preview.cincNumberOfUnits ?? '—'} color="text-gray-700" />
          <Stat label="MAIA: active owners" value={preview.maiaActiveOwners} color="text-gray-700" />
          <Stat label="CINC: board" value={preview.cincBoardCount} color="text-gray-700" />
          <Stat label="MAIA: active board" value={preview.maiaActiveBoard} color="text-gray-700" />
          <Stat label="Code" value={preview.assocCode} color="text-[#f26a1b]" mono />
        </div>
        <div className="text-[11px] text-gray-500 leading-snug">
          CINC <code className="bg-gray-100 px-1 rounded">/associations</code> reports <strong>{preview.cincNumberOfUnits ?? '?'}</strong> units.{' '}
          <code className="bg-gray-100 px-1 rounded">associationWithProperty</code> returned <strong>{preview.cincPropertyRowsReturned}</strong> property rows; after filtering to <em>current owners</em> we considered <strong>{preview.cincOwnerRowsConsidered}</strong> owner records (a unit with joint owners shows up as multiple rows below, grouped by account number).
        </div>
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

      <div className="flex items-center gap-2 text-xs">
        <label className="text-gray-500 flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showMatched} onChange={e => setShowMatched(e.target.checked)} className="accent-[#f26a1b]" />
          Show units / board already in sync
        </label>
      </div>

      {/* Owners — single side-by-side table */}
      <SectionTable
        title="Owners"
        leftLabel="MAIA (your platform)"
        rightLabel="CINC"
      >
        {visibleOwners.length === 0 && (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">{showMatched ? 'No owner rows.' : 'Everything in sync. Tick "Show units already in sync" to verify.'}</td></tr>
        )}
        {visibleOwners.map((cmp, idx) => {
          const id = cmp.cinc_property_id ?? cmp.owners_id ?? idx
          const sel = (() => {
            if (cmp.status === 'insert' && cmp.cinc_property_id != null) return selOwnerIns.has(cmp.cinc_property_id)
            if (cmp.status === 'update' && cmp.owners_id != null)        return selOwnerUpd.has(cmp.owners_id)
            return false
          })()
          const canPick = cmp.status === 'insert' || cmp.status === 'update'
          const onToggle = () => {
            if (cmp.status === 'insert' && cmp.cinc_property_id != null) {
              setSelOwnerIns(prev => toggleNum(prev, cmp.cinc_property_id as number))
            } else if (cmp.status === 'update' && cmp.owners_id != null) {
              setSelOwnerUpd(prev => toggleNum(prev, cmp.owners_id as number))
            }
          }
          return (
            <Fragment key={`o-${id}`}>
              <tr className={cmp.status === 'match' ? 'opacity-60' : ''}>
                <td className="px-3 py-2 align-top w-8">
                  {canPick && <input type="checkbox" checked={sel} onChange={onToggle} className="accent-[#f26a1b]" />}
                </td>
                <td className="px-3 py-2 align-top">
                  <UnitCell account={cmp.account_number} unit={cmp.unit_number} ownerNumber={cmp.owner_number} cincId={cmp.cinc_property_id} maiaId={cmp.owners_id} />
                </td>
                <td className="px-3 py-2 align-top">
                  <OwnerSide snap={cmp.maia} hidden={!cmp.maia} />
                </td>
                <td className="px-3 py-2 align-top">
                  <OwnerSide snap={cmp.cinc} hidden={!cmp.cinc} />
                </td>
                <td className="px-3 py-2 align-top text-right">
                  <StatusBadge status={cmp.status} />
                </td>
              </tr>
              {cmp.changes && (
                <tr>
                  <td colSpan={5} className="px-3 pb-3 pt-0 align-top">
                    <div className="ml-12 text-[11px] text-gray-500">
                      Will change:{' '}
                      {Object.entries(cmp.changes).map(([f, d], i) => (
                        <span key={f} className="mr-3">
                          {i > 0 && '· '}
                          <span className="font-mono text-gray-600">{f}</span>{' '}
                          <s className="text-red-500">{d.current ?? '∅'}</s>{' → '}
                          <strong className="text-green-700">{d.proposed ?? '∅'}</strong>
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </SectionTable>

      {/* Board — same shape */}
      <SectionTable
        title="Board Members"
        leftLabel="MAIA (your platform)"
        rightLabel="CINC"
      >
        {visibleBoard.length === 0 && (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">{showMatched ? 'No board rows.' : 'Everything in sync.'}</td></tr>
        )}
        {visibleBoard.map((cmp, idx) => {
          const id = cmp.cinc_board_member_id ?? cmp.abm_id ?? idx
          const sel = (() => {
            if (cmp.status === 'insert' && cmp.cinc_board_member_id != null) return selBoardIns.has(cmp.cinc_board_member_id)
            if (cmp.status === 'only_in_maia' && cmp.abm_id != null)         return selBoardDe.has(cmp.abm_id)
            return false
          })()
          const canPick = cmp.status === 'insert' || cmp.status === 'only_in_maia'
          const onToggle = () => {
            if (cmp.status === 'insert' && cmp.cinc_board_member_id != null) {
              setSelBoardIns(prev => toggleNum(prev, cmp.cinc_board_member_id as number))
            } else if (cmp.status === 'only_in_maia' && cmp.abm_id != null) {
              setSelBoardDe(prev => toggleStr(prev, cmp.abm_id as string))
            }
          }
          return (
            <tr key={`b-${id}`} className={cmp.status === 'match' ? 'opacity-60' : ''}>
              <td className="px-3 py-2 align-top w-8">
                {canPick && <input type="checkbox" checked={sel} onChange={onToggle} className="accent-[#f26a1b]" />}
              </td>
              <td className="px-3 py-2 align-top">
                <div className="text-[11px] font-mono text-gray-400">
                  {cmp.cinc_board_member_id != null && <>CINC #{cmp.cinc_board_member_id}</>}
                </div>
              </td>
              <td className="px-3 py-2 align-top">
                <BoardSide snap={cmp.maia} hidden={!cmp.maia} />
              </td>
              <td className="px-3 py-2 align-top">
                <BoardSide snap={cmp.cinc} hidden={!cmp.cinc} />
              </td>
              <td className="px-3 py-2 align-top text-right">
                <StatusBadge status={cmp.status} />
              </td>
            </tr>
          )
        })}
      </SectionTable>

      {/* Apply bar */}
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
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

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

function Stat({ label, value, color, mono }: { label: string; value: number | string; color: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[0.6rem] font-mono uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`text-lg font-semibold ${color} ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    insert:       'bg-green-100 text-green-700',
    update:       'bg-amber-100 text-amber-800',
    match:        'bg-gray-100 text-gray-500',
    only_in_maia: 'bg-blue-100 text-blue-700',
  }
  const labels: Record<string, string> = {
    insert:       'INSERT',
    update:       'UPDATE',
    match:        'IN SYNC',
    only_in_maia: 'KEEP (not in CINC)',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {labels[status] ?? status}
    </span>
  )
}

function UnitCell({ account, unit, ownerNumber, cincId, maiaId }: { account: string | null; unit: string | null; ownerNumber: number | null; cincId: number | null; maiaId: number | null }) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-900 font-mono">{account ?? '—'}</div>
      <div className="text-[11px] text-gray-500 leading-tight">
        Unit {unit ?? '—'}{ownerNumber != null && ownerNumber > 1 ? ` · Owner #${ownerNumber}` : ''}
      </div>
      <div className="text-[10px] font-mono text-gray-400 leading-tight mt-0.5">
        {cincId != null && <div>CINC PropertyID {cincId}</div>}
        {maiaId != null && <div>MAIA owners.id {maiaId}</div>}
      </div>
    </div>
  )
}

function OwnerSide({ snap, hidden }: { snap: OwnerSnap | null; hidden: boolean }) {
  if (hidden || !snap) return <span className="text-[11px] text-gray-400 italic">— not on this side —</span>
  const name = [snap.first_name, snap.last_name].filter(Boolean).join(' ') || '—'
  return (
    <div className="text-xs text-gray-700 leading-tight">
      <div className="font-medium text-gray-900">{name}</div>
      {snap.emails  && <div className="text-gray-500 break-all">{snap.emails}</div>}
      {snap.phone   && <div className="text-gray-500 font-mono">{snap.phone}</div>}
      {snap.address && <div className="text-gray-400 text-[11px]">{snap.address}</div>}
      {(snap.account_number || snap.unit_number) && (
        <div className="text-[10px] text-gray-400 font-mono mt-0.5">
          {snap.account_number ?? '—'}{snap.unit_number ? ` · Unit ${snap.unit_number}` : ''}
        </div>
      )}
    </div>
  )
}

function BoardSide({ snap, hidden }: { snap: BoardSnap | null; hidden: boolean }) {
  if (hidden || !snap) return <span className="text-[11px] text-gray-400 italic">— not on this side —</span>
  return (
    <div className="text-xs text-gray-700 leading-tight">
      <div className="font-medium text-gray-900">{snap.name ?? '—'}</div>
      {snap.role  && <div className="text-gray-500">{snap.role}</div>}
      {snap.email && <div className="text-gray-500 break-all">{snap.email}</div>}
      {snap.phone && <div className="text-gray-400 font-mono text-[11px]">{snap.phone}</div>}
    </div>
  )
}

function SectionTable({ title, leftLabel, rightLabel, children }: { title: string; leftLabel: string; rightLabel: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5">
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide [font-family:var(--font-mono)]">{title}</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/40">
            <th className="w-8 px-3 py-2"></th>
            <th className="text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide px-3 py-2 [font-family:var(--font-mono)]">Account / Unit</th>
            <th className="text-left text-[10px] font-semibold text-blue-600 uppercase tracking-wide px-3 py-2 [font-family:var(--font-mono)]">{leftLabel}</th>
            <th className="text-left text-[10px] font-semibold text-[#f26a1b] uppercase tracking-wide px-3 py-2 [font-family:var(--font-mono)]">{rightLabel}</th>
            <th className="text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wide px-3 py-2 [font-family:var(--font-mono)]">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {children}
        </tbody>
      </table>
    </div>
  )
}
