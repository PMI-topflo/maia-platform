'use client'

import { useMemo, useState } from 'react'
import { DocumentPreviewTrigger } from '@/components/DocumentPreviewTrigger'
import { proposeName, dedupeNames, RENAME_TYPES, TYPE_FOR_CATEGORY } from '@/lib/drive-organize'
import type { FilterCategory } from '@/lib/drive-import-filter'

interface ScanFile {
  id: string; name: string; path: string; createdTime: string | null; webViewLink: string | null
  category: FilterCategory; include: boolean; reason: string; sourceMimeType?: string
}
interface Detected { scope: string; category: string | null; itemKey: string | null; docType: string | null; effectiveDate: string | null; expirationDate: string | null; confidence: number }
interface LeaseInfo { tenantNames: string[]; ownerNames: string[]; leaseStart: string | null; leaseEnd: string | null; monthlyRent: string | null }
interface ReadResult { ok?: boolean; error?: string; associationCode?: string; unitRef?: string | null; summary?: string | null; detected?: Detected | null; lease?: LeaseInfo | null }

// "Unit 910" / "MANXI910 - 4174 Inverrary Drive" → MANXI910
function unitFromName(name: string | null): string | null {
  const m = String(name ?? '').match(/MANXI\s*0*(\d+)/i) || String(name ?? '').match(/\bunit\s*0*(\d+)/i)
  return m ? `MANXI${m[1]}` : null
}

// Map what MAIA detected to a rename Type token. Checks the item_key, the
// category, AND the human-readable doc label — the Lauderhill Certificate of
// Use isn't a standard compliance item, so it's only recognizable from the
// label ("City of Lauderhill … Certificate of Use"). Approval is checked first
// so "Lease Approval Letter" maps to Approval, not Lease.
function typeFromDetected(itemKey: string | null, category: string | null, docType?: string | null): string | null {
  const hay = `${itemKey ?? ''} ${category ?? ''} ${docType ?? ''}`.toLowerCase()
  if (/approval/.test(hay)) return 'Approval'
  if (/certificate of use|lauderhill|cert.*use|business tax|\bbtr\b|rental license|use permit/.test(hay)) return 'LauderhillCert'
  if (/\bho-?4\b|renter/.test(hay)) return 'HO4'
  if (/\bho-?6\b|\bho-?3\b/.test(hay)) return 'HO6'
  if (/lease|rental agreement|tenanc/.test(hay)) return 'Lease'
  if (/insurance|binder|policy|homeowner/.test(hay)) return 'HO6'
  return null
}

interface BrowseFolder { id: string; name: string }
interface BrowseData { parentId: string; current: { id: string; name: string; parentId: string | null } | null; folders: BrowseFolder[] }
type Status = 'idle' | 'saving' | 'done' | 'error'

const CAT_LABEL: Record<string, string> = {
  approval: 'Approval', certificate_of_use: 'Cert of Use', insurance: 'Insurance', lease: 'Lease',
  id: 'ID', credit: 'Credit', criminal: 'Background', tax: 'Tax/income', unknown: 'Unrecognized',
}

