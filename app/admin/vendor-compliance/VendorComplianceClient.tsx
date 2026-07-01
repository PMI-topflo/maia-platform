'use client'

import { useEffect, useState } from 'react'

interface Compliance {
  ach:     { onFile: boolean }
  w9:      { onFile: boolean }
  coi:     { onFile: boolean; expiration: string | null; valid: boolean | null; carrier: string | null }
  license: { onFile: boolean; expiration: string | null; valid: boolean | null }
}
interface CoiVerdict {
  status: 'valid' | 'invalid' | 'expiring' | 'unverifiable'
  expiresInDays: number | null; pmiListed: boolean; associationListed: boolean; issues: string[]
}
export interface Row {
  key: string; vendorId: number | null; vendorName: string; vendorEmail: string | null
  assocCode: string | null; ticketIds: number[]; ticketNumbers: string[]; repTicketId: number
  compliance: Compliance | null; linked: boolean; needKeys: ('ach' | 'w9')[]; missing: string[]
  coiVerdict: CoiVerdict | null
}
interface VFile { id: string; ticketId: number; filename: string; url: string | null; isImage: boolean; isPdf: boolean; docType: string | null }

type ChipState = 'ok' | 'warn' | 'bad' | 'na'
const CHIP: Record<ChipState, string> = {
  ok:   'bg-green-50 text-green-700 border-green-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  bad:  'bg-red-50 text-red-700 border-red-200',
  na:   'bg-gray-100 text-gray-500 border-gray-200',
}
function Chip({ label, state, title }: { label: string; state: ChipState; title?: string }) {
  return <span title={title} className={`text-[11px] font-medium px-2 py-0.5 rounded border ${CHIP[state]}`}>{label}</span>
}

// The additional-insured verdict (from our stored COI), distinct from the CINC
// "COI on file / expiry" chip above. Only shown when we have a verdict.
function coiVerdictChip(v: CoiVerdict | null): { label: string; state: ChipState; title?: string } | null {
  if (!v) return null
  if (v.status === 'valid')    return { label: 'Add’l insured ✓', state: 'ok',   title: 'PMI + association listed as additional insured' }
  if (v.status === 'expiring') return { label: 'COI expiring',    state: 'warn', title: v.expiresInDays != null ? `${v.expiresInDays} day(s) left` : undefined }
  if (v.status === 'invalid')  return { label: 'Add’l insured ✗', state: 'bad',  title: v.issues.join(' · ') }
  return { label: 'COI unverified', state: 'na', title: 'Re-upload the COI to validate additional insured' }
}

function complianceChips(c: Compliance) {
  const out: { label: string; state: ChipState; title?: string }[] = []
  out.push({ label: c.ach.onFile ? 'ACH ✓' : 'ACH ✗', state: c.ach.onFile ? 'ok' : 'bad' })
  out.push({ label: c.w9.onFile ? 'W-9 ✓' : 'W-9 ✗', state: c.w9.onFile ? 'ok' : 'bad' })
  if (!c.coi.onFile) out.push({ label: 'COI ✗', state: 'bad' })
  else if (c.coi.valid === false) out.push({ label: 'COI expired', state: 'warn', title: c.coi.expiration ?? undefined })
  else out.push({ label: 'COI ✓', state: 'ok', title: [c.coi.carrier, c.coi.expiration].filter(Boolean).join(' · ') || undefined })
  if (!c.license.onFile) out.push({ label: 'License ✗', state: 'bad' })
  else if (c.license.valid === false) out.push({ label: 'License expired', state: 'warn', title: c.license.expiration ?? undefined })
  else out.push({ label: 'License ✓', state: 'ok', title: c.license.expiration ?? undefined })
  return out
}

