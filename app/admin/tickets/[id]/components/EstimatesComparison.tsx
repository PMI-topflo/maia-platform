'use client'

// EstimatesComparison — side-by-side of the vendor estimates requested on a
// work order (status, amount, respond-by, inline preview images). Staff send
// the whole comparison to the board (optionally flagging a recommendation);
// the board picks the winner and e-signs.

import { useEffect, useState } from 'react'
import BoardMemberPicker from '@/app/admin/components/BoardMemberPicker'

interface VRow { id: string; vendor_name: string | null; status: string; respond_by: string | null; submitted_at: string | null; amount: number | null; summary: string | null; estimate_url: string | null }
interface Approval { vendor_name: string | null; amount: number | null; status: string; required: number; approvals: number }
interface Data { request: { id: string; scope: string; status: string; association_code?: string } | null; vendors: VRow[]; approval: Approval | null }

const money = (n: number | null) => n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const STATUS: Record<string, { label: string; cls: string }> = {
  sent:      { label: 'Sent',      cls: 'bg-gray-100 text-gray-600' },
  accepted:  { label: 'Quoting',   cls: 'bg-blue-100 text-blue-800' },
  submitted: { label: 'Estimate in', cls: 'bg-emerald-100 text-emerald-800' },
  declined:  { label: 'Declined',  cls: 'bg-red-100 text-red-700' },
}

const APPR_STYLE: Record<string, string> = { pending: 'bg-amber-50 border-amber-200 text-amber-800', approved: 'bg-emerald-50 border-emerald-200 text-emerald-800', revision_requested: 'bg-red-50 border-red-200 text-red-800' }
const APPR_LABEL: Record<string, string> = { pending: 'Awaiting board', approved: 'Board approved', revision_requested: 'Revision requested' }