export default function OrganizeClient() {
  const [url, setUrl] = useState('')
  const [scanning, setScanning] = useState(false)
  const [files, setFiles] = useState<ScanFile[] | null>(null)
  const [foldersScanned, setFoldersScanned] = useState(0)
  const [names, setNames] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [rowErr, setRowErr] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [applyingAll, setApplyingAll] = useState(false)
  const [folderName, setFolderName] = useState<string | null>(null)
  const [folderLink, setFolderLink] = useState<string | null>(null)
  // Drive folder browser
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browse, setBrowse] = useState<BrowseData | null>(null)
  const [browsing, setBrowsing] = useState(false)
  // MAIA content-read results, keyed by fileId.
  const [reading, setReading] = useState<Record<string, boolean>>({})
  const [readRes, setReadRes] = useState<Record<string, ReadResult>>({})
  const [filed, setFiled] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState<Record<string, boolean>>({})
  const [savedTenant, setSavedTenant] = useState<Record<string, boolean>>({})
  const [rowBusy, setRowBusy] = useState<Record<string, string>>({})
  const [promoting, setPromoting] = useState(false)
  const [promoteMsg, setPromoteMsg] = useState<string | null>(null)
  // Empty-subfolder cleanup
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [markUnits, setMarkUnits] = useState(true)
  const [cleanup, setCleanup] = useState<{ emptyCount: number; foldersScanned: number; sample: string[]; applied: boolean; deleted: number; markedEmptyUnits?: number; unmarkedUnits?: number } | null>(null)

  async function runCleanup(apply: boolean) {
    if (!url.trim()) { alert('Paste a Drive folder link first.'); return }
    if (apply && !confirm(`Delete ${cleanup?.emptyCount ?? ''} empty subfolder(s)${markUnits ? ' and tag empty unit folders "NO FILES YET"' : ''}? Unit folders and anything containing files are kept.`)) return
    setCleanupBusy(true)
    try {
      const res = await fetch('/api/admin/documents/drive/organize/cleanup-empty', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderUrl: url, apply, markUnits: apply && markUnits }) })
      const j = await res.json()
      if (j.error || !j.ok) throw new Error(j.error ?? 'cleanup failed')
      setCleanup({ emptyCount: j.emptyCount, foldersScanned: j.foldersScanned, sample: j.sample ?? [], applied: j.applied, deleted: j.deleted ?? 0, markedEmptyUnits: j.markedEmptyUnits, unmarkedUnits: j.unmarkedUnits })
    } catch (e) { alert(`Cleanup failed: ${(e as Error).message}`) } finally { setCleanupBusy(false) }
  }

  const unitRef = useMemo(() => unitFromName(folderName), [folderName])

  // Core ops return success (no alerts) so Promote can batch them.
  async function doCopy(f: ScanFile, nameOverride?: string): Promise<boolean> {
    const newName = (nameOverride ?? names[f.id] ?? '').trim()
    if (!unitRef || !newName) return false
    const res = await fetch('/api/admin/documents/drive/organize/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: f.id, unitRef, newName }) })
    const j = await res.json().catch(() => ({})); if (!j.ok) return false
    setCopied(c => ({ ...c, [f.id]: true })); return true
  }
  async function doArchive(f: ScanFile): Promise<boolean> {
    if (!unitRef) return false
    const dateLabel = f.createdTime ? new Date(f.createdTime).toISOString().slice(0, 7) : undefined
    const res = await fetch('/api/admin/documents/drive/organize/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: f.id, unitRef, dateLabel }) })
    const j = await res.json().catch(() => ({})); if (!j.ok) return false
    setFiles(prev => (prev ?? []).filter(x => x.id !== f.id)); return true
  }

  async function copyToOfficial(f: ScanFile) {
    if (!unitRef || !(names[f.id] ?? '').trim()) { alert('Need a resolved unit + a name first.'); return }
    setRowBusy(b => ({ ...b, [f.id]: 'copy' }))
    if (!await doCopy(f)) alert('Copy to Official failed.')
    setRowBusy(b => ({ ...b, [f.id]: '' }))
  }
  async function archive(f: ScanFile) {
    if (!unitRef) { alert('No unit resolved for this folder.'); return }
    setRowBusy(b => ({ ...b, [f.id]: 'archive' }))
    if (!await doArchive(f)) alert('Archive failed.')
    setRowBusy(b => ({ ...b, [f.id]: '' }))
  }

  // One-click: copy every keeper (renamed) into Official, then move the whole
  // packet into the OLD archive — clearing On Going. Read-recognized keepers
  // (e.g. a Lauderhill cert) count too; ✦ Read those first.
  async function promoteApplication() {
    if (!unitRef) { alert('No unit # in the folder name — Promote needs it.'); return }
    const list = (files ?? []).slice()
    if (list.length === 0) return
    if (!confirm(`Promote ${unitRef}?\n\n• Keepers → copied to Official (renamed)\n• Whole packet → moved to OLD archive\n• On Going cleared`)) return
    setPromoting(true); setPromoteMsg(null)
    let copies = 0, moved = 0
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      setPromoteMsg(`${i + 1}/${list.length}…`)
      const rr = readRes[f.id]
      const readType = rr?.detected ? typeFromDetected(rr.detected.itemKey, rr.detected.category, rr.detected.docType) : null
      const isKeeper = (renamable(f) || !!readType) && !!(names[f.id] ?? '').trim()
      if (isKeeper && await doCopy(f)) copies++
      if (await doArchive(f)) moved++
    }
    setPromoting(false)
    setPromoteMsg(`Done — ${copies} keeper(s) copied to Official, ${moved} file(s) moved to OLD archive.`)
  }

  async function saveTenant(f: ScanFile) {
    const lease = readRes[f.id]?.lease
    if (!lease || !unitRef) return
    setRowBusy(b => ({ ...b, [f.id]: 'tenant' }))
    try {
      const res = await fetch('/api/admin/documents/drive/organize/save-tenant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ associationCode: readRes[f.id]?.associationCode ?? 'MANXI', unitRef, tenantName: lease.tenantNames.join(', '), leaseStart: lease.leaseStart, leaseEnd: lease.leaseEnd }) })
      const j = await res.json(); if (!j.ok) throw new Error(j.error ?? 'save failed')
      setSavedTenant(s => ({ ...s, [f.id]: true }))
    } catch (e) { alert(`Save tenant failed: ${(e as Error).message}`) } finally { setRowBusy(b => ({ ...b, [f.id]: '' })) }
  }

  async function readWithMaia(f: ScanFile) {
    setReading(r => ({ ...r, [f.id]: true }))
    try {
      const res = await fetch('/api/admin/documents/drive/organize/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: f.id, folderName }) })
      const j = (await res.json()) as ReadResult
      setReadRes(rr => ({ ...rr, [f.id]: j }))
      // If MAIA recognized a keeper type, offer a corrected name (works even
      // for files the filename-based filter marked "unrecognized").
      const t = j.detected ? typeFromDetected(j.detected.itemKey, j.detected.category, j.detected.docType) : null
      if (t) {
        const ym = f.createdTime ? new Date(f.createdTime).toISOString().slice(0, 7).replace('-', '_') : null
        const e = f.name.match(/\.([a-z0-9]{1,5})$/i)?.[0] ?? ''
        if (ym && !names[f.id]) setNames(n => ({ ...n, [f.id]: `${ym}_${t}${e}` }))
      }
    } catch (e) { setReadRes(rr => ({ ...rr, [f.id]: { ok: false, error: (e as Error).message } })) }
    finally { setReading(r => ({ ...r, [f.id]: false })) }
  }

  async function fileToMaia(f: ScanFile) {
    const r = readRes[f.id]
    if (!r?.detected) return
    try {
      const res = await fetch('/api/admin/documents/drive/organize/file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ associationCode: r.associationCode, unitRef: r.unitRef, itemKey: r.detected.itemKey, scope: r.detected.scope, expiry: r.detected.expirationDate, docType: r.detected.docType }),
      })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error ?? 'file failed')
      setFiled(fl => ({ ...fl, [f.id]: true }))
    } catch (e) { alert(`Could not file: ${(e as Error).message}`) }
  }

  async function openBrowse(parentId = 'root') {
    setBrowseOpen(true); setBrowsing(true)
    try {
      const res = await fetch(`/api/admin/documents/drive/browse?parentId=${encodeURIComponent(parentId)}`)
      const j = await res.json()
      if (j.error) throw new Error(j.error)
      setBrowse(j)
    } catch (e) { setError((e as Error).message) } finally { setBrowsing(false) }
  }

  function chooseFolder(f: BrowseFolder) {
    setUrl(`https://drive.google.com/drive/folders/${f.id}`)
    setBrowseOpen(false)
    // scan it immediately
    setTimeout(() => scan(f.id), 0)
  }

  // Group by folder breadcrumb, and within each group propose + dedupe names.
  const groups = useMemo(() => {
    const m = new Map<string, ScanFile[]>()
    for (const f of files ?? []) { const k = f.path || '(top level)'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(f) }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [files])

  async function scan(overrideId?: string) {
    const folderUrl = overrideId ? `https://drive.google.com/drive/folders/${overrideId}` : url
    setScanning(true); setError(null); setFiles(null); setNames({}); setStatus({}); setRowErr({}); setFolderName(null); setFolderLink(null)
    try {
      const res = await fetch('/api/admin/documents/drive/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderUrl }) })
      const text = await res.text()
      let j: { files?: ScanFile[]; foldersScanned?: number; error?: string; folderName?: string | null; folderLink?: string | null }
      try { j = JSON.parse(text) } catch { throw new Error(res.status === 504 ? 'Scan timed out — try a smaller subfolder.' : `Scan failed (HTTP ${res.status}).`) }
      if (!res.ok) throw new Error(j.error ?? 'scan failed')
      const fs = (j.files ?? []) as ScanFile[]
      setFoldersScanned(Number(j.foldersScanned ?? 0))
      setFolderName(j.folderName ?? null); setFolderLink(j.folderLink ?? null)
      setFiles(fs)
      // Build suggested names, deduped within each folder.
      const byGroup = new Map<string, ScanFile[]>()
      for (const f of fs) { const k = f.path || '(top level)'; if (!byGroup.has(k)) byGroup.set(k, []); byGroup.get(k)!.push(f) }
      const next: Record<string, string> = {}
      for (const arr of byGroup.values()) {
        const suggestions = arr.map(f => proposeName(f.name, f.category, f.include, f.createdTime).suggested)
        const deduped = dedupeNames(suggestions)
        arr.forEach((f, i) => { if (deduped[i]) next[f.id] = deduped[i]! })
      }
      setNames(next)
      if (fs.length === 0) setError('No files found in that folder.')
    } catch (e) { setError((e as Error).message) } finally { setScanning(false) }
  }

  async function rename(f: ScanFile): Promise<boolean> {
    const newName = (names[f.id] ?? '').trim()
    if (!newName || newName === f.name) return false
    setStatus(s => ({ ...s, [f.id]: 'saving' })); setRowErr(e => ({ ...e, [f.id]: '' }))
    try {
      const res = await fetch('/api/admin/documents/drive/organize/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: f.id, newName }) })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error ?? 'rename failed')
      setFiles(prev => (prev ?? []).map(x => x.id === f.id ? { ...x, name: newName } : x))
      setStatus(s => ({ ...s, [f.id]: 'done' }))
      return true
    } catch (e) { setStatus(s => ({ ...s, [f.id]: 'error' })); setRowErr(er => ({ ...er, [f.id]: (e as Error).message })); return false }
  }

  async function applyAll() {
    setApplyingAll(true)
    for (const f of files ?? []) {
      if (renamable(f) && status[f.id] !== 'done') await rename(f)
    }
    setApplyingAll(false)
  }

  function renamable(f: ScanFile): boolean {
    return f.include && !!TYPE_FOR_CATEGORY[f.category]
  }

  const renamableCount = (files ?? []).filter(renamable).length
  const doneCount = Object.values(status).filter(s => s === 'done').length

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste a Drive folder link, or Browse →"
          className="min-w-0 flex-1 rounded border border-gray-300 px-2.5 py-1.5 text-sm" />
        <button onClick={() => openBrowse('root')} disabled={scanning} className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50">Browse Drive</button>
        <button onClick={() => scan()} disabled={scanning || !url.trim()} className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">{scanning ? 'Scanning…' : 'Scan'}</button>
      </div>
      {error && <div className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-dashed border-gray-200 px-3 py-2">
        <span className="text-xs font-medium text-gray-600">🧹 Empty subfolders</span>
        <button onClick={() => runCleanup(false)} disabled={cleanupBusy || !url.trim()} className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 disabled:opacity-50">{cleanupBusy ? 'Scanning…' : 'Find empty'}</button>
        <label className="flex items-center gap-1 text-[11px] text-gray-600" title='Rename totally-empty unit folders to append "NO FILES YET" (auto-removed when a file is copied in)'>
          <input type="checkbox" checked={markUnits} onChange={e => setMarkUnits(e.target.checked)} /> tag empty units
        </label>
        {cleanup && !cleanup.applied && (cleanup.emptyCount > 0 || markUnits) && (
          <button onClick={() => runCleanup(true)} disabled={cleanupBusy} className="rounded bg-red-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">Delete {cleanup.emptyCount} empty{markUnits ? ' + tag units' : ''}</button>
        )}
        {cleanup && (
          <span className="text-[11px] text-gray-500">
            {cleanup.applied
              ? `Deleted ${cleanup.deleted} empty subfolder(s)${cleanup.markedEmptyUnits ? `, tagged ${cleanup.markedEmptyUnits} empty unit(s)` : ''}${cleanup.unmarkedUnits ? `, un-tagged ${cleanup.unmarkedUnits}` : ''}.`
              : `${cleanup.emptyCount} empty of ${cleanup.foldersScanned} scanned${cleanup.emptyCount ? ` — e.g. ${cleanup.sample.slice(0, 4).join(', ')}${cleanup.emptyCount > 4 ? '…' : ''}` : ''}`}
            {' '}<span className="text-gray-400">(unit folders + anything with files are kept)</span>
          </span>
        )}
      </div>

      {browseOpen && (
        <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="font-semibold">📁 {browse?.current ? browse.current.name : 'My Drive'}</span>
              {browse?.current && (
                <button onClick={() => openBrowse(browse.current!.parentId ?? 'root')} className="text-blue-600 hover:underline">↑ up</button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {browse?.current && <button onClick={() => chooseFolder({ id: browse.current!.id, name: browse.current!.name })} className="text-xs font-medium text-[#c2410c] hover:underline">Scan this folder →</button>}
              <button onClick={() => setBrowseOpen(false)} className="text-xs text-gray-500 hover:underline">Close</button>
            </div>
          </div>
          {browsing ? <div className="py-3 text-center text-xs text-gray-400">Loading…</div> : (
            <div className="max-h-56 space-y-0.5 overflow-auto">
              {(browse?.folders ?? []).length === 0 && <div className="py-2 text-xs text-gray-400">No subfolders here.</div>}
              {(browse?.folders ?? []).map(f => (
                <div key={f.id} className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-white">
                  <button onClick={() => openBrowse(f.id)} className="min-w-0 flex-1 truncate text-left text-gray-700">📁 {f.name}</button>
                  <button onClick={() => chooseFolder(f)} className="shrink-0 rounded bg-gray-800 px-2 py-0.5 text-[11px] font-medium text-white">Scan</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {files && (folderName || files.length > 0) && (
        <div className="mt-4">
          {folderName && (
            <div className="mb-2 rounded bg-gray-50 px-3 py-1.5 text-xs text-gray-700">
              Scanning <span className="font-semibold">📁 {folderName}</span>
              {folderLink && <a href={folderLink} target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-600 hover:underline">open in Drive ↗</a>}
              {unitRef
                ? <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">unit {unitRef} → Official / Archive</span>
                : <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">no unit # in folder name — Copy/Archive need it</span>}
            </div>
          )}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-gray-500">{files.length} file(s) across {foldersScanned} folder(s) · {renamableCount} renamable · {doneCount} renamed</span>
            <div className="flex items-center gap-2">
              <button onClick={applyAll} disabled={applyingAll || renamableCount === 0} className="rounded bg-[#f26a1b] px-3 py-1 text-xs font-medium text-white hover:bg-[#d85a14] disabled:opacity-50">{applyingAll ? 'Applying…' : `Rename all (${renamableCount})`}</button>
              <button onClick={promoteApplication} disabled={promoting || !unitRef || files.length === 0} title={unitRef ? 'Copy keepers to Official + move the packet to OLD archive' : 'No unit # in the folder name'} className="rounded bg-[#0d9488] px-3 py-1 text-xs font-medium text-white hover:bg-[#0f766e] disabled:opacity-50">{promoting ? 'Promoting…' : 'Promote application →'}</button>
            </div>
          </div>
          {promoteMsg && <div className="mb-2 rounded bg-teal-50 px-3 py-2 text-xs text-teal-800">{promoteMsg}</div>}

          <div className="space-y-4">
            {groups.map(([path, fs]) => (
              <div key={path}>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{path}</div>
                <div className="space-y-1.5">
                  {fs.map(f => {
                    const rr = readRes[f.id]
                    const readType = rr?.detected ? typeFromDetected(rr.detected.itemKey, rr.detected.category, rr.detected.docType) : null
                    const canRename = renamable(f) || !!readType
                    const st = status[f.id] ?? 'idle'
                    return (
                      <div key={f.id} className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 text-xs ${st === 'done' ? 'border-emerald-200 bg-emerald-50' : 'border-gray-100'}`}>
                        <DocumentPreviewTrigger label="👁" previewUrl={`/api/admin/documents/drive/preview?fileId=${encodeURIComponent(f.id)}`} className="shrink-0 text-sm" />
                        {f.webViewLink && <a href={f.webViewLink} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-blue-600 hover:underline" title="Open in Drive (for files too large to preview)">↗</a>}
                        <span className={`min-w-0 flex-1 truncate ${canRename ? 'text-gray-700' : 'text-gray-400'}`} title={f.name}>{f.name}</span>
                        {f.sourceMimeType && <span className="shrink-0 rounded bg-blue-50 px-1 text-[10px] text-blue-600">Doc→PDF</span>}
                        <button onClick={() => readWithMaia(f)} disabled={reading[f.id]} className="shrink-0 rounded border border-[#f26a1b]/40 px-1.5 py-0.5 text-[10px] font-medium text-[#c2410c] disabled:opacity-50" title="Have MAIA read the file contents (recognizes it + reads dates)">{reading[f.id] ? 'Reading…' : '✦ Read'}</button>
                        {canRename ? (
                          <>
                            <span className="shrink-0 text-gray-300">→</span>
                            <input value={names[f.id] ?? ''} onChange={e => setNames(n => ({ ...n, [f.id]: e.target.value }))}
                              className="w-52 shrink-0 rounded border border-gray-300 px-2 py-1 font-mono text-[11px]" />
                            {st === 'done'
                              ? <span className="shrink-0 text-emerald-600">✓ renamed</span>
                              : <button onClick={() => rename(f)} disabled={st === 'saving'} className="shrink-0 rounded bg-gray-800 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">{st === 'saving' ? '…' : 'Apply'}</button>}
                            {copied[f.id]
                              ? <span className="shrink-0 text-emerald-600">✓ in Official</span>
                              : <button onClick={() => copyToOfficial(f)} disabled={!unitRef || rowBusy[f.id] === 'copy'} title={unitRef ? `Copy renamed into ${unitRef} (Official)` : 'No unit # resolved'} className="shrink-0 rounded bg-[#c2410c] px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">{rowBusy[f.id] === 'copy' ? '…' : 'Copy → Official'}</button>}
                          </>
                        ) : (
                          <>
                            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500" title={f.reason}>
                              {f.category === 'approval' && f.sourceMimeType ? 'skip: unsigned draft' : `skip: ${CAT_LABEL[f.category] ?? f.category}`}
                            </span>
                            <button onClick={() => archive(f)} disabled={!unitRef || rowBusy[f.id] === 'archive'} title={unitRef ? `Move into OLD archive under ${unitRef}` : 'No unit # resolved'} className="shrink-0 rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 disabled:opacity-50">{rowBusy[f.id] === 'archive' ? '…' : 'Archive → OLD'}</button>
                          </>
                        )}
                        {st === 'error' && <span className="w-full text-[10px] text-red-600">{rowErr[f.id]}</span>}
                        {rr && (
                          <div className="w-full rounded bg-[#fff7ed] px-2 py-1 text-[11px] text-gray-700">
                            {rr.error && <span className="text-red-600">{rr.error}</span>}
                            {rr.detected && (
                              <div className="flex flex-wrap items-center gap-2">
                                <span>MAIA read: <b>{rr.detected.docType ?? rr.detected.itemKey ?? 'document'}</b>{rr.detected.expirationDate ? <> · expires <b>{rr.detected.expirationDate}</b></> : ' · no expiry date'}{rr.unitRef ? ` · ${rr.unitRef}` : ''}</span>
                                {filed[f.id]
                                  ? <span className="text-emerald-600">✓ filed to MAIA</span>
                                  : <button onClick={() => fileToMaia(f)} className="rounded bg-[#c2410c] px-2 py-0.5 text-[10px] font-medium text-white">File to MAIA{rr.detected.expirationDate ? ' (save expiry)' : ''}</button>}
                              </div>
                            )}
                            {rr.lease && (
                              <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-orange-100 pt-1">
                                <span>Tenant: <b>{rr.lease.tenantNames.join(', ') || '—'}</b>{rr.lease.leaseStart || rr.lease.leaseEnd ? ` · lease ${rr.lease.leaseStart ?? '?'} → ${rr.lease.leaseEnd ?? '?'}` : ''}{rr.lease.monthlyRent ? ` · ${rr.lease.monthlyRent}` : ''}</span>
                                {savedTenant[f.id]
                                  ? <span className="text-emerald-600">✓ saved to tenant record</span>
                                  : <button onClick={() => saveTenant(f)} disabled={!unitRef || rowBusy[f.id] === 'tenant'} className="rounded bg-[#c2410c] px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-50">{rowBusy[f.id] === 'tenant' ? '…' : 'Save tenant info'}</button>}
                              </div>
                            )}
                            {!rr.detected && !rr.error && <span className="text-gray-500">MAIA couldn’t identify a compliance item in this file.</span>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-gray-400">Types: {RENAME_TYPES.join(' · ')}. Edit any name before applying; insurance defaults to HO6 — change to HO4 for renter policies.</p>
        </div>
      )}
    </div>
  )
}
