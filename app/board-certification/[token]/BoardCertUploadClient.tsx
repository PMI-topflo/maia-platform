'use client'

// Board member's login-free self-upload page. Instead of one confusing
// "choose a document type" dropdown, each required document gets its OWN
// labeled box — showing that document's status and expiry — with its own
// upload button. The document set is kind-aware (condo needs the signed
// certification form; HOA does not). A "Why is it expired?" button explains
// the Florida rules in any of the 7 languages.

import { useCallback, useEffect, useState } from 'react'
import BoardCertWhyExpired from '@/components/BoardCertWhyExpired'
import type { CertKind } from '@/lib/board-certification'

interface UploadedDoc { id: string; doc_type: string; certificate_date: string | null; filename: string | null; status: string }
interface Summary { state: 'on_file' | 'expiring' | 'expired' | 'missing'; initialCertExpiration: string | null; continuingEdDue: string | null; continuingEdOverdue: boolean }
interface Ctx { memberName: string | null; role: string | null; associationName: string; kind: CertKind; summary: Summary; uploaded: UploadedDoc[] }

type DocTypeKey = 'education_certificate' | 'certification_form' | 'continuing_education'
interface DocTypeDef { key: DocTypeKey; label: string; blurb: string; kinds: CertKind[] }

const DOC_TYPES: DocTypeDef[] = [
  { key: 'education_certificate', label: 'DBPR board-education certificate', blurb: 'Your Certificate of Completion from the state-approved course', kinds: ['condo', 'hoa'] },
  { key: 'certification_form',    label: 'Signed Board Member Certification Form', blurb: 'Confirms you have read the governing documents', kinds: ['condo'] },
  { key: 'continuing_education',  label: 'Annual continuing-education certificate', blurb: 'One each year to keep your certification current', kinds: ['condo', 'hoa'] },
]
const STATUS_LABEL: Record<string, string> = { pending: 'Received — pending review', approved: 'Approved ✓', rejected: 'Rejected' }

export default function BoardCertUploadClient({ token }: { token: string }) {
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/board-certification/${token}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(setCtx).catch(e => setErr(String(e.message ?? e)))
  }, [token])
  useEffect(load, [load])

  if (err)  return <p style={{ fontSize: 14, color: '#991b1b' }}>{err}</p>
  if (!ctx) return <p style={{ fontSize: 14, color: '#6b7280' }}>Loading…</p>

  const docTypes = DOC_TYPES.filter(d => d.kinds.includes(ctx.kind))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ font: '700 20px system-ui', margin: 0 }}>Board education certificate</h1>
          {ctx.summary.state !== 'on_file' && <BoardCertWhyExpired kind={ctx.kind} />}
        </div>
        <p style={{ font: '400 14px system-ui', color: '#374151', marginTop: 6 }}>
          {ctx.memberName ? `${ctx.memberName} — ` : ''}{ctx.role ? `${ctx.role}, ` : ''}{ctx.associationName}
        </p>
        <p style={{ font: '400 13px system-ui', color: '#6b7280' }}>
          Florida law requires each board member to keep a current board-education certificate on file.
          Upload each document below in its own box.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {docTypes.map(dt => (
          <DocBox key={dt.key} token={token} def={dt} summary={ctx.summary}
            doc={ctx.uploaded.filter(d => d.doc_type === dt.key).sort((a, b) => (a.id < b.id ? 1 : -1))[0] ?? null}
            onDone={load} />
        ))}
      </div>
    </div>
  )
}

/** One labeled upload box for a single document — no dropdown. Shows the
 *  document's own status + expiry date, and a single upload button. */
function DocBox({ token, def, summary, doc, onDone }: { token: string; def: DocTypeDef; summary: Summary; doc: UploadedDoc | null; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg]   = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)
  const expiry = def.key === 'continuing_education'
    ? (summary.continuingEdDue ? { label: summary.continuingEdOverdue ? 'Overdue since' : 'Next due', value: summary.continuingEdDue, warn: summary.continuingEdOverdue } : null)
    : (summary.initialCertExpiration ? { label: 'Valid through', value: summary.initialCertExpiration, warn: summary.initialCertExpiration < today } : null)

  const submit = async () => {
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      const u = await fetch(`/api/board-certification/${token}/upload-url`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: file.name }),
      })
      const uj = await u.json(); if (!u.ok) throw new Error(uj.error || 'upload-url failed')
      const put = await fetch(uj.signedUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } })
      if (!put.ok) throw new Error('upload failed')
      const s = await fetch(`/api/board-certification/${token}/submit`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storage_path: uj.path, filename: file.name, mime_type: file.type, doc_type: def.key }),
      })
      const sj = await s.json(); if (!s.ok) throw new Error(sj.error || 'submit failed')
      setMsg('Received — PMI will review it. Thank you!'); setFile(null); onDone()
    } catch (e) { setMsg(`Could not upload: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  return (
    <div style={{ border: `1px solid ${doc ? '#e5e7eb' : '#fde68a'}`, background: doc ? '#fff' : '#fffbeb', borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ font: '700 14px system-ui', color: '#111827' }}>{def.label}</div>
          <div style={{ font: '400 12px system-ui', color: '#6b7280' }}>{def.blurb}</div>
        </div>
        {expiry && (
          <span style={{ font: '600 12px system-ui', color: expiry.warn ? '#b91c1c' : '#166534', whiteSpace: 'nowrap' }}>{expiry.label} {expiry.value}</span>
        )}
      </div>

      {doc && (
        <div style={{ marginTop: 8, font: '400 13px system-ui', color: '#374151', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span>{doc.filename ?? def.label}{doc.certificate_date ? ` · ${doc.certificate_date}` : ''}</span>
          <span style={{ color: doc.status === 'approved' ? '#166534' : doc.status === 'rejected' ? '#991b1b' : '#92400e' }}>{STATUS_LABEL[doc.status] ?? doc.status}</span>
        </div>
      )}

      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ font: '13px system-ui' }} />
        <button onClick={submit} disabled={!file || busy}
          style={{ font: '600 13px system-ui', background: file && !busy ? '#f26a1b' : '#d1d5db', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: file && !busy ? 'pointer' : 'default' }}>
          {busy ? 'Uploading…' : doc ? 'Upload newer' : 'Upload'}
        </button>
      </div>
      {msg && <p style={{ font: '500 12px system-ui', color: msg.startsWith('Could not') ? '#991b1b' : '#166534', margin: '8px 0 0' }}>{msg}</p>}
    </div>
  )
}