export default function VendorComplianceClient({ rows }: { rows: Row[] }) {
  const [filesFor, setFilesFor] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, VFile[] | 'loading'>>({})
  const [modal, setModal] = useState<{ row: Row; mode: 'missing' | 'coi' } | null>(null)

  const withGaps = rows.filter(r => r.missing.length > 0 || !r.linked).length

  async function toggleFiles(r: Row) {
    if (filesFor === r.key) { setFilesFor(null); return }
    setFilesFor(r.key)
    if (!files[r.key]) {
      setFiles(f => ({ ...f, [r.key]: 'loading' }))
      try {
        const res = await fetch(`/api/admin/vendor-compliance/files?tickets=${r.ticketIds.join(',')}`)
        const j = await res.json()
        setFiles(f => ({ ...f, [r.key]: (j.files ?? []) as VFile[] }))
      } catch { setFiles(f => ({ ...f, [r.key]: [] })) }
    }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-lg font-semibold text-gray-900">Vendor Compliance</h1>
        <div className="text-sm text-gray-500">{rows.length} vendor{rows.length === 1 ? '' : 's'} on active work orders · <span className={withGaps ? 'text-red-600 font-medium' : ''}>{withGaps} need attention</span></div>
      </div>

      {rows.length === 0 && <div className="text-sm text-gray-500 bg-white border border-gray-200 rounded-lg p-6 text-center">No vendors on active work orders right now.</div>}

      <div className="space-y-2.5">
        {rows.map(r => {
          const expanded = filesFor === r.key
          const vf = files[r.key]
          return (
            <div key={r.key} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900">{r.vendorName}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {r.assocCode ? `${r.assocCode} · ` : ''}{r.ticketNumbers.length} active WO{r.ticketNumbers.length === 1 ? '' : 's'}
                    {r.ticketNumbers.length > 0 && <span className="text-gray-400"> · {r.ticketNumbers.slice(0, 4).join(', ')}{r.ticketNumbers.length > 4 ? '…' : ''}</span>}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{r.vendorEmail ?? 'no email on file'}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 justify-end">
                  {r.linked && r.compliance
                    ? complianceChips(r.compliance).map((c, i) => <Chip key={i} {...c} />)
                    : <Chip label="Not linked to CINC" state="na" title="Assign the vendor on the work order to check compliance" />}
                  {(() => { const cv = coiVerdictChip(r.coiVerdict); return cv ? <Chip {...cv} /> : null })()}
                </div>
              </div>

              {r.missing.length > 0 && (
                <div className="mt-2 text-xs text-red-600">Missing: {r.missing.join(' · ')}</div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={() => toggleFiles(r)} className="text-xs font-medium px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50">
                  {expanded ? 'Hide files' : 'Files'}
                </button>
                {r.missing.length > 0 && (
                  <button onClick={() => setModal({ row: r, mode: 'missing' })} className="text-xs font-semibold px-3 py-1.5 rounded bg-[#f26a1b] text-white hover:bg-[#d95c12]">
                    Request missing docs →
                  </button>
                )}
                {r.coiVerdict?.status === 'invalid' && (
                  <button onClick={() => setModal({ row: r, mode: 'coi' })} className="text-xs font-semibold px-3 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-50">
                    Draft COI correction →
                  </button>
                )}
              </div>

              {expanded && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  {vf === 'loading' && <div className="text-xs text-gray-400">Loading files…</div>}
                  {Array.isArray(vf) && vf.length === 0 && <div className="text-xs text-gray-400">No files on these work orders.</div>}
                  {Array.isArray(vf) && vf.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {vf.map(f => (
                        <a key={f.id} href={f.url ?? '#'} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded border border-gray-200 hover:bg-gray-50 min-w-0">
                          <span className="text-gray-400">{f.isImage ? '🖼️' : f.isPdf ? '📄' : '📎'}</span>
                          <span className="truncate text-gray-700">{f.filename}</span>
                          {f.docType && <span className="ml-auto shrink-0 text-[10px] text-gray-400 uppercase">{f.docType}</span>}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {modal && <RequestModal row={modal.row} mode={modal.mode} onClose={() => setModal(null)} />}
    </div>
  )
}

function RequestModal({ row, mode, onClose }: { row: Row; mode: 'missing' | 'coi'; onClose: () => void }) {
  const isCoi = mode === 'coi'
  const [loading, setLoading] = useState(true)
  const [to, setTo] = useState(row.vendorEmail ?? '')
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load MAIA's draft once.
  useEffect(() => {
    let alive = true
    fetch('/api/admin/vendor-compliance/request', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(isCoi
        ? { action: 'preview', mode: 'coi', repTicketId: row.repTicketId, vendorName: row.vendorName, assocCode: row.assocCode, coiIssues: row.coiVerdict?.issues ?? [] }
        : { action: 'preview', repTicketId: row.repTicketId, vendorName: row.vendorName, needKeys: row.needKeys, missing: row.missing }),
    }).then(r => r.json()).then(j => {
      if (!alive) return
      if (j.error) setError(j.error)
      else { setSubject(j.subject ?? ''); setBodyText(j.body ?? '') }
    }).catch(() => { if (alive) setError('Could not build the draft.') }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [row, isCoi])

  async function send() {
    setError(null)
    if (!to.includes('@')) { setError('Enter a valid vendor email.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/vendor-compliance/request', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'send', ...(isCoi && { mode: 'coi' }), repTicketId: row.repTicketId, to, subject, body: bodyText }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'failed')
      setSent(true)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">{isCoi ? 'COI correction' : 'Request documents'} — {row.vendorName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        {sent ? (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-4">
            ✓ Sent to {to}.{isCoi ? ' Replies go to service@ and Paola is copied.' : ''} It’s logged on the work order.
            <div className="mt-3 text-right"><button onClick={onClose} className="text-xs font-semibold px-3 py-1.5 rounded bg-gray-900 text-white">Done</button></div>
          </div>
        ) : loading ? (
          <div className="text-sm text-gray-400 py-8 text-center">Building MAIA’s draft…</div>
        ) : (
          <>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">To</label>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="vendor@email.com"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded mb-3" />
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded mb-3" />
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Message <span className="text-gray-400 normal-case font-normal">— MAIA drafted this; edit or add anything before sending</span></label>
            <textarea value={bodyText} onChange={e => setBodyText(e.target.value)} rows={12}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded font-mono resize-y" />
            {error && <div className="text-sm text-red-600 mt-2">⚠ {error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={onClose} className="text-sm px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={send} disabled={busy} className="text-sm font-semibold px-4 py-2 rounded bg-[#f26a1b] text-white hover:bg-[#d95c12] disabled:opacity-60">{busy ? 'Sending…' : isCoi ? 'Send to vendor' : 'Send request'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
