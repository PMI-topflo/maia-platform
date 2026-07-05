'use client'

import { useEffect, useState } from 'react'

interface Detail {
  associationName: string | null; unit: string | null
  ownerName: string; ownerEmail: string | null
  occupancy: string | null; occupancyLabel: string | null
  missing: { key: string; label: string; declaredType: string | null }[]
}

export default function UnitDetailModal({ assoc, account, onClose }: { assoc: string; account: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/admin/unit-status/detail?assoc=${encodeURIComponent(assoc)}&account=${encodeURIComponent(account)}`)
      .then(r => r.json()).then(d => { if (d.error) setError(d.error); else setDetail(d) })
      .catch(() => setError('Could not load unit detail.')).finally(() => setLoading(false))
  }, [assoc, account])

  async function resend() {
    setBusy(true); setMsg(null); setError(null)
    try {
      const res = await fetch('/api/admin/unit-status/resend', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assoc, account }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'failed')
      setMsg(`Sent to ${j.sentTo}.`)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md shadow-2xl flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">Unit detail</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1 space-y-3">
          {loading && <p className="text-sm text-gray-400">Loading…</p>}
          {error && <p className="text-[0.72rem] text-red-500">{error}</p>}
          {detail && (
            <>
              <div>
                <div className="text-sm font-medium text-gray-900">{detail.associationName}{detail.unit ? ` · Unit ${detail.unit}` : ''} <span className="text-xs text-gray-400">({account})</span></div>
                <div className="text-xs text-gray-500 mt-0.5">{detail.ownerName || '—'}{detail.ownerEmail ? ` · ${detail.ownerEmail}` : ' · no email on file'}</div>
                <div className="text-xs text-gray-500 mt-0.5">Occupancy: {detail.occupancyLabel ?? 'Not set'}</div>
              </div>
              <div className="border-t border-gray-100 pt-3">
                {detail.missing.length === 0 ? (
                  <div className="text-xs text-emerald-700">✓ Nothing missing.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {detail.missing.map(m => (
                      <li key={m.key} className="text-xs text-gray-700 flex items-start gap-1.5">
                        <span className="text-red-500">•</span>
                        <span>{m.label}{m.declaredType ? <span className="text-gray-400"> — declared: {m.declaredType}</span> : null}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {msg && <p className="text-xs text-emerald-600">{msg}</p>}
            </>
          )}
        </div>
        <div className="px-6 pb-5 pt-3 border-t border-gray-100 flex gap-3 justify-end flex-shrink-0">
          <button onClick={onClose} className="text-[0.65rem] font-mono uppercase tracking-wider px-4 py-2 rounded border border-gray-200 text-gray-500 hover:border-gray-400">Close</button>
          {detail && detail.missing.length > 0 && (
            <button onClick={resend} disabled={busy || !detail.ownerEmail}
              className="text-[0.65rem] font-mono uppercase tracking-wider px-5 py-2 rounded bg-[#f26a1b] text-white hover:bg-[#f58140] disabled:opacity-50">
              {busy ? 'Sending…' : 'Resend request'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
