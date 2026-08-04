'use client'

// Board officers box on the Association Hub, with Florida DBPR board-education
// tracking. Each member shows a status badge (on file / CE overdue / expired /
// missing) and — instead of one confusing "pick a type" dropdown — a SEPARATE
// labeled upload box per required document, each showing that document's own
// status + expiry. The document set is kind-aware: condominiums (Ch. 718) need
// the education certificate, the signed certification form, and annual
// continuing ed; HOAs (Ch. 720) need the education certificate + continuing ed
// (no separate written certification form). A "Why is it expired?" button opens
// the rules in any of the 7 languages.

import { useCallback, useEffect, useState } from 'react'
import { DocumentPreviewTrigger } from '@/components/DocumentPreviewTrigger'
import BoardCertWhyExpired from '@/components/BoardCertWhyExpired'
import SignatureSetter from '@/components/SignatureSetter'
import type { CertKind } from '@/lib/board-certification'

interface CertDoc { id: string; doc_type: string; certificate_date: string | null; status: string; filename: string | null; created_at: string }
interface CertSummary {
  state: 'on_file' | 'expiring' | 'expired' | 'missing'
  validityYears: number
  initialCertDate: string | null
  initialCertExpiration: string | null
  continuingEdDue: string | null
  hasCertificationForm: boolean
  continuingEdOverdue: boolean
}
interface Member { id: string; name: string | null; email: string | null; role: string | null; docs: CertDoc[]; summary: CertSummary }
interface Overview { members: Member[]; kind: CertKind; expiredCount: number; expiringCount: number; missingCount: number }

type DocTypeKey = 'education_certificate' | 'certification_form' | 'continuing_education'
interface DocTypeDef { key: DocTypeKey; label: string; blurb: string; kinds: CertKind[] }

// The documents the DBPR rules describe. `certification_form` is condo-only —
// "No separate statutory written-certification form is currently required" for
// HOAs.
const DOC_TYPES: DocTypeDef[] = [
  { key: 'education_certificate', label: 'Education certificate', blurb: 'DBPR Certificate of Completion', kinds: ['condo', 'hoa'] },
  { key: 'certification_form',    label: 'Certification form',    blurb: 'Signed board-member certification', kinds: ['condo'] },
  { key: 'continuing_education',  label: 'Continuing education',   blurb: 'Annual continuing-ed certificate', kinds: ['condo', 'hoa'] },
]
const docTypesFor = (kind: CertKind) => DOC_TYPES.filter(d => d.kinds.includes(kind))

const STATE_STYLE: Record<CertSummary['state'], { label: string; color: string; bg: string }> = {
  on_file:  { label: '✓ On file',  color: '#166534', bg: '#dcfce7' },
  expiring: { label: '⚠ Expiring', color: '#92400e', bg: '#ffedd5' },
  expired:  { label: '⛔ Expired',  color: '#991b1b', bg: '#fee2e2' },
  missing:  { label: '— Missing',  color: '#6b7280', bg: '#f3f4f6' },
}

// When the flag is only a lapsed annual CE (the multi-year cert is still valid),
// say "CE overdue" — "Expiring" reads as "coming up soon". Mirrors /units (#572).
function badgeFor(s: CertSummary): { label: string; color: string; bg: string } {
  const cutoff60 = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)
  const certFarOff = !!(s.initialCertExpiration && s.initialCertExpiration > cutoff60)
  if (s.state === 'expiring' && s.continuingEdOverdue && certFarOff) {
    return { label: '⚠ CE overdue', color: '#92400e', bg: '#ffedd5' }
  }
  return STATE_STYLE[s.state]
}

