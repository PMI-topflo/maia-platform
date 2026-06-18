'use client'

// =====================================================================
// NewWorkOrderModal.tsx — staff create a work order for THIS association.
// Captures the vendor (from CINC, or onboard a brand-new one), the scope,
// schedule, and an emergency flag, then creates the WO (ticket +
// work_order_details) so the downstream Add-invoice / ACH-W9 / payment
// flow works. Launched from the association hub Actions menu.
// =====================================================================

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import OnboardVendorModal from '@/components/OnboardVendorModal'

interface VendorOpt { id: number; name: string }

export default function NewWorkOrderModal({ assocCode, assocName, onClose }: {
  assocCode: string
  assocName: string
  onClose: () => void
}) {
  const router = useRouter()
  const [subject, setSubject] = useState('')
  const [scope, setScope] = useState('')
  const [woTypeId, setWoTypeId] = useState('')
  const [woTypes, setWoTypes] = useState<Array<{ id: number; name: string }>>([])
  const [emergency, setEmergency] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  const [vendors, setVendors] = useState<VendorOpt[] | null>(null)
  const [vendorId, setVendorId] = useState('')          // CINC VendorId (string in <select>)
  const [vendorEmail, setVendorEmail] = useState('')
  const [onboard, setOnboard] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/cinc/work-order-types').then(r => r.json()).then(d => setWoTypes(d.items ?? [])).catch(() => null)
    fetch(`/api/admin/cinc/association-vendors?assoc=${encodeURIComponent(assocCode)}`).then(r => r.json()).then(d => setVendors(d.vendors ?? [])).catch(() => setVendors([]))
  }, [assocCode])

  const vendorName = vendors?.find(v => String(v.id) === vendorId)?.name ?? null

  async function submit() {
    if (!subject.trim()) { setErr('A short title is required.'); return }
    setSubmitting(true); setErr(null)
    try {
      const chosenType = woTypes.find(t => String(t.id) === woTypeId)
      const res = await fetch('/api/admin/tickets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'work_order',
          channel_origin: 'internal',
          priority: emergency ? 'urgent' : 'normal',
          association_code: assocCode,
          subject: subject.trim(),
          initial_note: [emergency ? '🚨 EMERGENCY DISPATCH' : null, scope.trim() || null].filter(Boolean).join('\n\n') || null,
          work_order_type_id: chosenType?.id ?? null,
          work_order_type_name: chosenType?.name ?? null,
          vendor_name: vendorName,
          vendor_email: vendorEmail.trim() || null,
          cinc_vendor_id: vendorId ? Number(vendorId) : null,
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`)
      const id = d?.ticket?.id
      if (id) router.push(`/admin/tickets/${id}`)
      else { router.refresh(); onClose() }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setSubmitting(false) }
  }

  if (onboard) return <OnboardVendorModal onClose={() => setOnboard(false)} />

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/50 p-6">
      <div onClick={e => e.stopPropagation()} className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-5 py-3">
          <div className="text-sm font-semibold text-gray-900">New work order — {assocName}</div>
          <button onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-700" aria-label="Close">×</button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <Field label="Title *">
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Roof leak over unit 204" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select value={woTypeId} onChange={e => setWoTypeId(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                <option value="">— Default —</option>
                {woTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Scheduled date">
              <input type="date" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </Field>
          </div>

          <Field label="Scope of work">
            <textarea value={scope} onChange={e => setScope(e.target.value)} rows={3} placeholder="What needs to be done…" className="w-full rounded border border-gray-300 p-2 text-sm" />
          </Field>

          {/* Vendor */}
          <Field label="Vendor">
            <select value={vendorId} onChange={e => setVendorId(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">{vendors === null ? 'Loading vendors…' : '— none yet —'}</option>
              {(vendors ?? []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button type="button" onClick={() => setOnboard(true)} className="mt-1 text-xs font-medium text-[#16a34a] hover:underline">+ Onboard a new vendor (not in CINC)</button>
          </Field>
          <Field label="Vendor email (for dispatch / doc requests)">
            <input type="email" value={vendorEmail} onChange={e => setVendorEmail(e.target.value)} placeholder="vendor@example.com" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </Field>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={emergency} onChange={e => setEmergency(e.target.checked)} />
            🚨 Emergency dispatch (marks the work order urgent)
          </label>

          {err && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            <button onClick={submit} disabled={submitting || !subject.trim()} className="rounded bg-[#f26a1b] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#d85a14] disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create work order'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </label>
  )
}
