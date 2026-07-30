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
interface ReadResult { ok?: boolean; error?: string; associationCode?: string; unitRef?: string | null; summary?: string | null; detected?: Detected | null }

// Map what MAIA detected (compliance item_key / category) to a rename Type token.
function typeFromDetected(itemKey: string | null, category: string | null): string | null {
  const k = (itemKey ?? '').toLowerCase(); const c = (category ?? '').toLowerCase()
  if (k.includes('approval')) return 'Approval'
  if (k === 'unit.leasing' || k.includes('lease') || c.includes('lease')) return 'Lease'
  if (k === 'unit.ho6' || k === 'unit.ho3') return 'HO6'
  if (k === 'unit.ho4') return 'HO4'
  if (k.includes('certificate_of_use') || k.includes('use') || /lauderhill|cert.*use/.test(c)) return 'LauderhillCert'
  if (c === 'insurance' || k.startsWith('insurance')) return 'HO6'
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

  async function readWithMaia(f: ScanFile) {
    setReading(r => ({ ...r, [f.id]: true }))
    try {
      const res = await fetch('/api/admin/documents/drive/organize/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: f.id, folderName }) })
      const j = (await res.json()) as ReadResult
      setReadRes(rr => ({ ...rr, [f.id]: j }))
      // If MAIA recognized a keeper type, offer a corrected name (works even
      // for files the filename-based filter marked "unrecognized").
      const t = j.detected ? typeFromDetected(j.detected.itemKey, j.detected.category) : null
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
            </div>
          )}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-gray-500">{files.length} file(s) across {foldersScanned} folder(s) · {renamableCount} renamable · {doneCount} renamed</span>
            <button onClick={applyAll} disabled={applyingAll || renamableCount === 0} className="rounded bg-[#f26a1b] px-3 py-1 text-xs font-medium text-white hover:bg-[#d85a14] disabled:opacity-50">{applyingAll ? 'Applying…' : `Apply all (${renamableCount})`}</button>
          </div>

          <div className="space-y-4">
            {groups.map(([path, fs]) => (
              <div key={path}>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{path}</div>
                <div className="space-y-1.5">
                  {fs.map(f => {
                    const rr = readRes[f.id]
                    const readType = rr?.detected ? typeFromDetected(rr.detected.itemKey, rr.detected.category) : null
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
                          </>
                        ) : (
                          <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500" title={f.reason}>
                            {f.category === 'approval' && f.sourceMimeType ? 'skip: unsigned draft' : `skip: ${CAT_LABEL[f.category] ?? f.category}`}
                          </span>
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
