'use client'

// EstimatesComparison — side-by-side of the vendor estimates requested on a
// work order (status, amount, respond-by, PDF). Renders nothing until an
// estimate request exists. Board approval (send + e-sign) lands next phase.

import { useEffect, useState } from 'react'

interface VRow { id: string; vendor_name: string | null; status: string; respond_by: string | null; submitted_at: string | null; amount: number | null; summary: string | null; estimate_url: string | null }
interface Data { request: { id: string; scope: string; status: string } | null; vendors: VRow[] }

const money = (n: number | null) => n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const STATUS: Record<string, { label: string; cls: string }> = {
  sent:      { label: 'Sent',      cls: 'bg-gray-100 text-gray-600' },
  accepted:  { label: 'Quoting',   cls: 'bg-blue-100 text-blue-800' },
  submitted: { label: 'Estimate in', cls: 'bg-emerald-100 text-emerald-800' },
  declined:  { label: 'Declined',  cls: 'bg-red-100 text-red-700' },
}

export default function EstimatesComparison({ ticketId }: { ticketId: number }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    fetch(`/api/admin/work-orders/${ticketId}/estimates`).then(r => r.json())
      .then((d: Data) => { if (live) setData(d) }).catch(() => {}).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [ticketId])

  if (loading || !data?.request) return null
  const submitted = data.vendors.filter(v => v.amount != null)
  const lowest = submitted.length ? Math.min(...submitted.map(v => v.amount as number)) : null

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
            return (
              <tr key={v.id} className="border-t border-gray-100">
                <td className="py-1.5 font-medium text-gray-900">{v.vendor_name ?? '—'}</td>
                <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS[v.status]?.cls ?? 'bg-gray-100 text-gray-600'}`}>{STATUS[v.status]?.label ?? v.status}</span></td>
                <td className="py-1.5 text-right tabular-nums text-gray-900">{money(v.amount)} {isLow && <span className="ml-1 rounded bg-emerald-100 px-1 text-[9px] font-semibold text-emerald-700">lowest</span>}</td>
                <td className="py-1.5 pl-4 text-xs text-gray-500">{v.submitted_at ? new Date(v.submitted_at).toLocaleDateString() : v.respond_by ?? '—'}</td>
                <td className="py-1.5 text-right">{v.estimate_url ? <a href={v.estimate_url} target="_blank" rel="noreferrer" className="text-xs text-[#f26a1b] hover:underline">View PDF</a> : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {submitted.length > 0 && (
        <p className="mt-3 text-[11px] text-gray-400">Next: send this comparison to the board for approval + e-signature.</p>
      )}
    </div>
  )
}
