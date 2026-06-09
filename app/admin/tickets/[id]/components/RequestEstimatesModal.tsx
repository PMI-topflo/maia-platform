'use client'

// =====================================================================
// RequestEstimatesModal.tsx — from a work order, request estimates from
// vendors. Pick vendors (filtered by trade), connect an email to each,
// write the scope, attach the WO's photos, and send. Each vendor gets a
// tokenized accept-to-quote + upload link; Paola gets a summary.
// =====================================================================

import { useEffect, useState } from 'react'

interface Vendor { id: number; name: string; trade: string | null }
interface Photo { id: string; storage_path: string; filename: string | null; signed_url: string | null }
interface Sel { email: string }

export default function RequestEstimatesModal({ ticketId, assocCode, onClose, onSent }: {
  ticketId: number; assocCode: string | null; onClose: () => void; onSent: (n: number) => void
}) {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [trade, setTrade] = useState('')
  const [scope, setScope] = useState('')
  const [sel, setSel] = useState<Record<number, Sel>>({})
  const [selPhotos, setSelPhotos] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([
      assocCode ? fetch(`/api/admin/cinc/association-vendors?assoc=${encodeURIComponent(assocCode)}`).then(r => r.json()).catch(() => ({})) : Promise.resolve({}),
      fetch(`/api/admin/work-orders/${ticketId}/photos`).then(r => r.json()).catch(() => ({})),
    ]).then(([v, p]) => {
      if (!live) return
      setVendors((v.vendors ?? []).map((x: Vendor) => ({ id: x.id, name: x.name, trade: x.trade })))
      setPhotos((p.attachments ?? []).filter((a: Photo) => a.storage_path))
    }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [ticketId, assocCode])

  const trades = Array.from(new Set(vendors.map(v => v.trade).filter((t): t is string => !!t))).sort((a, b) => a.localeCompare(b))
  const shown = vendors.filter(v => !trade || v.trade === trade)
  const selectedIds = Object.keys(sel).map(Number)

  function toggleVendor(v: Vendor) {
    setSel(prev => { const n = { ...prev }; if (n[v.id]) delete n[v.id]; else n[v.id] = { email: '' }; return n })
  }
  function togglePhoto(path: string) {
    setSelPhotos(prev => { const s = new Set(prev); if (s.has(path)) s.delete(path); else s.add(path); return s })
  }

  async function send() {
    if (!scope.trim()) { setError('Add the scope of work.'); return }
    const chosen = vendors.filter(v => sel[v.id]).map(v => ({ vendor_id: v.id, vendor_name: v.name, vendor_email: (sel[v.id].email || '').trim() }))
    if (chosen.length === 0) { setError('Select at least one vendor.'); return }
    const missing = chosen.filter(c => !c.vendor_email.includes('@'))
    if (missing.length) { setError(`Add an email for: ${missing.map(m => m.vendor_name).join(', ')}`); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/admin/work-orders/${ticketId}/estimate-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: scope.trim(), photo_paths: [...selPhotos], vendors: chosen }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'failed to send')
      onSent(d.sent ?? chosen.length)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-black/45 p-4 py-10">
      <div onClick={e => e.stopPropagation()} className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">Request estimates</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>

        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Scope of work</label>
        <textarea value={scope} onChange={e => setScope(e.target.value)} rows={3} placeholder="Describe the work you want quoted…" className="mb-4 w-full rounded border border-gray-300 px-2.5 py-2 text-sm" />

        {photos.length > 0 && (
          <div className="mb-4">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Attach photos ({selPhotos.size})</div>
            <div className="flex flex-wrap gap-2">
              {photos.map(p => (
                <button key={p.id} onClick={() => togglePhoto(p.storage_path)} className={`relative h-16 w-16 overflow-hidden rounded border-2 ${selPhotos.has(p.storage_path) ? 'border-[#f26a1b]' : 'border-gray-200'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.signed_url ? <img src={p.signed_url} alt={p.filename ?? ''} className="h-full w-full object-cover" /> : <span className="text-[9px] text-gray-400">{p.filename}</span>}
                  {selPhotos.has(p.storage_path) && <span className="absolute right-0 top-0 bg-[#f26a1b] px-1 text-[9px] text-white">✓</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Vendors {selectedIds.length > 0 && <span className="text-[#f26a1b]">· {selectedIds.length} selected</span>}</div>
          <select value={trade} onChange={e => setTrade(e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700">
            <option value="">All types</option>
            {trades.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="max-h-64 overflow-y-auto rounded border border-gray-200">
          {loading ? <p className="p-3 text-xs text-gray-400">Loading vendors from CINC…</p>
            : shown.length === 0 ? <p className="p-3 text-xs text-gray-400">No vendors{assocCode ? ' on this association' : ''}.</p>
            : shown.map(v => (
              <div key={v.id} className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-2 last:border-0">
                <label className="flex flex-1 items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!sel[v.id]} onChange={() => toggleVendor(v)} />
                  <span className="font-medium text-gray-900">{v.name}</span>
                  {v.trade && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{v.trade}</span>}
                </label>
                {sel[v.id] && (
                  <input type="email" value={sel[v.id].email} onChange={e => setSel(prev => ({ ...prev, [v.id]: { email: e.target.value } }))}
                    placeholder="vendor@email.com" className="w-52 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs" />
                )}
              </div>
            ))}
        </div>

        {error && <div className="mt-3 text-xs text-red-600">⚠ {error}</div>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={send} disabled={busy} className="rounded bg-[#f26a1b] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d85a14] disabled:opacity-50">{busy ? 'Sending…' : 'Send estimate request'}</button>
        </div>
      </div>
    </div>
  )
}
