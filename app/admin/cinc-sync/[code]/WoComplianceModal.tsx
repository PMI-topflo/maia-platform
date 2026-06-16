'use client'

// =====================================================================
// WoComplianceModal.tsx
// The ACH/W-9 gate Paola sees when she clicks "+ Add invoice" on a work
// order. Shows what CINC has on file for the vendor; if ACH or W-9 is
// missing the invoice upload is blocked and she can email the vendor a
// request (Paola is cc'd) which flags the WO for follow-up. Once both are
// on file she can choose the invoice file, which uploads to review.
// =====================================================================

import { useEffect, useRef, useState } from 'react'
import OnboardVendorModal from '@/components/OnboardVendorModal'

interface Compliance {
  vendorName: string | null
  vendorEmail: string | null
  cincVendorId: number | null
  canVerify: boolean
  achOnFile: boolean
  w9OnFile: boolean
  coi: { onFile: boolean; valid: boolean | null; expiration: string | null } | null
  license: { onFile: boolean; valid: boolean | null; expiration: string | null } | null
  missing: string[]
  missingKeys: string[]
  canUpload: boolean
  requestedAt: string | null
}

const ET = (iso: string | null) => iso
  ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }) + ' ET'
  : ''

export default function WoComplianceModal({ woId, onClose, onDone }: {
  woId: number
  onClose: () => void
  onDone: (m: { kind: 'ok' | 'err'; text: string }) => void
}) {
  const [c, setC] = useState<Compliance | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [requestedNow, setRequestedNow] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [onboard, setOnboard] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/admin/work-orders/${woId}/vendor-compliance`)
      .then(r => r.json())
      .then(d => { if (live) { if (d.error) setErr(d.error); else setC(d) } })
      .catch(e => { if (live) setErr(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [woId])

  async function requestDocs() {
    setRequesting(true); setErr(null)
    try {
      const res = await fetch(`/api/admin/work-orders/${woId}/request-vendor-docs`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`)
      setRequestedNow(true)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setRequesting(false) }
  }

  async function uploadFile(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true); setErr(null)
    try {
      const fd = new FormData(); fd.append('file', files[0])
      const res = await fetch(`/api/admin/work-orders/${woId}/add-invoice`, { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`)
      onDone({ kind: 'ok', text: d.status === 'needs_vendor'
        ? 'Invoice added & WO marked ready for payment — but the vendor isn’t matched in CINC yet, so match it in the Invoice queue.'
        : 'Invoice added — work order is now Ready for payment and waiting in the Invoice review queue.' })
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setUploading(false) }
  }

  const blocked = c ? (c.canVerify && !c.canUpload) : false

  if (onboard) return <OnboardVendorModal prefill={{ name: c?.vendorName ?? null, email: c?.vendorEmail ?? null }} onClose={() => { setOnboard(false); onClose() }} />

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/50 p-6">
      <div onClick={e => e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-5 py-3">
          <div className="text-sm font-semibold text-gray-900">Add invoice — vendor compliance</div>
          <button onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-700" aria-label="Close">×</button>
        </div>

        <div className="px-5 py-4">
          {!c && !err && <p className="text-sm text-gray-500">Checking what CINC has on file…</p>}
          {err && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

          {c && (
            <>
              <div className="mb-3 text-sm"><span className="text-gray-400">Vendor</span> <span className="font-medium text-gray-900">{c.vendorName ?? 'Unknown vendor'}</span></div>

              {!c.canVerify ? (
                <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  This vendor isn’t linked to CINC, so ACH/W-9 can’t be verified here.
                  <div className="mt-2"><button onClick={() => setOnboard(true)} className="rounded bg-[#16a34a] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#15803d]">+ Onboard this vendor</button></div>
                </div>
              ) : (
                <div className="mb-3 space-y-1.5">
                  <DocRow label="ACH / banking" ok={c.achOnFile} />
                  <DocRow label="W-9" ok={c.w9OnFile} />
                  <DocRow label="COI (insurance)" ok={!!c.coi?.onFile} valid={c.coi?.valid} expiration={c.coi?.expiration} muted />
                  <DocRow label="License" ok={!!c.license?.onFile} valid={c.license?.valid} expiration={c.license?.expiration} muted />
                </div>
              )}

              {blocked && (
                <div className="mb-3 rounded-lg border border-violet-200 bg-violet-50 p-3">
                  <div className="text-sm font-medium text-violet-900">Missing in CINC: {c.missing.join(' + ')}</div>
                  <p className="mt-0.5 text-xs text-violet-800">The invoice can’t be added until the vendor’s {c.missing.join(' & ')} {c.missing.length > 1 ? 'are' : 'is'} on file.</p>
                  {requestedNow || c.requestedAt ? (
                    <div className="mt-2 text-xs font-medium text-emerald-700">
                      ✓ Requested{c.requestedAt && !requestedNow ? ` ${ET(c.requestedAt)}` : ' just now'} — cc’d Paola. This work order is flagged for follow-up; it clears when the docs arrive.
                    </div>
                  ) : c.vendorEmail ? (
                    <button onClick={requestDocs} disabled={requesting}
                      className="mt-2 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                      {requesting ? 'Sending…' : `Email ${c.vendorName ?? 'the vendor'} the request (cc Paola)`}
                    </button>
                  ) : (
                    <div className="mt-2 text-xs text-amber-700">No vendor email on file for this work order — add one before requesting.</div>
                  )}
                </div>
              )}

              {/* Upload — enabled only when docs are on file (or unverifiable). */}
              <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,application/pdf,image/*" className="hidden" onChange={e => void uploadFile(e.target.files)} />
              <div className="mt-2 flex items-center justify-end gap-2">
                <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Close</button>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={blocked || uploading}
                  title={blocked ? 'Upload unlocks once ACH & W-9 are on file' : 'Choose the invoice PDF or photo'}
                  className="rounded-md bg-[#16a34a] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#15803d] disabled:cursor-not-allowed disabled:opacity-40">
                  {uploading ? 'Reading…' : 'Choose invoice file →'}
                </button>
              </div>
              {blocked && <p className="mt-1 text-right text-[11px] text-gray-400">Upload unlocks once ACH &amp; W-9 are on file.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function DocRow({ label, ok, valid, expiration, muted }: { label: string; ok: boolean; valid?: boolean | null; expiration?: string | null; muted?: boolean }) {
  const expired = ok && valid === false
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={muted ? 'text-gray-500' : 'text-gray-700'}>{label}</span>
      {ok
        ? <span className={`text-xs font-medium ${expired ? 'text-amber-700' : 'text-emerald-700'}`}>{expired ? `⚠ expired ${ET(expiration ?? null)}` : '✓ on file'}</span>
        : <span className={`text-xs font-medium ${muted ? 'text-gray-400' : 'text-red-600'}`}>✗ not on file</span>}
    </div>
  )
}
