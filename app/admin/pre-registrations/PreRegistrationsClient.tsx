'use client'

import { useCallback, useEffect, useState } from 'react'
import AddPersonModal from '../components/AddPersonModal'
import OnboardVendorModal from '@/components/OnboardVendorModal'
import TenantVerificationModal from '../components/TenantVerificationModal'

interface PreReg {
  id: string; phone: string | null; persona: string | null; full_name: string | null
  email: string | null; association: string | null; unit: string | null; request: string
  source: string; language: string | null; status: string
  handled_by: string | null; handled_at: string | null; created_at: string
}

const PERSONAS = ['owner', 'tenant', 'buyer', 'board', 'vendor', 'agent', 'other'] as const
const PERSONA_LABEL: Record<string, string> = {
  owner: 'Owner', tenant: 'Tenant', buyer: 'Buyer', board: 'Board Member',
  vendor: 'Vendor', agent: 'Agent', other: 'Other',
}
const ET = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function PreRegistrationsClient({ associations }: { associations: Array<{ association_code: string; association_name: string }> }) {
  const [rows, setRows] = useState<PreReg[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [addPersonFor, setAddPersonFor] = useState<PreReg | null>(null)
  const [onboardVendorFor, setOnboardVendorFor] = useState<PreReg | null>(null)
  const [verifyTenantFor, setVerifyTenantFor] = useState<PreReg | null>(null)

  const load = useCallback(() => {
    fetch('/api/admin/pre-registrations').then(r => r.json()).then(d => setRows(d.preRegistrations ?? [])).catch(() => setRows([]))
  }, [])
  useEffect(load, [load])

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id); setMsg(null)
    try {
      const res = await fetch(`/api/admin/pre-registrations/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`)
      load()
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(null) }
  }

  async function post(id: string, path: string, okText: string) {
    setBusy(id); setMsg(null)
    try {
      const res = await fetch(`/api/admin/pre-registrations/${id}/${path}`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`)
      setMsg({ kind: 'ok', text: okText })
      load()
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(null) }
  }

  if (!rows) return <p className="text-sm text-gray-400">Loading…</p>
  if (rows.length === 0) return <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">No pre-registrations yet.</p>

  return (
    <div>
      {msg && <div className={`mb-3 rounded border px-3 py-2 text-sm ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg.text}</div>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Contact</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Property / Unit</th>
              <th className="px-4 py-2.5 font-medium">Request</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => (
              <tr key={r.id} className="align-top hover:bg-gray-50">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-gray-900">{r.full_name ?? '—'}</div>
                  <div className="text-xs text-gray-400">{r.email ?? '—'} · {r.phone ?? '—'}</div>
                  <div className="text-xs text-gray-300">via {r.source} · {ET(r.created_at)}</div>
                </td>
                <td className="px-4 py-2.5">
                  <select
                    value={r.persona ?? ''}
                    disabled={busy === r.id}
                    onChange={e => patch(r.id, { persona: e.target.value })}
                    className="rounded border border-gray-300 px-2 py-1 text-xs"
                  >
                    <option value="" disabled>— pick —</option>
                    {PERSONAS.map(p => <option key={p} value={p}>{PERSONA_LABEL[p]}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-600">{r.association ?? '—'}{r.unit ? ` · Unit ${r.unit}` : ''}</td>
                <td className="max-w-xs px-4 py-2.5 text-xs text-gray-600">{r.request}</td>
                <td className="px-4 py-2.5"><StatusPill status={r.status} /></td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <ApproveButton row={r} busy={busy === r.id} onOpenAddPerson={() => setAddPersonFor(r)} onOpenVendor={() => setOnboardVendorFor(r)} onOpenTenantVerify={() => setVerifyTenantFor(r)} onAddToProcess={() => post(r.id, 'add-to-process', `Application link sent to ${r.full_name}.`)} />
                    {r.status === 'added' && (
                      <button onClick={() => post(r.id, 'notify-access', `Access notice sent to ${r.full_name}.`)} disabled={busy === r.id}
                        className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                        Notify access
                      </button>
                    )}
                    {r.status !== 'dismissed' && (
                      <button onClick={() => patch(r.id, { status: 'dismissed' })} disabled={busy === r.id}
                        className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        Dismiss
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {addPersonFor && (
        <AddPersonModal
          associations={associations}
          initialTab={addPersonFor.persona === 'board' ? 'board' : addPersonFor.persona === 'agent' ? 'agent' : 'owner'}
          prefill={{ fullName: addPersonFor.full_name ?? undefined, email: addPersonFor.email ?? undefined, phone: addPersonFor.phone ?? undefined, association: addPersonFor.association ?? undefined }}
          onClose={() => setAddPersonFor(null)}
          onAdded={() => { const id = addPersonFor.id; setAddPersonFor(null); patch(id, { status: 'added' }) }}
        />
      )}

      {onboardVendorFor && (
        <OnboardVendorModal
          prefill={{ name: onboardVendorFor.full_name, email: onboardVendorFor.email, phone: onboardVendorFor.phone }}
          onClose={() => setOnboardVendorFor(null)}
          onSuccess={() => patch(onboardVendorFor.id, { status: 'added' })}
        />
      )}

      {verifyTenantFor && (
        <TenantVerificationModal
          preRegistrationId={verifyTenantFor.id}
          associations={associations}
          onClose={() => setVerifyTenantFor(null)}
          onApproved={() => { load() }}
        />
      )}
    </div>
  )
}

function ApproveButton({ row, busy, onOpenAddPerson, onOpenVendor, onOpenTenantVerify, onAddToProcess }: {
  row: PreReg; busy: boolean
  onOpenAddPerson: () => void; onOpenVendor: () => void; onOpenTenantVerify: () => void; onAddToProcess: () => void
}) {
  if (row.status === 'added') return <span className="text-xs text-emerald-700">✓ Added</span>
  if (row.status === 'dismissed') return <span className="text-xs text-gray-400">Dismissed</span>

  if (row.persona === 'owner' || row.persona === 'board' || row.persona === 'agent') {
    return (
      <button onClick={onOpenAddPerson} disabled={busy} className="rounded bg-[#f26a1b] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#d85a10] disabled:opacity-50">
        Approve / Add
      </button>
    )
  }
  if (row.persona === 'vendor') {
    return (
      <button onClick={onOpenVendor} disabled={busy} className="rounded bg-[#f26a1b] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#d85a10] disabled:opacity-50">
        Onboard in CINC
      </button>
    )
  }
  if (row.persona === 'buyer') {
    return (
      <button onClick={onAddToProcess} disabled={busy} className="rounded bg-[#f26a1b] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#d85a10] disabled:opacity-50">
        Add to process
      </button>
    )
  }
  if (row.persona === 'tenant') {
    return (
      <button onClick={onOpenTenantVerify} disabled={busy} className="rounded bg-[#f26a1b] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#d85a10] disabled:opacity-50">
        Verify tenant
      </button>
    )
  }
  return <span className="text-xs text-gray-300">Set role first</span>
}

function StatusPill({ status }: { status: string }) {
  if (status === 'added')     return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">Added</span>
  if (status === 'contacted') return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">Contacted</span>
  if (status === 'dismissed') return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">Dismissed</span>
  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">New</span>
}
