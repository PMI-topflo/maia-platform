'use client'

import { useEffect, useMemo, useState } from 'react'
import { categoriesForScope } from '@/lib/compliance-taxonomy'

interface UnitOption { accountNumber: string; unit: string | null; ownerName: string }
interface CustomReq { association_code: string; item_key: string; label: string }

const UNIT_ITEMS = categoriesForScope('unit').flatMap(c => c.items)

export default function ManualUnitUpload({ associations, unitsByAssoc }: {
  associations: Array<{ association_code: string; association_name: string }>
  unitsByAssoc: Record<string, UnitOption[]>
}) {
  const [open, setOpen] = useState(false)
  const [assoc, setAssoc] = useState('')
  const [account, setAccount] = useState('')
  const [itemKey, setItemKey] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [customReqs, setCustomReqs] = useState<CustomReq[]>([])

  useEffect(() => {
    fetch('/api/admin/association-document-requirements').then(r => r.json()).then(d => setCustomReqs(d.requirements ?? [])).catch(() => null)
  }, [])

  const units = useMemo(() => (assoc ? unitsByAssoc[assoc] ?? [] : []), [assoc, unitsByAssoc])
  const selectedUnit = units.find(u => u.accountNumber === account)
  const customItemsForAssoc = useMemo(() => customReqs.filter(r => r.association_code === assoc), [customReqs, assoc])

  async function upload() {
    if (!assoc || !account || !itemKey || !file) { setMsg({ kind: 'err', text: 'Pick an association, unit, document type, and file.' }); return }
    setBusy(true); setMsg(null)
    try {
      const fd = new FormData()
      fd.append('assoc', assoc); fd.append('account', account); fd.append('itemKey', itemKey)
      fd.append('unitLabel', selectedUnit?.unit ?? account); fd.append('file', file)
      const res = await fetch('/api/admin/unit-status/manual-upload', { method: 'POST', body: fd })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'upload failed')
      setMsg({ kind: 'ok', text: 'Uploaded — review it in Document Inbox to file it.' })
      setFile(null); setItemKey('')
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }

  const selectCls = 'rounded border border-gray-300 px-2.5 py-1.5 text-xs w-full'

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between px-4 py-2.5 text-left">
        <span className="text-sm font-medium text-gray-900">📄 Upload a document manually</span>
        <span className="text-xs text-gray-400">{open ? 'Hide' : 'Pick unit + type, then upload'}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 p-4 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <select value={assoc} onChange={e => { setAssoc(e.target.value); setAccount('') }} className={selectCls}>
              <option value="">Association…</option>
              {associations.map(a => <option key={a.association_code} value={a.association_code}>{a.association_name} ({a.association_code})</option>)}
            </select>
            <select value={account} onChange={e => setAccount(e.target.value)} disabled={!assoc} className={selectCls}>
              <option value="">Unit…</option>
              {units.map(u => <option key={u.accountNumber} value={u.accountNumber}>{u.unit ? `Unit ${u.unit}` : u.accountNumber} — {u.ownerName || u.accountNumber}</option>)}
            </select>
            <select value={itemKey} onChange={e => setItemKey(e.target.value)} className={selectCls}>
              <option value="">Document type…</option>
              {UNIT_ITEMS.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
              {customItemsForAssoc.map(i => <option key={i.item_key} value={i.item_key}>{i.label} (custom)</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-xs flex-1" />
            <button onClick={upload} disabled={busy} className="rounded bg-[#f26a1b] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#d85a14] disabled:opacity-50">
              {busy ? 'Uploading…' : 'Upload'}
            </button>
          </div>
          {msg && <div className={`rounded px-3 py-2 text-xs ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}
        </div>
      )}
    </div>
  )
}