export default function EstimatesComparison({ ticketId }: { ticketId: number }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [recommended, setRecommended] = useState('')
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [signerIds, setSignerIds] = useState<string[]>([])
  const [openErv, setOpenErv] = useState<string | null>(null)
  const [pagesByErv, setPagesByErv] = useState<Record<string, string[]>>({})

  useEffect(() => {
    let live = true
    fetch(`/api/admin/work-orders/${ticketId}/estimates`).then(r => r.json())
      .then((d: Data) => {
        if (!live) return
        setData(d)
      }).catch(() => {}).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [ticketId])

  function togglePreview(ervId: string) {
    if (openErv === ervId) { setOpenErv(null); return }
    setOpenErv(ervId)
    if (pagesByErv[ervId] === undefined) {
      fetch(`/api/admin/work-orders/${ticketId}/estimate-preview?erv=${encodeURIComponent(ervId)}`).then(r => r.json())
        .then((p: { pages?: string[] }) => setPagesByErv(prev => ({ ...prev, [ervId]: p.pages ?? [] }))).catch(() => setPagesByErv(prev => ({ ...prev, [ervId]: [] })))
    }
  }

  async function sendToBoard() {
    setSending(true); setMsg(null)
    try {
      const res = await fetch(`/api/admin/work-orders/${ticketId}/send-estimate-to-board`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recommended_vendor_request_id: recommended || undefined, signer_ids: signerIds }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'failed')
      setMsg(`Comparison of ${d.vendors} estimate(s) sent to ${d.sent} board member(s) — needs ${d.required} approval(s).`)
      setData(prev => prev ? { ...prev, approval: { vendor_name: null, amount: null, status: 'pending', required: d.required, approvals: 0 } } : prev)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setSending(false) }
  }

  if (loading || !data?.request) return null
  const submitted = data.vendors.filter(v => v.amount != null || v.status === 'submitted')
  const lowest = submitted.length ? Math.min(...submitted.filter(v => v.amount != null).map(v => v.amount as number)) : null

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Estimates <span className="text-gray-400">· {data.vendors.length}</span></h3>
        <span className="text-[11px] text-gray-400">{submitted.length} in</span>
      </div>
      <p className="mb-3 text-xs text-gray-500">{data.request.scope}</p>
      <table className="w-full text-sm">
        <thead><tr className="text-[10px] uppercase tracking-wide text-gray-400">
          <th className="pb-1 text-left font-semibold">Vendor</th>
          <th className="pb-1 text-left font-semibold">Status</th>
          <th className="pb-1 text-right font-semibold">Amount</th>
          <th className="pb-1 pl-4 text-left font-semibold">By</th>
          <th className="pb-1"></th>
        </tr></thead>
        <tbody>
          {data.vendors.map(v => {
            const isLow = v.amount != null && v.amount === lowest && submitted.length > 1
            const hasEstimate = !!v.estimate_url || v.status === 'submitted'
            const isOpen = openErv === v.id
            const pages = pagesByErv[v.id]
            return (
              <>
                <tr key={v.id} className="border-t border-gray-100">
                  <td className="py-1.5 font-medium text-gray-900">{v.vendor_name ?? '—'}</td>
                  <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS[v.status]?.cls ?? 'bg-gray-100 text-gray-600'}`}>{STATUS[v.status]?.label ?? v.status}</span></td>
                  <td className="py-1.5 text-right tabular-nums text-gray-900">{money(v.amount)} {isLow && <span className="ml-1 rounded bg-emerald-100 px-1 text-[9px] font-semibold text-emerald-700">lowest</span>}</td>
                  <td className="py-1.5 pl-4 text-xs text-gray-500">{v.submitted_at ? new Date(v.submitted_at).toLocaleDateString() : v.respond_by ?? '—'}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    {hasEstimate && <button onClick={() => togglePreview(v.id)} className="text-xs text-[#f26a1b] hover:underline">{isOpen ? 'Hide' : 'Preview'}</button>}
                    {v.estimate_url && <a href={v.estimate_url} target="_blank" rel="noreferrer" className="ml-2 text-xs text-gray-400 hover:underline">PDF ↗</a>}
                  </td>
                </tr>
                {isOpen && (
                  <tr key={`${v.id}-preview`} className="border-t border-gray-50 bg-gray-50/50">
                    <td colSpan={5} className="p-2">
                      {v.summary && <div className="mb-2 text-xs text-gray-600 whitespace-pre-wrap">{v.summary}</div>}
                      {pages === undefined && <div className="text-xs text-gray-400">Loading preview…</div>}
                      {pages && pages.length === 0 && <div className="text-xs text-gray-400">No preview available.</div>}
                      {pages && pages.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {pages.map((src, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <a key={i} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`page ${i + 1}`} className="h-40 rounded border border-gray-200 bg-white object-contain" /></a>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            )
          })}
        </tbody>
      </table>
      {data.approval ? (
        <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${APPR_STYLE[data.approval.status] ?? 'bg-gray-50 border-gray-200 text-gray-700'}`}>
          <span className="font-semibold">{APPR_LABEL[data.approval.status] ?? data.approval.status}</span>
          {data.approval.vendor_name ? <> · {data.approval.vendor_name} {money(data.approval.amount)}</> : <> · comparison sent</>}
          {data.approval.status !== 'revision_requested' && <span> · {data.approval.approvals}/{data.approval.required} signed</span>}
        </div>
      ) : submitted.length > 0 ? (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Send comparison to board</span>
            <select value={recommended} onChange={e => { setRecommended(e.target.value); setMsg(null) }} className="rounded border border-gray-300 px-2 py-1 text-xs">
              <option value="">no recommendation</option>
              {submitted.map(v => <option key={v.id} value={v.id}>★ recommend {v.vendor_name} · {money(v.amount)}</option>)}
            </select>
            <button onClick={sendToBoard} disabled={sending} className="rounded bg-[#16a34a] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#15803d] disabled:opacity-50">{sending ? 'Sending…' : '🏛️ Send for approval'}</button>
          </div>
          {data.request.association_code && (
            <div className="mt-2">
              <BoardMemberPicker
                associationCode={data.request.association_code}
                purpose="estimate"
                value={signerIds}
                onChange={setSignerIds}
                label="Signers"
              />
            </div>
          )}
          {msg && <div className="mt-1 text-[11px] text-gray-500">{msg}</div>}
        </div>
      ) : null}
    </div>
  )
}
