'use client'

// Board officers box on the Association Hub, now with Florida DBPR board-
// education tracking: each member shows whether their certificate is on
// file / expiring / expired / missing, staff can upload a certificate or
// email the member a self-upload link, and uploaded documents preview
// inline. Fetches /api/admin/board-members/certification?code=.

import { useCallback, useEffect, useState } from 'react'
import { DocumentPreviewTrigger } from '@/components/DocumentPreviewTrigger'

interface CertDoc { id: string; doc_type: string; certificate_date: string | null; status: string; filename: string | null; created_at: string }
interface CertSummary {
  state: 'on_file' | 'expiring' | 'expired' | 'missing'
  validityYears: number
  initialCertDate: string | null
  initialCertExpiration: string | null
  continuingEdDue: string | null
  hasCertificationForm: boolean
}
interface Member { id: string; name: string | null; email: string | null; role: string | null; docs: CertDoc[]; summary: CertSummary }
interface Overview { members: Member[]; kind: 'condo' | 'hoa'; expiredCount: number; expiringCount: number; missingCount: number }

const DOC_TYPES = [
  { key: 'education_certificate', label: 'Education certificate' },
  { key: 'certification_form',    label: 'Certification form' },
  { key: 'continuing_education',  label: 'Continuing ed' },
]
const STATE_STYLE: Record<CertSummary['state'], { label: string; color: string; bg: string }> = {
  on_file:  { label: '✓ On file',  color: '#166534', bg: '#dcfce7' },
  expiring: { label: '⚠ Expiring', color: '#92400e', bg: '#ffedd5' },
  expired:  { label: '⛔ Expired',  color: '#991b1b', bg: '#fee2e2' },
  missing:  { label: '— Missing',  color: '#6b7280', bg: '#f3f4f6' },
}

