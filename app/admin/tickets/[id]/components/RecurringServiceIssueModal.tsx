'use client'

// Route a recurring-service complaint to the vendor's next visit instead of a
// standalone work order. Paola picks the recurring service, adds a note, and
// sends — the vendor gets the issue (+ the resident's photo) for their next visit.

import { useEffect, useState } from 'react'

interface RS { id: number; vendor_name: string; service_type: string; cadence: string; hasEmail: boolean }
interface Existing { id: string; vendor_name: string; service_type: string; next_visit_date: string | null; status: string }

export default function RecurringServiceIssueModal({ ticketId, onClose }: { ticketId: number; onClose: (sent?: boolean) => void }) {
  const [services, setServices] = useState<RS[]>([])
  const [existing, setExisting] = useState<Existing | null>(null)
  const [rsId, setRsId] = useState('')
  const [note, setNote] = useState('')
  const [resident, setResident] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/admin/tickets/${ticketId}/service-issue`).then(r => r.json())
      .then((d: { recurringServices?: RS[]; woType?: string | null; existing?: Existing | null }) => {
        if (!live) return
        const list = d.recurringServices ?? []
        setServices(list); setExisting(d.existing ?? null)
        // Default-match by work-order type → service type.
        const wt = (d.woType ?? '').toLowerCase()
        const match = list.find(s => wt && (s.service_type ?? '').toLowerCase().includes(wt.split(' ')[0]))
        setRsId(String((match ?? list[0])?.id ?? ''))
      }).catch(() => {}).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [ticketId])

  async function send() {
    if (!rsId) { setMsg('Pick the recurring service.'); return }
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/service-issue`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recurring_service_id: Number(rsId), note, resident_email: resident || undefined }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'failed')
      onClose(true)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }

  return (
    <div onClick={() => onClose()} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div onClick={e => e.stopPropagation()} className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl">
        <div className="mb-1 text-base font-bold text-gray-900">Route to the recurring vendor</div>
        <p className="mb-4 text-xs text-gray-500">A complaint about a recurring service goes to that vendor to fix on their <strong>next scheduled visit</strong> — no new work order.</p>

        {loading ? <p className="text-sm text-gray-400">Loading…</p>
        : existing ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Already routed to <strong>{existing.vendor_name}</strong> ({existing.service_type}) — status <strong>{existing.status.replace('_', ' ')}</strong>{existing.next_visit_date ? `, next visit ${existing.next_visit_date}` : ''}.
          </div>
        ) : services.length === 0 ? (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">No active recurring services for this association — handle as a normal work order.</div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Recurring service</label>
              <select value={rsId} onChange={e => setRsId(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-2 text-sm">
                {services.map(s => <option key={s.id} value={s.id}>{s.vendor_name} — {s.service_type} ({s.cadence}){s.hasEmail ? '' : ' · no email'}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Note to the vendor (from Paola)</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="e.g. Pool is cloudy at the shallow end — please check chemicals on your next visit." className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Resident email (optional — sends an acknowledgment)</label>
              <input value={resident} onChange={e => setResident(e.target.value)} placeholder="resident@example.com" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <p className="text-[11px] text-gray-400">The resident&apos;s reported photo (if any) is included automatically.</p>
          </div>
        )}

        {msg && <div className="mt-2 text-[11px] text-red-600">{msg}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => onClose()} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700">Cancel</button>
          {!existing && services.length > 0 && (
            <button onClick={send} disabled={busy} className="rounded bg-[#f26a1b] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#d2570f] disabled:opacity-50">{busy ? 'Sending…' : 'Send to vendor'}</button>
          )}
        </div>
      </div>
    </div>
  )
}
