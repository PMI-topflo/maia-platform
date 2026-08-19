'use client'

// Two folders for the same unit under "On Going Applications" — left behind
// by an old naming bug (fixed 2026-08-19, see lib/drive-application-mirror.ts
// → ensureOngoingUnitFolder). Found live for units 103 and 912. Plan-first:
// nothing moves until you pick a survivor and click Merge for that group.

import { useState } from 'react'

interface Folder { id: string; name: string; fileCount: number; isCanonical: boolean }
interface Group { unitRef: string; folders: Folder[] }

const ASSOCS = ['MANXI', 'VPCI']

export default function DuplicateOngoingFolders() {
  const [assoc, setAssoc] = useState('MANXI')
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [survivorByUnit, setSurvivorByUnit] = useState<Record<string, string>>({})
  const [merging, setMerging] = useState<string | null>(null)
  const [doneUnits, setDoneUnits] = useState<Set<string>>(new Set())

  async function scan() {
    setScanning(true); setErr(null); setGroups(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/ongoing-drive/duplicates?assoc=${encodeURIComponent(assoc)}`, { credentials: 'include' })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'scan failed')
      setGroups(j.groups)
      const defaults: Record<string, string> = {}
      for (const g of j.groups as Group[]) {
        const canonical = g.folders.find(f => f.isCanonical) ?? g.folders[0]
        defaults[g.unitRef] = canonical.id
      }
      setSurvivorByUnit(defaults)
    } catch (e) { setErr((e as Error).message) } finally { setScanning(false) }
  }

  async function merge(g: Group) {
    const survivorFolderId = survivorByUnit[g.unitRef]
    const loser = g.folders.find(f => f.id !== survivorFolderId)
    if (!survivorFolderId || !loser) return
    if (!confirm(`Move ${loser.fileCount} file(s) from "${loser.name}" into the surviving folder, then trash "${loser.name}"?\n\nThis can be undone from Drive trash, but please confirm.`)) return
    setMerging(g.unitRef)
    try {
      const r = await fetch('/api/admin/pre-apply/ongoing-drive/duplicates', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ survivorFolderId, loserFolderId: loser.id }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'merge failed')
      setDoneUnits(s => new Set(s).add(g.unitRef))
    } catch (e) { alert(`Could not merge: ${(e as Error).message}`) } finally { setMerging(null) }
  }

  return (
    <div className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-base font-semibold text-gray-900">Duplicate On Going Application folders</h2>
        <span className="rounded bg-[#f26a1b]/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-[#c2410c]">MAIA</span>
      </div>
      <p className="mb-3 text-sm text-gray-500">Some units ended up with two folders under &quot;On Going Applications&quot; — an old bare one and a newer one the app created before this was fixed. Nothing moves until you confirm a survivor and click Merge.</p>

      <div className="flex items-center gap-2">
        <select value={assoc} onChange={e => { setAssoc(e.target.value); setGroups(null) }} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          {ASSOCS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <button onClick={scan} disabled={scanning} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {scanning ? 'Scanning…' : 'Scan for duplicates'}
        </button>
      </div>

      {err && <p className="mt-3 text-sm text-amber-700">⚠ {err}</p>}

      {groups && groups.length === 0 && <p className="mt-3 text-sm text-gray-500">No duplicate folders found for {assoc}.</p>}

      {groups && groups.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          {groups.map(g => {
            const done = doneUnits.has(g.unitRef)
            return (
              <div key={g.unitRef} className={`rounded-lg border p-3 ${done ? 'border-green-200 bg-green-50' : 'border-gray-200'}`}>
                <div className="mb-2 font-semibold text-gray-900">{g.unitRef}</div>
                {done ? (
                  <p className="text-sm font-medium text-green-700">✓ Merged</p>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5">
                      {g.folders.map(f => (
                        <label key={f.id} className="flex items-center gap-2 text-sm">
                          <input type="radio" name={`survivor-${g.unitRef}`} checked={survivorByUnit[g.unitRef] === f.id}
                            onChange={() => setSurvivorByUnit(s => ({ ...s, [g.unitRef]: f.id }))} />
                          <span className="font-mono">{f.name}</span>
                          <span className="text-gray-400">· {f.fileCount} file{f.fileCount === 1 ? '' : 's'}</span>
                          {f.isCanonical && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">canonical name</span>}
                        </label>
                      ))}
                    </div>
                    <button onClick={() => merge(g)} disabled={merging === g.unitRef}
                      className="mt-2 rounded-lg bg-[#f26a1b] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                      {merging === g.unitRef ? 'Merging…' : 'Merge into selected folder'}
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