export default function BoardCertBox({ code }: { code: string }) {
  const [data, setData] = useState<Overview | null>(null)
  const [err, setErr]   = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [openUpload, setOpenUpload] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/admin/board-members/certification?code=${encodeURIComponent(code)}`, { credentials: 'include' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(setData).catch(e => setErr(String(e.message ?? e)))
  }, [code])
  useEffect(load, [load])

  const requestAll = async () => {
    if (!confirm('Email every board member (missing / expiring) a link to upload their certificate?')) return
    setBusy('all')
    try {
      const r = await fetch('/api/admin/board-members/certification/request', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      alert(`Emailed ${j.sentCount} board member${j.sentCount === 1 ? '' : 's'}.`)
    } catch (e) { alert(`Could not send: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  const requestOne = async (m: Member) => {
    setBusy(m.id)
    try {
      const r = await fetch('/api/admin/board-members/certification/request', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, memberId: m.id }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      alert(`Emailed ${m.email}.`)
    } catch (e) { alert(`Could not send: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  const del = async (docId: string) => {
    if (!confirm('Remove this certificate?')) return
    setBusy(docId)
    try {
      const r = await fetch(`/api/admin/board-members/certification/${docId}`, { method: 'DELETE', credentials: 'include' })
      if (!r.ok) throw new Error((await r.json()).error || 'failed')
      load()
    } catch (e) { alert(`Could not remove: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  const approve = async (docId: string, docType: string, date: string) => {
    setBusy(docId)
    try {
      const r = await fetch(`/api/admin/board-members/certification/${docId}`, {
        method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approve', doc_type: docType, certificate_date: date || null }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'failed')
      load()
    } catch (e) { alert(`Could not approve: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  if (err) return <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 }}><h3 style={{ font: '700 15px system-ui', margin: 0 }}>Board officers</h3><p style={{ font: '12px system-ui', color: '#991b1b' }}>{err}</p></div>

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h3 style={{ font: '700 15px system-ui', margin: 0 }}>Board officers</h3>
        {data && data.members.length > 0 && (
          <button onClick={requestAll} disabled={busy === 'all'} style={linkBtn}>{busy === 'all' ? 'Sending…' : 'Request from all →'}</button>
        )}
      </div>

      {!data ? <p style={{ font: '12px system-ui', color: '#9ca3af', marginTop: 8 }}>Loading…</p>
        : data.members.length === 0 ? <p style={{ font: '12px system-ui', color: '#9ca3af', marginTop: 8 }}>No board members on file. Import them in the Board &amp; Owners tab.</p>
        : (
        <>
          <p style={{ font: '11px system-ui', color: '#6b7280', margin: '6px 0 10px' }}>
            Board-education certificates · {data.kind === 'hoa' ? 'HOA — valid 4 yrs' : 'Condo — valid 7 yrs'}
            {(data.expiredCount + data.missingCount) > 0 && <span style={{ color: '#991b1b' }}> · {data.expiredCount + data.missingCount} need attention</span>}
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.members.map(m => {
              const st = STATE_STYLE[m.summary.state]
              return (
                <li key={m.id} style={{ borderTop: '1px solid #f3f4f6', paddingTop: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <div style={{ font: '600 13px system-ui', color: '#111827' }}>{m.name ?? '—'}</div>
                    <span style={{ font: '700 10px system-ui', color: st.color, background: st.bg, borderRadius: 6, padding: '2px 6px' }}>{st.label}</span>
                  </div>
                  <div style={{ font: '11px system-ui', color: '#6b7280' }}>{[m.role, m.email].filter(Boolean).join(' · ') || '—'}</div>
                  {m.summary.initialCertExpiration && (
                    <div style={{ font: '11px system-ui', color: '#6b7280', marginTop: 2 }}>
                      Cert {m.summary.initialCertDate} → expires <b>{m.summary.initialCertExpiration}</b>
                      {m.summary.continuingEdDue && ` · CE due ${m.summary.continuingEdDue}`}
                    </div>
                  )}

                  {m.docs.map(d => (
                    <div key={d.id} style={{ marginTop: 6, background: '#f9fafb', borderRadius: 6, padding: '6px 8px', font: '11px system-ui' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                        <DocumentPreviewTrigger
                          label={`👁 ${DOC_TYPES.find(t => t.key === d.doc_type)?.label ?? d.doc_type}${d.certificate_date ? ` · ${d.certificate_date}` : ''}`}
                          previewUrl={`/api/admin/board-members/certification/${d.id}/preview`}
                          style={{ font: '600 11px system-ui', color: '#2563eb', background: 'none', border: 'none', padding: 0, textAlign: 'left' }}
                        />
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: d.status === 'approved' ? '#166534' : d.status === 'rejected' ? '#991b1b' : '#92400e' }}>{d.status}</span>
                          <button onClick={() => del(d.id)} disabled={busy === d.id} style={{ ...linkBtn, color: '#991b1b' }}>remove</button>
                        </div>
                      </div>
                      {d.status === 'pending' && <ApproveRow doc={d} busy={busy === d.id} onApprove={approve} />}
                    </div>
                  ))}

                  <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                    <button onClick={() => setOpenUpload(openUpload === m.id ? null : m.id)} style={linkBtn}>{openUpload === m.id ? 'Cancel' : '+ Upload certificate'}</button>
                    {m.email && <button onClick={() => requestOne(m)} disabled={busy === m.id} style={linkBtn}>{busy === m.id ? 'Sending…' : 'Email member →'}</button>}
                  </div>
                  {openUpload === m.id && <UploadRow code={code} memberId={m.id} onDone={() => { setOpenUpload(null); load() }} />}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

function ApproveRow({ doc, busy, onApprove }: { doc: CertDoc; busy: boolean; onApprove: (id: string, docType: string, date: string) => void }) {
  const [docType, setDocType] = useState(doc.doc_type)
  const [date, setDate] = useState(doc.certificate_date ?? '')
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={docType} onChange={e => setDocType(e.target.value)} style={miniInput}>
        {DOC_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={miniInput} title="Certificate date" />
      <button onClick={() => onApprove(doc.id, docType, date)} disabled={busy} style={{ ...linkBtn, color: '#166534' }}>{busy ? '…' : 'Approve'}</button>
    </div>
  )
}

function UploadRow({ code, memberId, onDone }: { code: string; memberId: string; onDone: () => void }) {
  const [docType, setDocType] = useState(DOC_TYPES[0].key)
  const [date, setDate] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg]   = useState<string | null>(null)

  const submit = async () => {
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      const u = await fetch('/api/admin/board-members/certification/upload-url', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, memberId, filename: file.name }),
      })
      const uj = await u.json(); if (!u.ok) throw new Error(uj.error || 'upload-url failed')
      const put = await fetch(uj.signedUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } })
      if (!put.ok) throw new Error('upload failed')
      const s = await fetch('/api/admin/board-members/certification', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, memberId, storage_path: uj.path, filename: file.name, mime_type: file.type, doc_type: docType, certificate_date: date || null }),
      })
      if (!s.ok) throw new Error((await s.json()).error || 'submit failed')
      onDone()
    } catch (e) { setMsg(`Could not upload: ${(e as Error).message}`); setBusy(false) }
  }

  return (
    <div style={{ marginTop: 8, background: '#f9fafb', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select value={docType} onChange={e => setDocType(e.target.value)} style={miniInput}>
        {DOC_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={miniInput} title="Certificate date" />
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ font: '11px system-ui' }} />
      <button onClick={submit} disabled={!file || busy} style={{ font: '600 12px system-ui', background: file && !busy ? '#f26a1b' : '#d1d5db', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: file && !busy ? 'pointer' : 'default', alignSelf: 'flex-start' }}>
        {busy ? 'Uploading…' : 'Save'}
      </button>
      {msg && <p style={{ font: '11px system-ui', color: '#991b1b', margin: 0 }}>{msg}</p>}
    </div>
  )
}

const linkBtn: React.CSSProperties = { font: '600 11px system-ui', color: '#2563eb', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }
const miniInput: React.CSSProperties = { font: '11px system-ui', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 6 }
