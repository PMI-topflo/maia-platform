'use client'

import { useCallback, useEffect, useState } from 'react'

interface UploadedDoc { id: string; doc_type: string; filename: string | null; status: string }
interface Ctx { memberName: string | null; role: string | null; associationName: string; uploaded: UploadedDoc[] }

const DOC_TYPES = [
  { key: 'education_certificate', label: 'DBPR board-education certificate (Certificate of Completion)' },
  { key: 'certification_form',    label: 'Signed Board Member Certification Form' },
  { key: 'continuing_education',  label: 'Annual continuing-education certificate' },
]
const STATUS_LABEL: Record<string, string> = { pending: 'Received — pending review', approved: 'Approved ✓', rejected: 'Rejected' }

export default function BoardCertUploadClient({ token }: { token: string }) {
  const [ctx, setCtx]   = useState<Ctx | null>(null)
  const [err, setErr]   = useState<string | null>(null)
  const [docType, setDocType] = useState(DOC_TYPES[0].key)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg]   = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/board-certification/${token}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(setCtx).catch(e => setErr(String(e.message ?? e)))
  }, [token])
  useEffect(load, [load])

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
        body: JSON.stringify({ storage_path: uj.path, filename: file.name, mime_type: file.type, doc_type: docType }),
      })
      const sj = await s.json(); if (!s.ok) throw new Error(sj.error || 'submit failed')
      setMsg('Thank you — your certificate was received. PMI will review it.')
      setFile(null); load()
    } catch (e) { setMsg(`Could not upload: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  if (err)  return <p style={{ fontSize: 14, color: '#991b1b' }}>{err}</p>
  if (!ctx) return <p style={{ fontSize: 14, color: '#6b7280' }}>Loading…</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ font: '700 20px system-ui', margin: 0 }}>Board education certificate</h1>
        <p style={{ font: '400 14px system-ui', color: '#374151', marginTop: 6 }}>
          {ctx.memberName ? `${ctx.memberName} — ` : ''}{ctx.role ? `${ctx.role}, ` : ''}{ctx.associationName}
        </p>
        <p style={{ font: '400 13px system-ui', color: '#6b7280' }}>
          Florida law requires each association board member to keep a current board-education certificate on file.
          Upload yours below. If you have both the DBPR Certificate of Completion and a signed Certification Form,
          upload each one.
        </p>
      </div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ font: '600 13px system-ui', color: '#374151' }}>Document type</label>
        <select value={docType} onChange={e => setDocType(e.target.value)} style={{ font: '14px system-ui', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8 }}>
          {DOC_TYPES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ font: '13px system-ui' }} />
        <button onClick={submit} disabled={!file || busy}
          style={{ font: '600 14px system-ui', background: file && !busy ? '#f26a1b' : '#d1d5db', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', cursor: file && !busy ? 'pointer' : 'default', alignSelf: 'flex-start' }}>
          {busy ? 'Uploading…' : 'Upload certificate'}
        </button>
        {msg && <p style={{ font: '500 13px system-ui', color: msg.startsWith('Could not') ? '#991b1b' : '#166534', margin: 0 }}>{msg}</p>}
      </div>

      {ctx.uploaded.length > 0 && (
        <div>
          <h2 style={{ font: '600 14px system-ui', color: '#374151' }}>Already uploaded</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ctx.uploaded.map(d => (
              <li key={d.id} style={{ font: '400 13px system-ui', color: '#374151', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{d.filename ?? DOC_TYPES.find(t => t.key === d.doc_type)?.label ?? d.doc_type}</span>
                <span style={{ color: d.status === 'approved' ? '#166534' : d.status === 'rejected' ? '#991b1b' : '#92400e' }}>{STATUS_LABEL[d.status] ?? d.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
