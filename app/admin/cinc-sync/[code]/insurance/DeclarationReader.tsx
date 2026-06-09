'use client'

// =====================================================================
// DeclarationReader.tsx — "MAIA reads the declaration". Upload one master
// insurance dec page → MAIA splits it into per-coverage rows → staff
// reviews/edits → Apply writes one policy per coverage (all linked to the
// same source document). Lives at the top of the Insurance manager.
// =====================================================================

import { useState } from 'react'

interface Coverage {
  policy_type: string; label: string; carrier: string | null; policy_number: string | null
  named_insured: string | null; effective_date: string | null; expiration_date: string | null
  coverage_amount_usd: number | null; confidence: number
}
interface Row extends Coverage { include: boolean }
interface Source { storage_path: string; filename: string; mime: string }

const confBadge = (c: number) =>
  c >= 0.8 ? 'bg-emerald-100 text-emerald-800' : c >= 0.5 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(inc|llc|association|condominium|condo|the|of|a)\b/g, '').replace(/\s+/g, ' ').trim()

export default function DeclarationReader({ assocCode, assocName, onApplied }: { assocCode: string; assocName?: string; onApplied: () => void }) {
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState<null | 'reading' | 'applying'>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function handleFile(f: File | null) {
    if (!f) return
    setBusy('reading'); setError(null); setWarn(null); setRows(null); setDone(null)
    try {
      // 1) upload the declaration to storage (under .../insurance/other/)
      const urlRes = await fetch(`/api/admin/associations/${assocCode}/insurance/upload-url`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: f.name, policy_type: 'other' }),
      })
      const urlData = await urlRes.json()
      if (!urlRes.ok) throw new Error(urlData?.error ?? 'could not get upload URL')
      const put = await fetch(urlData.signed_url, { method: 'PUT', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f })
      if (!put.ok) throw new Error(`upload failed (${put.status})`)
      const src: Source = { storage_path: urlData.storage_path, filename: f.name, mime: f.type || 'application/pdf' }
      setSource(src)

      // 2) ask MAIA to split it into coverages
      const exRes = await fetch(`/api/admin/associations/${assocCode}/insurance/extract`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storage_path: src.storage_path, mime_type: src.mime }),
      })
      const ex = await exRes.json()
      if (!exRes.ok) throw new Error(ex?.error ?? 'extraction failed')
      setNote(ex.note ?? null); setModel(ex.model ?? null)
      const kind = ex.document_kind as string | undefined
      const seen = (ex.association_name as string | null) ?? null

      // Guard: this screen is for the ASSOCIATION's master policy only.
      if (kind === 'unit_owner') {
        setError(`This is a unit-owner HO-6 policy${seen ? ` (named insured: ${seen})` : ''} — not the association's master insurance. It belongs to the unit owner, so it wasn't filed here. File HO-6 / unit policies under the owner's unit instead.`)
        setBusy(null); return
      }
      if (kind === 'other') {
        setError(`MAIA didn't recognize this as an association master insurance policy${seen ? ` (it read "${seen}")` : ''}. Nothing was filed — add coverages manually below if needed.`)
        setBusy(null); return
      }
      // Soft check: does the named insured look like THIS association?
      if (seen && assocName && norm(seen) && norm(assocName) && !norm(seen).includes(norm(assocName)) && !norm(assocName).includes(norm(seen))) {
        setWarn(`Heads up — MAIA read the named insured as "${seen}", which doesn't match ${assocName}. Make sure this declaration is for the right association before applying.`)
      }

      const coverages = (ex.coverages ?? []) as Coverage[]
      if (coverages.length === 0) { setError('MAIA did not find any coverages on this document. Add them manually below.'); setBusy(null); return }
      setRows(coverages.map(c => ({ ...c, include: true })))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  function patch(i: number, p: Partial<Row>) { setRows(rs => rs?.map((r, j) => j === i ? { ...r, ...p } : r) ?? rs) }

  async function apply() {
    if (!rows || !source) return
    const chosen = rows.filter(r => r.include)
    if (chosen.length === 0) { setError('Select at least one coverage to apply.'); return }
    setBusy('applying'); setError(null)
    try {
      for (const r of chosen) {
        const res = await fetch(`/api/admin/associations/${assocCode}/insurance`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            policy_type: r.policy_type, carrier: r.carrier, policy_number: r.policy_number,
            named_insured: r.named_insured, effective_date: r.effective_date, expiration_date: r.expiration_date,
            coverage_amount_usd: r.coverage_amount_usd,
            coi_storage_path: source.storage_path, coi_filename: source.filename, coi_mime_type: source.mime,
          }),
        })
        if (!res.ok) throw new Error((await res.json())?.error ?? `failed on ${r.label}`)
      }
      setDone(`Applied ${chosen.length} coverage${chosen.length === 1 ? '' : 's'} from the declaration.`)
      setRows(null); setSource(null); onApplied()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  return (
    <div className="rounded-lg border border-[#f26a1b]/30 bg-[#fff8f4]">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">📄 Upload insurance — MAIA files each coverage <span className="rounded bg-[#f26a1b]/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-[#c2410c]">MAIA</span></span>
        <span className="text-gray-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="border-t border-[#f26a1b]/20 px-4 py-3">
          <p className="mb-3 text-xs text-gray-600">Upload one master declaration — MAIA finds every coverage on it (Property, GL, D&O, Flood, Wind…) and pre-fills each row. You review before anything saves.</p>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-[#f26a1b]">
            <input type="file" accept="application/pdf,image/*" className="hidden" disabled={busy !== null} onChange={e => handleFile(e.target.files?.[0] ?? null)} />
            {busy === 'reading' ? 'MAIA is reading…' : 'Choose declaration (PDF or image)'}
          </label>

          {done && <div className="mt-3 rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{done}</div>}
          {error && <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">⚠ {error}</div>}
          {warn && <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">⚠ {warn}</div>}
          {note && rows && <div className="mt-3 text-[11px] text-gray-500">MAIA ({model}): {note}</div>}

          {rows && (
            <div className="mt-3 space-y-2">
              {rows.map((r, i) => (
                <div key={r.policy_type} className={`rounded border p-2.5 ${r.include ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
                      <input type="checkbox" checked={r.include} onChange={e => patch(i, { include: e.target.checked })} />
                      {r.label}
                    </label>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${confBadge(r.confidence)}`}>{Math.round(r.confidence * 100)}% sure</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Fld label="Carrier" v={r.carrier ?? ''} on={v => patch(i, { carrier: v || null })} />
                    <Fld label="Policy #" v={r.policy_number ?? ''} on={v => patch(i, { policy_number: v || null })} />
                    <Fld label="Effective" type="date" v={r.effective_date ?? ''} on={v => patch(i, { effective_date: v || null })} />
                    <Fld label="Expiration" type="date" v={r.expiration_date ?? ''} on={v => patch(i, { expiration_date: v || null })} />
                    <Fld label="Named insured" v={r.named_insured ?? ''} on={v => patch(i, { named_insured: v || null })} />
                    <Fld label="Limit ($)" v={r.coverage_amount_usd?.toString() ?? ''} on={v => patch(i, { coverage_amount_usd: v ? Number(v.replace(/[$,\s]/g, '')) : null })} />
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-end gap-3 pt-1">
                <span className="text-[11px] text-gray-500">{rows.filter(r => r.include).length} of {rows.length} selected</span>
                <button onClick={apply} disabled={busy !== null} className="rounded bg-[#f26a1b] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d85a14] disabled:opacity-50">{busy === 'applying' ? 'Applying…' : 'Apply selected coverages'}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Fld({ label, v, on, type }: { label: string; v: string; on: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[9px] uppercase tracking-wide text-gray-400">{label}</span>
      <input type={type ?? 'text'} value={v} onChange={e => on(e.target.value)} className="w-full rounded border border-gray-300 px-1.5 py-1 text-[11px]" />
    </label>
  )
}
