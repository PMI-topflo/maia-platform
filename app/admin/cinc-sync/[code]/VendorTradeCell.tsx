'use client'

// Editable vendor trade/type cell for the Vendors tab. Lets staff assign a
// CINC vendor type (pushed to CINC) or a MAIA-local trade CINC lacks. Loads
// the CINC type catalog on first open (module-cached across cells).

import { useState } from 'react'

interface CincType { id: string; name: string }
let _typesCache: { cinc: CincType[]; local: string[] } | null = null

export default function VendorTradeCell({ vendorId, trade, tradeSource, onSaved }: {
  vendorId: number; trade: string | null; tradeSource: string | null
  onSaved: (trade: string, source: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [types, setTypes] = useState<{ cinc: CincType[]; local: string[] } | null>(_typesCache)
  const [choice, setChoice] = useState('')          // 'cinc:<id>' | 'local:<name>' | 'custom'
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function openEditor() {
    setOpen(true); setErr(null)
    if (!types) {
      const t = await fetch('/api/admin/cinc/vendor-types').then(r => r.json()).catch(() => ({}))
      const loaded = { cinc: (t.cincTypes ?? []) as CincType[], local: (t.localTypes ?? []) as string[] }
      _typesCache = loaded; setTypes(loaded)
    }
  }

  async function save() {
    let payload: Record<string, unknown> | null = null
    if (choice.startsWith('cinc:')) {
      const id = choice.slice(5)
      const name = types?.cinc.find(c => c.id === id)?.name ?? ''
      payload = { vendor_id: vendorId, cinc_type_id: id, cinc_type_name: name }
    } else if (choice.startsWith('local:')) {
      payload = { vendor_id: vendorId, local_trade: choice.slice(6) }
    } else if (choice === 'custom') {
      if (!custom.trim()) { setErr('Type a trade name.'); return }
      payload = { vendor_id: vendorId, local_trade: custom.trim() }
    }
    if (!payload) { setErr('Pick a type.'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/admin/cinc/vendor-type', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'failed')
      onSaved(d.trade, d.source)
      setOpen(false)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button onClick={openEditor} className="group inline-flex items-center gap-1 text-left text-gray-600 hover:text-[#c2410c]">
        {trade ? <>{trade}{tradeSource === 'local' && <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] text-amber-700">local</span>}</> : <span className="text-gray-300">— set</span>}
        <span className="text-[10px] text-gray-300 group-hover:text-[#f26a1b]">✎</span>
      </button>
    )
  }

  return (
    <div className="min-w-[200px]">
      {!types ? <span className="text-[11px] text-gray-400">Loading types…</span> : (
        <>
          <select value={choice} onChange={e => setChoice(e.target.value)} className="mb-1 w-full rounded border border-gray-300 px-1.5 py-1 text-[11px]">
            <option value="">— choose —</option>
            {types.cinc.length > 0 && <optgroup label="CINC types (synced)">{types.cinc.map(c => <option key={c.id} value={`cinc:${c.id}`}>{c.name}</option>)}</optgroup>}
            {types.local.length > 0 && <optgroup label="MAIA-local">{types.local.map(l => <option key={l} value={`local:${l}`}>{l}</option>)}</optgroup>}
            <option value="custom">+ New local trade…</option>
          </select>
          {choice === 'custom' && <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="e.g. Roofer" className="mb-1 w-full rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-[11px]" />}
          {err && <div className="text-[10px] text-red-600">{err}</div>}
          <div className="flex gap-1.5">
            <button onClick={save} disabled={busy} className="rounded bg-[#f26a1b] px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50">{busy ? '…' : 'Save'}</button>
            <button onClick={() => setOpen(false)} disabled={busy} className="text-[11px] text-gray-500">Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}
