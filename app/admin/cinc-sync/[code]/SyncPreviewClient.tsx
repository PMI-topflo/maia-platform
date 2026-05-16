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
  /** Secondary phone column on MAIA's owners table — CINC has no
   *  equivalent so it's always null on the CINC side. The edit modal
   *  uses this so it can pre-populate both phone fields without
   *  another round-trip. */
  phone_2:        string | null
  address:        string | null
  /** Preferred language (en/es/pt/fr/he/ru). MAIA-only, null on CINC
   *  side. Pre-populates the edit modal. */
  language:       string | null
}

const LANGUAGE_OPTIONS: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
  { code: 'he', label: 'עברית' },
  { code: 'ru', label: 'Русский' },
]
interface BoardSnap {
  name:  string | null
  email: string | null
  role:  string | null
  phone: string | null
}
interface OwnerCmp {
  status:           'insert' | 'update' | 'match' | 'only_in_maia'
  selection_key:    string
  account_number:   string | null
  unit_number:      string | null
  owner_number:     number | null
  cinc_property_id: number | null
  cinc_name_slot:   number | null
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
  const [selOwnerKeys, setSelOwnerKeys] = useState<Set<string>>(new Set())
  const [selBoardIns,  setSelBoardIns]  = useState<Set<number>>(new Set())
  const [selBoardDe,   setSelBoardDe]   = useState<Set<string>>(new Set())
  const [showMatched, setShowMatched] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result,   setResult]   = useState<ApplyResult | null>(null)

  // Inline-edit modal state. Populated when staff clicks "Edit" on a
  // MAIA owner row. Lives at this level (not per-row) because there's
  // only ever one edit dialog open at a time and we need to clear it
  // after a successful save without prop-drilling.
  const [editTarget, setEditTarget] = useState<
    | { ownerId: number; label: string; emails: string; phone: string; phone_2: string; language: string }
    | null
  >(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError,  setEditError]  = useState<string | null>(null)

  function openEdit(cmp: OwnerCmp) {
    if (!cmp.owners_id || !cmp.maia) return
    const ownerName = [cmp.maia.first_name, cmp.maia.last_name].filter(Boolean).join(' ') || '(unnamed)'
    setEditError(null)
    setEditTarget({
      ownerId:  cmp.owners_id,
      label:    `${cmp.account_number ?? '—'} · ${ownerName}`,
      emails:   cmp.maia.emails   ?? '',
      phone:    cmp.maia.phone    ?? '',
      phone_2:  cmp.maia.phone_2  ?? '',
      // Default to English when the column is empty so the select has
      // a definite value — saving preserves "en" if the user doesn't
      // change it. Empty string would clear the column to NULL.
      language: cmp.maia.language ?? 'en',
    })
  }

  async function saveEdit() {
    if (!editTarget) return
    setEditSaving(true); setEditError(null)
    try {
      const res = await fetch(`/api/admin/cinc-sync/${assocCode}/owner/${editTarget.ownerId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          emails:   editTarget.emails,
          phone:    editTarget.phone,
          phone_2:  editTarget.phone_2,
          language: editTarget.language,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'save failed')
      // Refresh the preview so the edited row's MAIA column updates +
      // any SYNCED/UPDATE badges recompute against CINC.
      const fresh = await fetch(`/api/admin/cinc-sync/${assocCode}/preview`).then(r => r.json())
      setPreview(fresh)
      setEditTarget(null)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e))
    } finally {
      setEditSaving(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetch(`/api/admin/cinc-sync/${assocCode}/preview`)
      .then(r => r.ok ? r.json() : r.json().then(b => { throw new Error(b?.error ?? 'preview failed') }))
      .then((data: SyncPreview) => {
        if (cancelled) return
        setPreview(data)
        // Pre-select every actionable row (staff unticks what they don't want).
        const ownerKeys = data.owners.filter(o => o.status === 'insert' || o.status === 'update').map(o => o.selection_key)
        const insBoard  = data.board.filter(b => b.status === 'insert' && b.cinc_board_member_id != null).map(b => b.cinc_board_member_id as number)
        const deBoard   = data.board.filter(b => b.status === 'only_in_maia' && b.abm_id != null).map(b => b.abm_id as string)
        setSelOwnerKeys(new Set(ownerKeys))
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
          ownerKeys:          [...selOwnerKeys],
          insertBoardCincIds: [...selBoardIns],
          deactivateBoardIds: [...selBoardDe],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'apply failed')
      setResult(data as ApplyResult)
      // Re-fetch the preview so it reflects what's in DB now, and
      // automatically reveal the now-synced rows so staff get visual
      // confirmation (green SYNCED badge) that the data matches on
      // both sides instead of seeing an empty "everything in sync"
      // placeholder with no detail.
      const fresh = await fetch(`/api/admin/cinc-sync/${assocCode}/preview`).then(r => r.json())
      setPreview(fresh)
      setShowMatched(true)
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

  const totalToApply = selOwnerKeys.size + selBoardIns.size + selBoardDe.size

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
        <div className="bg-green-50 border border-green-300 rounded-lg p-4 text-sm text-green-900">
          <div className="font-semibold mb-1 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-600 text-white text-xs">✓</span>
            Sync complete — rows that match on both sides are now marked <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-green-600 text-white">✓ SYNCED</span> below.
          </div>
          <ul className="list-disc pl-5 space-y-0.5 mt-2 text-green-800">
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
        {visibleOwners.map((cmp) => {
          const canPick = cmp.status === 'insert' || cmp.status === 'update'
          const sel     = canPick && selOwnerKeys.has(cmp.selection_key)
          const onToggle = () => {
            if (!canPick) return
            setSelOwnerKeys(prev => toggleStr(prev, cmp.selection_key))
          }
          return (
            <Fragment key={cmp.selection_key}>
              <tr className={cmp.status === 'match' ? 'bg-green-50/40' : ''}>
                <td className="px-3 py-2 align-top w-8">
                  {canPick && <input type="checkbox" checked={sel} onChange={onToggle} className="accent-[#f26a1b]" />}
                </td>
                <td className="px-3 py-2 align-top">
                  <UnitCell account={cmp.account_number} unit={cmp.unit_number} ownerNumber={cmp.owner_number} cincId={cmp.cinc_property_id} maiaId={cmp.owners_id} nameSlot={cmp.cinc_name_slot} />
                </td>
                <td className="px-3 py-2 align-top">
                  <OwnerSide
                    snap={cmp.maia}
                    hidden={!cmp.maia}
                    // Only MAIA rows that ALREADY exist (have an
                    // owners.id) are editable here — for CINC-only
                    // rows staff need to click Apply first to create
                    // the MAIA row, then edit it.
                    onEdit={cmp.owners_id != null ? () => openEdit(cmp) : undefined}
                    // Same gating as Edit — emulation only makes sense
                    // when a MAIA row exists, since /my-account renders
                    // from owners.id.
                    emulateHref={cmp.owners_id != null ? `/my-account?id=${cmp.owners_id}&assoc=${assocCode}` : null}
                  />
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
            <tr key={`b-${id}`} className={cmp.status === 'match' ? 'bg-green-50/40' : ''}>
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

      {/* Edit modal — appears when staff clicks Edit on a MAIA owner row.
          Lets them update emails + both phones without leaving the page.
          Phones get E.164-normalized server-side on save so WhatsApp /
          SMS APIs can dial them. */}
      {editTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4"
          onClick={() => !editSaving && setEditTarget(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Edit owner contact</h3>
                <p className="text-xs text-gray-500 mt-0.5">{editTarget.label}</p>
              </div>
              <button
                onClick={() => !editSaving && setEditTarget(null)}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <p className="text-[11px] text-gray-500 mb-4 leading-snug">
              CINC&apos;s homeowner record doesn&apos;t reliably store international phone numbers, so MAIA owns these fields. Phones get normalized to E.164 (<code className="bg-gray-100 px-1 rounded">+1XXXXXXXXXX</code> for US) on save.
            </p>

            <label className="block mb-3">
              <span className="text-xs font-mono uppercase tracking-wide text-gray-600">Emails (comma-separated)</span>
              <textarea
                value={editTarget.emails}
                onChange={e => setEditTarget({ ...editTarget, emails: e.target.value })}
                disabled={editSaving}
                rows={3}
                className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b] disabled:bg-gray-50"
                placeholder="owner@example.com,backup@example.com"
              />
            </label>

            <label className="block mb-3">
              <span className="text-xs font-mono uppercase tracking-wide text-gray-600">Primary phone</span>
              <input
                type="tel"
                value={editTarget.phone}
                onChange={e => setEditTarget({ ...editTarget, phone: e.target.value })}
                disabled={editSaving}
                className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b] disabled:bg-gray-50 font-mono"
                placeholder="+17865551212 or +447911123456"
              />
            </label>

            <label className="block mb-3">
              <span className="text-xs font-mono uppercase tracking-wide text-gray-600">Secondary phone (optional)</span>
              <input
                type="tel"
                value={editTarget.phone_2}
                onChange={e => setEditTarget({ ...editTarget, phone_2: e.target.value })}
                disabled={editSaving}
                className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b] disabled:bg-gray-50 font-mono"
                placeholder="+13055551212"
              />
            </label>

            {/* Preferred language drives which template MAIA picks for
                outbound emails / WhatsApp messages. Owners table only
                stores ONE language, so this is per-owner not per-channel. */}
            <label className="block mb-4">
              <span className="text-xs font-mono uppercase tracking-wide text-gray-600">Preferred language</span>
              <select
                value={editTarget.language}
                onChange={e => setEditTarget({ ...editTarget, language: e.target.value })}
                disabled={editSaving}
                className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b] disabled:bg-gray-50 bg-white"
              >
                {LANGUAGE_OPTIONS.map(opt => (
                  <option key={opt.code} value={opt.code}>{opt.label}</option>
                ))}
              </select>
            </label>

            {editError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">{editError}</div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => !editSaving && setEditTarget(null)}
                disabled={editSaving}
                className="text-xs font-mono uppercase tracking-wide text-gray-500 hover:text-gray-700 px-3 py-2"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={editSaving}
                className="bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white text-xs font-medium uppercase tracking-wide px-4 py-2 rounded transition-colors [font-family:var(--font-mono)]"
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
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
  // SYNCED gets a saturated green ring so staff can SEE post-apply that
  // a row really did land. Greys read as "neutral / nothing happened"
  // and were hard to distinguish from disabled rows.
  const styles: Record<string, string> = {
    insert:       'bg-green-100 text-green-700',
    update:       'bg-amber-100 text-amber-800',
    match:        'bg-green-600 text-white',
    only_in_maia: 'bg-blue-100 text-blue-700',
  }
  const labels: Record<string, string> = {
    insert:       'INSERT',
    update:       'UPDATE',
    match:        '✓ SYNCED',
    only_in_maia: 'KEEP (not in CINC)',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {labels[status] ?? status}
    </span>
  )
}

function UnitCell({ account, unit, ownerNumber, cincId, maiaId, nameSlot }: { account: string | null; unit: string | null; ownerNumber: number | null; cincId: number | null; maiaId: number | null; nameSlot: number | null }) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-900 font-mono">{account ?? '—'}</div>
      <div className="text-[11px] text-gray-500 leading-tight">
        Unit {unit ?? '—'}{ownerNumber != null && ownerNumber > 1 ? ` · Owner #${ownerNumber}` : ''}
        {nameSlot === 1 && (
          // CINC stores a second name pair on the same address row
          // (FirstName1/LastName1) for joint owners — person + entity,
          // two spouses, etc. Surface it so staff know this is the
          // SECOND owner on the address record, not a duplicate.
          <span className="ml-1 inline-flex items-center px-1.5 py-0 rounded text-[9px] font-semibold uppercase bg-purple-100 text-purple-700 align-middle">2nd name</span>
        )}
      </div>
      <div className="text-[10px] font-mono text-gray-400 leading-tight mt-0.5">
        {cincId != null && <div>CINC PropertyID {cincId}{nameSlot != null ? `·${nameSlot}` : ''}</div>}
        {maiaId != null && <div>MAIA owners.id {maiaId}</div>}
      </div>
    </div>
  )
}

function OwnerSide({ snap, hidden, onEdit, emulateHref }: { snap: OwnerSnap | null; hidden: boolean; onEdit?: () => void; emulateHref?: string | null }) {
  if (hidden || !snap) return <span className="text-[11px] text-gray-400 italic">— not on this side —</span>
  const name = [snap.first_name, snap.last_name].filter(Boolean).join(' ') || '—'
  return (
    <div className="text-xs text-gray-700 leading-tight relative group">
      <div className="font-medium text-gray-900 flex items-center gap-2 flex-wrap">
        <span>{name}</span>
        {/* Edit button only renders when caller supplied onEdit (MAIA
            side with an existing owners.id). Hovering the row reveals
            it without crowding the cell at rest. */}
        {onEdit && (
          <button
            onClick={onEdit}
            title="Edit emails / phones / language (MAIA only — CINC doesn't reliably store international numbers)"
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-mono uppercase tracking-wide text-[#f26a1b] hover:text-[#c14d0a] border border-[#f26a1b]/40 hover:border-[#f26a1b] rounded px-1.5 py-0.5"
          >
            Edit
          </button>
        )}
        {/* "View as owner" — opens the owner's portal in a new tab so
            staff can verify what the owner sees while testing or
            helping. New tab keeps the admin session AND the diff page
            in place. The owner-side page detects the staff session
            and renders an emulation banner. */}
        {emulateHref && (
          <a
            href={emulateHref}
            target="_blank"
            rel="noopener noreferrer"
            title="Open this owner's portal in a new tab — staff emulation"
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-mono uppercase tracking-wide text-indigo-700 hover:text-indigo-900 border border-indigo-400/50 hover:border-indigo-700 rounded px-1.5 py-0.5"
          >
            View as ↗
          </a>
        )}
      </div>
      {snap.emails  && <div className="text-gray-500 break-all">{snap.emails}</div>}
      {snap.phone   && <div className="text-gray-500 font-mono">{snap.phone}</div>}
      {snap.phone_2 && <div className="text-gray-500 font-mono">{snap.phone_2} <span className="text-gray-400 not-italic text-[10px] uppercase">2nd</span></div>}
      {/* Fallback display when primary is empty but secondary is set —
          otherwise a row with only a secondary phone would look like it
          has no phone at all. */}
      {!snap.phone && !snap.phone_2 && null}
      {snap.address && <div className="text-gray-400 text-[11px]">{snap.address}</div>}
      {snap.language && (
        // Tiny language chip — only renders for MAIA-side snapshots
        // (CINC always leaves language null). Helps staff spot when a
        // non-default language is set without opening the modal.
        <div className="mt-0.5">
          <span className="inline-flex items-center px-1.5 py-0 rounded text-[9px] font-semibold uppercase tracking-wide bg-indigo-100 text-indigo-700">
            {snap.language.toUpperCase()}
          </span>
        </div>
      )}
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
