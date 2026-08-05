'use client'

// Staff Applications command center: every open application grouped by stage,
// with document counts, the On Going Drive folder, and a click through to the
// per-application audit + dual approval + staff document upload.

import { useEffect, useState } from 'react'

interface App {
  id: string; associationCode: string; type: string; unit: string | null; status: string
  submittedAt: string | null; startedAt: string | null; driveFolderUrl: string | null
  applicant: { name: string | null; email: string | null } | null; docCount: number; signed: boolean
}

const TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease renewal', additional_occupant: 'Additional occupant' }
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '—'

// Pipeline stages, in order, with their color.
const STAGES: { key: string; label: string; c: string; b: string }[] = [
  { key: 'started',      label: 'Collecting documents',    c: '#854d0e', b: '#fef9c3' },
  { key: 'submitted',    label: 'Submitted — awaiting audit', c: '#1e40af', b: '#dbeafe' },
  { key: 'under_review', label: 'Under review',            c: '#5b21b6', b: '#ede9fe' },
  { key: 'approved',     label: 'Approved',                c: '#166534', b: '#dcfce7' },
  { key: 'declined',     label: 'Declined',                c: '#991b1b', b: '#fee2e2' },
]

export default function PreApplyQueue() {
  const [apps, setApps] = useState<App[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/pre-apply', { credentials: 'include' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(d => setApps(d.applications)).catch(e => setErr(String(e.message ?? e)))
  }, [])

  const count = (k: string) => (apps ?? []).filter(a => a.status === k).length

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Applications</h1>
      <p style={{ color: '#6b7280', fontSize: 14 }}>Every open application and its stage. Click one to review, upload documents you received, and approve.</p>

      <LinkGenerator />

      {/* Stage summary chips (click to filter) */}
      {apps && apps.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '14px 0 18px' }}>
          {STAGES.map(s => (
            <button key={s.key} onClick={() => setFilter(filter === s.key ? null : s.key)}
              style={{ cursor: 'pointer', border: filter === s.key ? `2px solid ${s.c}` : '1px solid #e5e7eb', background: s.b, color: s.c, borderRadius: 10, padding: '6px 12px', font: '600 13px system-ui' }}>
              {s.label} · {count(s.key)}
            </button>
          ))}
        </div>
      )}

      {err && <p style={{ color: '#991b1b' }}>{err}</p>}
      {!apps ? <p style={{ color: '#9ca3af' }}>Loading…</p> : apps.length === 0 ? <p style={{ color: '#9ca3af' }}>No applications yet.</p> : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#f9fafb', textAlign: 'left' }}>
              {['Applicant', 'Assoc', 'Unit', 'Type', 'Docs', 'Signed', 'Started', 'Stage', 'Drive'].map(h => <th key={h} style={{ padding: '10px 12px', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {apps.filter(a => !filter || a.status === filter).map(a => {
                const st = STAGES.find(s => s.key === a.status) ?? { label: a.status, c: '#374151', b: '#f3f4f6' }
                return (
                  <tr key={a.id} style={{ cursor: 'pointer' }}>
                    <td style={td} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}><div style={{ fontWeight: 600, color: '#1d4ed8' }}>{a.applicant?.name || '—'}</div><div style={{ color: '#9ca3af', fontSize: 12 }}>{a.applicant?.email}</div></td>
                    <td style={td} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}>{a.associationCode}</td>
                    <td style={td} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}>{a.unit || '—'}</td>
                    <td style={td} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}>{TYPE_LABEL[a.type] ?? a.type}</td>
                    <td style={{ ...td, textAlign: 'center' }} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}>{a.docCount}</td>
                    <td style={{ ...td, textAlign: 'center' }} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}>{a.signed ? '✓' : '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}>{fmt(a.startedAt)}</td>
                    <td style={td} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}><span style={{ font: '600 11px system-ui', color: st.c, background: st.b, borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>{st.label}</span></td>
                    <td style={td}>{a.driveFolderUrl ? <a href={a.driveFolderUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>📁</a> : <span style={{ color: '#d1d5db' }}>—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const td: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid #f3f4f6', color: '#374151', verticalAlign: 'top' }

// Build an application link to paste into an email reply. Carries the
// association + unit + type, so uploads file into the right Drive folder.
function LinkGenerator() {
  const TYPES = [
    { key: 'lease', label: 'Rent (new lease)' }, { key: 'purchase', label: 'Purchase' },
    { key: 'lease_renewal', label: 'Lease renewal' }, { key: 'additional_occupant', label: 'Additional occupant' },
  ]
  const LANGS: { key: string; label: string }[] = [
    { key: '', label: 'Language (they choose)' }, { key: 'en', label: 'English' }, { key: 'es', label: 'Español' },
    { key: 'pt', label: 'Português' }, { key: 'fr', label: 'Français' }, { key: 'ht', label: 'Kreyòl' },
    { key: 'he', label: 'עברית' }, { key: 'ru', label: 'Русский' },
  ]
  const [assoc, setAssoc] = useState('MANXI')
  const [unit, setUnit] = useState('')
  const [type, setType] = useState('lease')
  const [lang, setLang] = useState('')
  const [copied, setCopied] = useState(false)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const qs = [unit ? `unit=${encodeURIComponent(unit.trim())}` : '', type ? `type=${type}` : '', lang ? `lang=${lang}` : ''].filter(Boolean).join('&')
  const link = `${origin}/pre-apply/${encodeURIComponent(assoc.trim().toUpperCase())}${qs ? `?${qs}` : ''}`
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* */ } }
  const s: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 8 }
  return (
    <div style={{ margin: '14px 0 20px', padding: 14, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff' }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Generate an application link (reply by email)</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={assoc} onChange={e => setAssoc(e.target.value)} placeholder="Association" style={{ ...s, width: 100 }} />
        <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="Unit (e.g. 103)" style={{ ...s, width: 130 }} />
        <select value={type} onChange={e => setType(e.target.value)} style={s}>{TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
        <select value={lang} onChange={e => setLang(e.target.value)} style={s}>{LANGS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}</select>
        <input readOnly value={link} onFocus={e => e.currentTarget.select()} style={{ ...s, flex: 1, minWidth: 220, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#374151' }} />
        <button onClick={copy} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: copied ? '#059669' : '#f26a1b', color: '#fff', font: '600 13px system-ui' }}>{copied ? '✓ Copied' : 'Copy'}</button>
      </div>
      <p style={{ fontSize: 11.5, color: '#9ca3af', margin: '8px 0 0' }}>Paste into your reply. The applicant uploads that unit&apos;s document checklist + signs the rules; MAIA files it into the unit&apos;s On Going Applications Drive folder.</p>
    </div>
  )
}
