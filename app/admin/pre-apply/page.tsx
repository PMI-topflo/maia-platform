'use client'

// Staff Pre-Application audit queue (B4). Read-only list of submitted intakes
// for now — the per-application audit + dual approval (on-site manager OR board)
// land in slice 3.

import { useEffect, useState } from 'react'

interface App {
  id: string; associationCode: string; type: string; unit: string | null; status: string
  submittedAt: string | null; applicant: { name: string | null; email: string | null } | null; docCount: number; signed: boolean
}

const TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease renewal', additional_occupant: 'Additional occupant' }
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '—'

export default function PreApplyQueue() {
  const [apps, setApps] = useState<App[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/pre-apply', { credentials: 'include' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(d => setApps(d.applications)).catch(e => setErr(String(e.message ?? e)))
  }, [])

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Pre-Application audit queue</h1>
      <p style={{ color: '#6b7280', fontSize: 14 }}>Submitted applications awaiting audit + dual approval (on-site manager or board).</p>

      <LinkGenerator />

      {err && <p style={{ color: '#991b1b' }}>{err}</p>}
      {!apps ? <p style={{ color: '#9ca3af' }}>Loading…</p> : apps.length === 0 ? <p style={{ color: '#9ca3af' }}>No submitted applications yet.</p> : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#f9fafb', textAlign: 'left' }}>
              {['Applicant', 'Association', 'Unit', 'Type', 'Docs', 'Signed', 'Submitted', 'Status'].map(h => <th key={h} style={{ padding: '10px 12px', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {apps.map(a => (
                <tr key={a.id} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }} style={{ cursor: 'pointer' }}>
                  <td style={td}><div style={{ fontWeight: 600, color: '#1d4ed8' }}>{a.applicant?.name || '—'}</div><div style={{ color: '#9ca3af', fontSize: 12 }}>{a.applicant?.email}</div></td>
                  <td style={td}>{a.associationCode}</td>
                  <td style={td}>{a.unit || '—'}</td>
                  <td style={td}>{TYPE_LABEL[a.type] ?? a.type}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{a.docCount}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{a.signed ? '✓' : '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(a.submittedAt)}</td>
                  <td style={td}><span style={{ font: '600 11px system-ui', color: '#92400e', background: '#ffedd5', borderRadius: 6, padding: '2px 8px' }}>{a.status}</span></td>
                </tr>
              ))}
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