export default function BoardCertBox({ code }: { code: string }) {
  const [data, setData] = useState<Overview | null>(null)
  const [err, setErr]   = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [sigByEmail, setSigByEmail] = useState<Record<string, boolean>>({})

  const loadSignatures = useCallback(() => {
    fetch(`/api/admin/board-members/signature?code=${encodeURIComponent(code)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { members: [] })
      .then(j => setSigByEmail(Object.fromEntries((j.members ?? []).map((m: { email: string; hasSignature: boolean }) => [String(m.email).toLowerCase(), m.hasSignature]))))
      .catch(() => {})
  }, [code])
  useEffect(loadSignatures, [loadSignatures])

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
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {data.members.map(m => {
              const st = badgeFor(m.summary)
              return (
                <li key={m.id} style={{ borderTop: '1px solid #f3f4f6', paddingTop: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ font: '600 13px system-ui', color: '#111827' }}>{m.name ?? '—'}</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {m.summary.state !== 'on_file' && <BoardCertWhyExpired kind={data.kind} />}
                      <span style={{ font: '700 10px system-ui', color: st.color, background: st.bg, borderRadius: 6, padding: '2px 6px' }}>{st.label}</span>
                    </div>
                  </div>
                  <div style={{ font: '11px system-ui', color: '#6b7280' }}>{[m.role, m.email].filter(Boolean).join(' · ') || '—'}</div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    {docTypesFor(data.kind).map(dt => (
                      <DocBox key={dt.key} def={dt} member={m} code={code} busy={busy} onApprove={approve} onDelete={del} onUploaded={load} />
                    ))}
                  </div>

                  <div style={{ marginTop: 8, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                    {m.email && <button onClick={() => requestOne(m)} disabled={busy === m.id} style={linkBtn}>{busy === m.id ? 'Sending…' : '✉ Email member their upload link →'}</button>}
                    {m.email && <SignatureSetter code={code} email={m.email} name={m.name} hasSignature={!!sigByEmail[m.email.toLowerCase()]} onSaved={loadSignatures} />}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

/** One labeled upload box for a single document type of one member: shows the
 *  latest doc of that type + its status/expiry, or an upload control when none
 *  is on file. No dropdown — the type is fixed by the box. */
function DocBox({ def, member, code, busy, onApprove, onDelete, onUploaded }: {
  def: DocTypeDef; member: Member; code: string; busy: string | null
  onApprove: (id: string, docType: string, date: string) => void
  onDelete: (id: string) => void
  onUploaded: () => void
}) {
  const doc = member.docs
    .filter(d => d.doc_type === def.key)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null
  const s = member.summary
  // Which date matters for this document.
  const expiry = def.key === 'continuing_education'
    ? (s.continuingEdDue ? { label: s.continuingEdOverdue ? 'CE overdue since' : 'Next CE due', value: s.continuingEdDue, warn: s.continuingEdOverdue } : null)
    : (s.initialCertExpiration ? { label: 'Valid through', value: s.initialCertExpiration, warn: s.initialCertExpiration < new Date().toISOString().slice(0, 10) } : null)

  return (
    <div style={{ border: `1px solid ${doc ? '#e5e7eb' : '#fde68a'}`, background: doc ? '#f9fafb' : '#fffbeb', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div>
          <div style={{ font: '700 12px system-ui', color: '#111827' }}>{def.label}</div>
          <div style={{ font: '400 10px system-ui', color: '#9ca3af' }}>{def.blurb}</div>
        </div>
        {expiry && (
          <span style={{ font: '600 11px system-ui', color: expiry.warn ? '#b91c1c' : '#166534', whiteSpace: 'nowrap' }}>
            {expiry.label} {expiry.value}
          </span>
        )}
      </div>

      {doc ? (
        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <DocumentPreviewTrigger
            label={`👁 ${doc.filename ?? def.label}${doc.certificate_date ? ` · ${doc.certificate_date}` : ''}`}
            previewUrl={`/api/admin/board-members/certification/${doc.id}/preview`}
            style={{ font: '600 11px system-ui', color: '#2563eb', background: 'none', border: 'none', padding: 0, textAlign: 'left' }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ font: '600 11px system-ui', color: doc.status === 'approved' ? '#166534' : doc.status === 'rejected' ? '#991b1b' : '#92400e' }}>{doc.status}</span>
            <button onClick={() => onDelete(doc.id)} disabled={busy === doc.id} style={{ ...linkBtn, color: '#991b1b' }}>remove</button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 4, font: '400 11px system-ui', color: '#92400e' }}>Not on file</div>
      )}

      {doc && doc.status === 'pending' && <ApproveRow doc={doc} busy={busy === doc.id} onApprove={onApprove} />}

      <UploadControl code={code} memberId={member.id} docType={def.key} label={doc ? 'Replace / add newer' : `Upload ${def.label.toLowerCase()}`} onDone={onUploaded} />
    </div>
  )
}

function ApproveRow({ doc, busy, onApprove }: { doc: CertDoc; busy: boolean; onApprove: (id: string, docType: string, date: string) => void }) {
  const [date, setDate] = useState(doc.certificate_date ?? '')
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={miniInput} title="Certificate date" />
      <button onClick={() => onApprove(doc.id, doc.doc_type, date)} disabled={busy} style={{ ...linkBtn, color: '#166534' }}>{busy ? '…' : 'Approve'}</button>
    </div>
  )
}

/** Inline upload for a FIXED document type (no dropdown). */
function UploadControl({ code, memberId, docType, label, onDone }: { code: string; memberId: string; docType: DocTypeKey; label: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [date, setDate] = useState('')
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
      setFile(null); setDate(''); onDone()
    } catch (e) { setMsg(`Could not upload: ${(e as Error).message}`); setBusy(false) }
  }

  return (
    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ font: '11px system-ui', maxWidth: 200 }} />
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={miniInput} title="Completion date — optional, MAIA reads it from the certificate" />
      <button onClick={submit} disabled={!file || busy}
        style={{ font: '600 11px system-ui', background: file && !busy ? '#f26a1b' : '#e5e7eb', color: file && !busy ? '#fff' : '#9ca3af', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: file && !busy ? 'pointer' : 'default' }}>
        {busy ? 'Reading…' : label}
      </button>
      {msg && <span style={{ font: '11px system-ui', color: '#991b1b' }}>{msg}</span>}
    </div>
  )
}

const linkBtn: React.CSSProperties = { font: '600 11px system-ui', color: '#2563eb', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }
const miniInput: React.CSSProperties = { font: '11px system-ui', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 6 }
