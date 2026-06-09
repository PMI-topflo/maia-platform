'use client'

// =====================================================================
// SmartUpload.tsx — a reusable "smart" file upload. Drop it anywhere an
// upload is needed: it stages the file, asks MAIA whether it's the right,
// valid document for `specKey`, and shows a verdict ("✓ Approved as a
// current COI" / "✗ This is a W-9, not a COI — upload a better version").
// On approval it calls onApproved with the staged file + verdict so the
// host page records/moves it. allowOverride lets staff accept anyway.
// =====================================================================

import { useState } from 'react'

interface ValResult {
  verdict: 'approved' | 'wrong_type' | 'unreadable' | 'expired'
  approved: boolean; identified_as: string | null; reason: string
  expiration_date: string | null; confidence: number; model: string
}
export interface SmartUploadResult { storage_path: string; filename: string; mime: string; result: ValResult }

export default function SmartUpload({
  specKey, label, onApproved, allowOverride = true, accept = 'application/pdf,image/*',
}: {
  specKey: string; label: string
  onApproved: (r: SmartUploadResult) => void
  allowOverride?: boolean; accept?: string
}) {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<ValResult | null>(null)
  const [staged, setStaged] = useState<{ storage_path: string; filename: string; mime: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [used, setUsed] = useState(false)

  async function handle(f: File | null) {
    if (!f) return
    setBusy(true); setError(null); setRes(null); setUsed(false)
    try {
      const urlRes = await fetch('/api/admin/documents/inbox/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: f.name }) })
      const urlData = await urlRes.json()
      if (!urlRes.ok) throw new Error(urlData?.error ?? 'upload URL failed')
      const put = await fetch(urlData.signed_url, { method: 'PUT', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f })
      if (!put.ok) throw new Error(`upload failed (${put.status})`)
      const stagedInfo = { storage_path: urlData.storage_path as string, filename: f.name, mime: f.type || 'application/pdf' }
      setStaged(stagedInfo)

      const vRes = await fetch('/api/admin/documents/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storage_path: stagedInfo.storage_path, spec_key: specKey, mime_type: stagedInfo.mime }) })
      const v = await vRes.json()
      if (!vRes.ok) throw new Error(v?.error ?? 'validation failed')
      const result = v as ValResult
      setRes(result)
      if (result.approved) { setUsed(true); onApproved({ ...stagedInfo, result }) }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  function useAnyway() { if (staged && res) { setUsed(true); onApproved({ ...staged, result: res }) } }

  const toneCls = res?.approved ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
  return (
    <div>
      <label className={`inline-flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-sm ${busy ? 'border-gray-200 text-gray-400' : 'border-gray-300 text-gray-700 hover:border-[#f26a1b]'}`}>
        <input type="file" accept={accept} className="hidden" disabled={busy} onChange={e => handle(e.target.files?.[0] ?? null)} />
        {busy ? 'MAIA is checking…' : res ? 'Upload a different file' : `Upload ${label}`}
      </label>

      {error && <div className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">⚠ {error}</div>}

      {res && (
        <div className={`mt-2 rounded-md border px-3 py-2 text-xs ${toneCls}`}>
          <div className="font-semibold">{res.approved ? '✓' : '✗'} {res.reason}</div>
          <div className="mt-0.5 text-[10px] opacity-70">MAIA ({res.model}){res.identified_as ? ` · read as: ${res.identified_as}` : ''}{used ? ' · accepted' : ''}</div>
          {!res.approved && !used && (
            <div className="mt-2 flex items-center gap-3">
              <span className="text-[11px]">Upload a better version above{allowOverride ? ', or' : '.'}</span>
              {allowOverride && <button onClick={useAnyway} className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50">Use it anyway</button>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
