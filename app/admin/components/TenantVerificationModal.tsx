'use client'

import { useEffect, useState } from 'react'
import { computeStatus, type TenantVerificationRow } from '@/lib/tenant-verification'

interface Verification extends TenantVerificationRow {
  id: string
  association_code: string | null
  association_name: string | null
  unit_number: string | null
  tenant_name: string | null
  email: string | null
  phone: string | null
  lease_start_date: string | null
  owner_account_number: string | null
}

interface Props {
  preRegistrationId: string
  associations: Array<{ association_code: string; association_name: string }>
  onClose: () => void
  onApproved: () => void
}

const inputCls = 'w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#f26a1b] transition-colors'
const labelCls = 'block text-[0.6rem] font-mono uppercase tracking-[0.1em] text-gray-400 mb-1'
const gridTwo = 'grid grid-cols-2 gap-3'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={labelCls}>{label}</label>{children}</div>
}

function DocStatus({ label, path, source }: { label: string; path: string | null; source: string | null }) {
  if (!path) return <div className="text-xs text-gray-400">○ {label} — missing</div>
  return <div className="text-xs text-emerald-700">✓ {label} — on file ({source})</div>
}

export default function TenantVerificationModal({ preRegistrationId, associations, onClose, onApproved }: Props) {
  const [v, setV] = useState<Verification | null>(null)
  const [associationRaw, setAssociationRaw] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [assocCode, setAssocCode] = useState('')
  const [unit, setUnit] = useState('')
  const [uploadingDoc, setUploadingDoc] = useState<'lease' | 'board_letter' | null>(null)

  useEffect(() => {
    fetch(`/api/admin/pre-registrations/${preRegistrationId}/tenant-verification`).then(r => r.json()).then(d => {
      if (d.error) { setError(d.error); return }
      setV(d.verification); setAssociationRaw(d.associationRaw ?? null)
      setAssocCode(d.verification.association_code ?? ''); setUnit(d.verification.unit_number ?? '')
    }).catch(() => setError('Could not load verification.')).finally(() => setLoading(false))
  }, [preRegistrationId])

  async function saveAssociation() {
    if (!v) return
    setBusy(true); setError(''); setMsg('')
    try {
      const assoc = associations.find(a => a.association_code === assocCode)
      const res = await fetch(`/api/admin/tenant-verifications/${v.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ association_code: assocCode || null, association_name: assoc?.association_name ?? null, unit_number: unit || null }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'failed')
      setV(d.verification); setMsg('Saved.')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function uploadDoc(docType: 'lease' | 'board_letter', file: File) {
    if (!v) return
    setUploadingDoc(docType); setError('')
    try {
      const fd = new FormData(); fd.append('docType', docType); fd.append('file', file)
      const res = await fetch(`/api/admin/tenant-verifications/${v.id}/upload`, { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'upload failed')
      setV(d.verification)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setUploadingDoc(null) }
  }

  async function sendOwnerLink() {
    if (!v) return
    setBusy(true); setError(''); setMsg('')
    try {
      const res = await fetch(`/api/admin/tenant-verifications/${v.id}/send-owner-link`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'failed')
      setMsg(`Confirmation link sent to ${d.sentTo}.`)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function approve() {
    if (!v) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/admin/tenant-verifications/${v.id}/approve`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'failed')
      onApproved()
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }

  const status = v ? computeStatus(v) : 'pending'
  const ready = status === 'ready'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">Verify Tenant</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
          {loading && <p className="text-sm text-gray-400">Loading…</p>}
          {error && <p className="text-[0.72rem] text-red-500">{error}</p>}

          {v && (
            <>
              {associationRaw && <p className="text-xs text-gray-400">Self-reported: {associationRaw}{v.unit_number ? ` · Unit ${v.unit_number}` : ''}</p>}

              <div className="space-y-2">
                <Field label="Association *">
                  <select className={inputCls} value={assocCode} onChange={e => setAssocCode(e.target.value)}>
                    <option value="">Select association…</option>
                    {associations.map(a => <option key={a.association_code} value={a.association_code}>{a.association_name} ({a.association_code})</option>)}
                  </select>
                </Field>
                <div className={gridTwo}>
                  <Field label="Unit Number *"><input className={inputCls} value={unit} onChange={e => setUnit(e.target.value)} /></Field>
                  <div className="flex items-end">
                    <button onClick={saveAssociation} disabled={busy || !assocCode || !unit}
                      className="w-full text-[0.65rem] font-mono uppercase tracking-wider px-3 py-2 rounded border border-gray-200 text-gray-600 hover:border-gray-400 disabled:opacity-50">
                      Save
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-1 border-t border-gray-100 pt-3">
                <DocStatus label="Lease agreement" path={v.lease_path} source={v.lease_source} />
                <DocStatus label="Board approval letter" path={v.board_letter_path} source={v.board_letter_source} />
                <div className="text-xs text-gray-400">{v.owner_confirmed ? '✓ Owner confirmed' : 'Owner not yet confirmed'}</div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Upload lease</label>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" disabled={uploadingDoc === 'lease'}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadDoc('lease', f) }} className="block w-full text-xs" />
                </div>
                <div>
                  <label className={labelCls}>Upload board letter</label>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" disabled={uploadingDoc === 'board_letter'}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadDoc('board_letter', f) }} className="block w-full text-xs" />
                </div>
              </div>

              <button onClick={sendOwnerLink} disabled={busy || !v.association_code || !v.unit_number}
                className="w-full text-[0.65rem] font-mono uppercase tracking-wider px-4 py-2 rounded border border-gray-200 text-gray-600 hover:border-gray-400 disabled:opacity-50">
                Send confirmation link to owner
              </button>
              {msg && <p className="text-[0.72rem] text-emerald-600">{msg}</p>}
            </>
          )}
        </div>

        {v && (
          <div className="px-6 pb-5 pt-3 border-t border-gray-100 flex gap-3 justify-end flex-shrink-0">
            <button onClick={onClose} className="text-[0.65rem] font-mono uppercase tracking-wider px-4 py-2 rounded border border-gray-200 text-gray-500 hover:border-gray-400 transition-colors">
              Cancel
            </button>
            <button onClick={approve} disabled={busy || !ready}
              className="text-[0.65rem] font-mono uppercase tracking-wider px-5 py-2 rounded bg-[#f26a1b] text-white hover:bg-[#f58140] disabled:opacity-50 transition-colors">
              {ready ? 'Approve & Add Tenant' : 'Not ready yet'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
