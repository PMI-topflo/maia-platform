'use client'

// =====================================================================
// DriveImport.tsx — bulk-import documents from a shared Google Drive folder
// into the MAIA Document Inbox. Paste a folder link (shared with Maia's
// service account) → scan recursively → pick files → each runs through the
// normal classify/split/review pipeline. The folder breadcrumb is used as a
// classification hint. Imported rows are handed back to the inbox.
// =====================================================================

import { useMemo, useState } from 'react'

interface DFile { id: string; name: string; mimeType: string; path: string; size: number | null; sourceMimeType?: string; include?: boolean; category?: string; reason?: string }

const CAT_LABEL: Record<string, string> = {
  approval: 'Approval', certificate_of_use: 'Cert of Use', insurance: 'Insurance', lease: 'Lease',
  id: 'ID', credit: 'Credit', criminal: 'Background', tax: 'Tax/income', unknown: 'Unrecognized',
}

export default function DriveImport({ onImported }: { onImported: (rows: unknown[]) => void }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [scanning, setScanning] = useState(false)
  const [files, setFiles] = useState<DFile[] | null>(null)
  const [foldersScanned, setFoldersScanned] = useState(0)
  const [sa, setSa] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [imp, setImp] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // Whitelist ON = import only the compliance docs (approvals / Cert of Use /
  // insurance / leases), skip PII. OFF = show everything, pick manually.
  const [whitelist, setWhitelist] = useState(true)

  const shown = useMemo(() => (whitelist ? (files ?? []).filter(f => f.include) : (files ?? [])), [files, whitelist])
  const skippedCount = useMemo(() => (files ?? []).filter(f => !f.include).length, [files])

  const groups = useMemo(() => {
    const m = new Map<string, DFile[]>()
    for (const f of shown) { const k = f.path || '(top level)'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(f) }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [shown])

  async function scan() {
    setScanning(true); setError(null); setDone(null); setFiles(null)
    try {
      const res = await fetch('/api/admin/documents/drive/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderUrl: url }) })
      const j = await res.json()
      if (j.serviceAccountEmail) setSa(j.serviceAccountEmail)
      if (!res.ok) throw new Error(j?.error ?? 'scan failed')
      const fs = (j.files ?? []) as DFile[]
      setFoldersScanned(Number(j.foldersScanned ?? 0))
      // Default selection = the whitelisted (include) files only.
      setFiles(fs); setSel(new Set(fs.filter(f => f.include).map(f => f.id)))
      if (fs.length === 0) setError('No PDFs or images found in that folder.')
    } catch (e) { setError((e as Error).message) } finally { setScanning(false) }
  }

  function toggle(id: string) { setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }) }

  async function importSelected() {
    const picked = (files ?? []).filter(f => sel.has(f.id))
    if (picked.length === 0) return
    setImp({ done: 0, total: picked.length }); setError(null); setDone(null)
    let ok = 0; const failed: string[] = []
    for (let i = 0; i < picked.length; i++) {
      const f = picked[i]
      try {
        const res = await fetch('/api/admin/documents/drive/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: f.id, name: f.name, mimeType: f.mimeType, path: f.path }) })
        const j = await res.json()
        if (!res.ok) throw new Error(j?.error ?? 'import failed')
        onImported(j.rows ?? [])
        ok++
        setFiles(prev => (prev ?? []).filter(x => x.id !== f.id))
        setSel(s => { const n = new Set(s); n.delete(f.id); return n })
      } catch (e) { failed.push(`${f.name}: ${(e as Error).message}`) }
      setImp({ done: i + 1, total: picked.length })
    }
    setImp(null)
    setDone(`Imported ${ok} file(s)${failed.length ? ` · ${failed.length} failed` : ''} — review them below.`)
    if (failed.length) setError(failed.slice(0, 4).join(' · '))
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between px-4 py-2.5 text-left">
        <span className="text-sm font-medium text-gray-900">📁 Import from Google Drive</span>
        <span className="text-xs text-gray-400">{open ? 'Hide' : 'Bulk-import a folder'}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 p-4">
          {sa && (
            <p className="mb-2 text-xs text-gray-500">First, share your Drive folder (Viewer) with <span className="font-mono text-gray-700">{sa}</span>, then paste the folder link.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/…"
              className="min-w-0 flex-1 rounded border border-gray-300 px-2.5 py-1.5 text-sm" />
            <button onClick={scan} disabled={scanning || !url.trim()} className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">{scanning ? 'Scanning…' : 'Scan'}</button>
          </div>

          {error && <div className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          {done && <div className="mt-2 rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{done}</div>}

          {files && files.length > 0 && (
            <div className="mt-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-gray-500">
                  {files.length} file(s) across {foldersScanned} folder(s) · {sel.size} selected
                  {skippedCount > 0 && <span className="text-gray-400"> · {skippedCount} skipped by filter</span>}
                </span>
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1 text-xs text-gray-600" title="Import only board approvals, Certificate of Use, insurance, and leases — skip IDs, credit/background reports, tax returns, and unsigned approval drafts.">
                    <input type="checkbox" checked={whitelist} onChange={e => setWhitelist(e.target.checked)} />
                    Compliance docs only
                  </label>
                  <button onClick={() => setSel(new Set(shown.map(f => f.id)))} className="text-xs text-gray-500 hover:underline">All</button>
                  <button onClick={() => setSel(new Set())} className="text-xs text-gray-500 hover:underline">None</button>
                  <button onClick={importSelected} disabled={!!imp || sel.size === 0} className="rounded bg-[#f26a1b] px-3 py-1 text-xs font-medium text-white hover:bg-[#d85a14] disabled:opacity-50">{imp ? `Importing… ${imp.done}/${imp.total}` : `Import ${sel.size}`}</button>
                </div>
              </div>
              <div className="max-h-72 space-y-2 overflow-auto">
                {groups.map(([path, fs]) => (
                  <div key={path}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{path}</div>
                    {fs.map(f => (
                      <label key={f.id} className={`flex cursor-pointer items-center gap-2 py-0.5 text-xs ${f.include ? 'text-gray-700' : 'text-gray-400'}`} title={f.reason ?? ''}>
                        <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} />
                        <span className="truncate">{f.name}</span>
                        {f.sourceMimeType && <span className="shrink-0 rounded bg-blue-50 px-1 text-[10px] text-blue-600">Doc→PDF</span>}
                        {f.category && (
                          <span className={`shrink-0 rounded px-1 text-[10px] ${f.include ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                            {f.include ? CAT_LABEL[f.category] ?? f.category : `skip: ${CAT_LABEL[f.category] ?? f.category}`}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
