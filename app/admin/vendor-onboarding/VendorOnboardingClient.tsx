'use client'

import { useCallback, useEffect, useState } from 'react'

interface Onboarding {
  id: string; cinc_vendor_id: number | null; company_name: string; email: string | null
  license_required: boolean; coi_status: string; license_status: string; w9_status: string; ach_status: string
  created_at: string
}

const ET = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })

export default function VendorOnboardingClient() {
  const [rows, setRows] = useState<Onboarding[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(() => {
    fetch('/api/admin/vendors/onboarding').then(r => r.json()).then(d => setRows(d.onboardings ?? [])).catch(() => setRows([]))
  }, [])
  useEffect(load, [load])

  async function confirmAch(id: string, name: string) {
    setBusy(id); setMsg(null)
    try {
      const res = await fetch(`/api/admin/vendors/onboarding/${id}/confirm-ach`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`)
      setMsg({ kind: 'ok', text: `Banking confirmed and written to CINC for ${name}.` })
      load()
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(null) }
  }

  if (!rows) return <p className="text-sm text-gray-400">Loading…</p>
  if (rows.length === 0) return <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">No vendor onboardings yet. Start one from an association&apos;s Vendors tab.</p>

  return (
    <div>
      {msg && <div className={`mb-3 rounded border px-3 py-2 text-sm ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg.text}</div>}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Vendor</th>
              <th className="px-4 py-2.5 font-medium text-center">W-9</th>
              <th className="px-4 py-2.5 font-medium text-center">ACH</th>
              <th className="px-4 py-2.5 font-medium text-center">COI</th>
              <th className="px-4 py-2.5 font-medium text-center">License</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-gray-900">{r.company_name}</div>
                  <div className="text-xs text-gray-400">{r.cinc_vendor_id ? `CINC #${r.cinc_vendor_id}` : 'no CINC id'} · started {ET(r.created_at)}</div>
                </td>
                <td className="px-4 py-2.5 text-center"><DocCell s={r.w9_status} /></td>
                <td className="px-4 py-2.5 text-center"><DocCell s={r.ach_status} /></td>
                <td className="px-4 py-2.5 text-center"><DocCell s={r.coi_status} /></td>
                <td className="px-4 py-2.5 text-center"><DocCell s={r.license_status} /></td>
                <td className="px-4 py-2.5 text-right">
                  {r.ach_status === 'received' && (
                    <button onClick={() => confirmAch(r.id, r.company_name)} disabled={busy === r.id}
                      className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                      {busy === r.id ? 'Confirming…' : 'Confirm banking → CINC'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DocCell({ s }: { s: string }) {
  if (s === 'applied')  return <span className="text-emerald-700">✓</span>
  if (s === 'received') return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">review</span>
  if (s === 'na')       return <span className="text-gray-300">—</span>
  return <span className="text-gray-400">·</span>
}
