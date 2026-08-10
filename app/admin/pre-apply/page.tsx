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
interface ChecklistItem { label: string; provided_by: string; required: boolean; notarized: boolean }
interface TypeChecklist { type: string; label: string; blurb: string; items: ChecklistItem[] }
const TYPE_ORDER = ['lease', 'lease_renewal', 'purchase', 'additional_occupant']

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

interface DriveUnit { folderName: string; unitRef: string | null; unitNumber: string | null; url: string; applicationId: string | null; applicationStatus: string | null }

export default function PreApplyQueue() {
  const [apps, setApps] = useState<App[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const [drive, setDrive] = useState<DriveUnit[] | null>(null)
  const [driveErr, setDriveErr] = useState<string | null>(null)
  const [importing, setImporting] = useState<string | null>(null)
  const [showRef, setShowRef] = useState(false)
  const [refAssoc, setRefAssoc] = useState('')
  const [refData, setRefData] = useState<TypeChecklist[] | null>(null)
  const [refErr, setRefErr] = useState<string | null>(null)

  const assocOptions = [...new Set((apps ?? []).map(a => a.associationCode))].sort()
  function loadRef(a: string) {
    setRefAssoc(a); setRefData(null); setRefErr(null)
    fetch(`/api/admin/pre-apply/checklists?assoc=${encodeURIComponent(a)}`, { credentials: 'include' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(d => setRefData(d.checklists)).catch(e => setRefErr(String(e.message ?? e)))
  }

  const loadDrive = () => fetch('/api/admin/pre-apply/ongoing-drive', { credentials: 'include' })
    .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
    .then(d => { setDrive(d.units); if (d.error) setDriveErr(d.error) }).catch(e => setDriveErr(String(e.message ?? e)))

  useEffect(() => {
    fetch('/api/admin/pre-apply', { credentials: 'include' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(d => setApps(d.applications)).catch(e => setErr(String(e.message ?? e)))
    loadDrive()
  }, [])

  async function bringIntoMaia(u: DriveUnit) {
    if (!u.unitRef) return
    setImporting(u.folderName)
    try {
      const r = await fetch('/api/admin/pre-apply/ongoing-drive/import', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unitRef: u.unitRef, folderId: u.url.split('/').pop(), folderUrl: u.url }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      window.location.href = `/admin/pre-apply/${j.applicationId}`
    } catch (e) { alert(`Could not bring into MAIA: ${(e as Error).message}`); setImporting(null) }
  }

  const count = (k: string) => (apps ?? []).filter(a => a.status === k).length

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Applications</h1>
          <p style={{ color: '#6b7280', fontSize: 14, margin: '4px 0 0' }}>Every open application and its stage. Click one to review, upload documents you received, and approve.</p>
        </div>
        <button onClick={() => { const open = !showRef; setShowRef(open); if (open && !refData) loadRef(refAssoc || assocOptions[0] || 'MANXI') }}
          style={{ padding: '9px 14px', borderRadius: 9, border: '1px solid #d1d5db', background: showRef ? '#eef2ff' : '#fff', color: '#3730a3', font: '600 13px system-ui', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          📋 Required documents {showRef ? '▲' : '▼'}
        </button>
      </div>

      {/* Pre-Application Compliance reference — required documents per type, per association. */}
      {showRef && (
        <div style={{ margin: '12px 0 4px', border: '1px solid #e5e7eb', borderRadius: 12, background: '#fafafa', padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
            <div style={{ font: '700 11px system-ui', letterSpacing: '.06em', textTransform: 'uppercase', color: '#6b7280' }}>Pre-Application Compliance · required documents by type</div>
            {assocOptions.length > 0 && (
              <select value={refAssoc} onChange={e => loadRef(e.target.value)} style={{ font: '600 13px system-ui', padding: '5px 8px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151' }}>
                {assocOptions.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            )}
          </div>
          <p style={{ fontSize: 12.5, color: '#9ca3af', margin: '0 0 12px' }}>What MAIA requests from applicants for each type of application at {refAssoc || '…'}. Edit these in Association document setup.</p>
          {refErr && <p style={{ color: '#b45309', fontSize: 13 }}>⚠ {refErr}</p>}
          {!refData && !refErr ? <p style={{ color: '#9ca3af', fontSize: 13 }}>Loading…</p> : refData && refData.length === 0 ? <p style={{ color: '#9ca3af', fontSize: 13 }}>No checklist configured for {refAssoc}.</p> : refData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[...refData].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)).map(c => <ChecklistCard key={c.type} c={c} />)}
            </div>
          )}
        </div>
      )}

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

      {/* Units that physically have a folder in the On Going Applications Drive
          folder — many pre-date the in-app pipeline (no DB record yet). */}
      <div style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 2px' }}>On Going Applications — Drive folder{drive ? ` (${drive.length})` : ''}</h2>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 10px' }}>Unit folders already in the &quot;On Going Applications&quot; Google Drive folder. Ones not yet tracked in MAIA are marked — open the folder or start an application to bring them in.</p>
        {driveErr && <p style={{ color: '#b45309', fontSize: 13 }}>⚠ Could not read the Drive folder: {driveErr}</p>}
        {!drive && !driveErr ? <p style={{ color: '#9ca3af', fontSize: 13 }}>Reading Drive…</p> : drive && drive.length === 0 ? <p style={{ color: '#9ca3af', fontSize: 13 }}>No unit folders in the On Going Applications folder.</p> : drive && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {drive.map(u => (
              <div key={u.folderName} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{u.unitRef || u.folderName}</span>
                  {u.applicationId
                    ? <span style={{ font: '600 10px system-ui', color: '#166534', background: '#dcfce7', borderRadius: 6, padding: '2px 7px' }}>in MAIA</span>
                    : <span style={{ font: '600 10px system-ui', color: '#92400e', background: '#fef9c3', borderRadius: 6, padding: '2px 7px' }}>Drive only</span>}
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                  <a href={u.url} target="_blank" rel="noreferrer" style={{ font: '600 12px system-ui', color: '#2563eb', textDecoration: 'none' }}>📁 Folder</a>
                  {u.applicationId
                    ? <a href={`/admin/pre-apply/${u.applicationId}`} style={{ font: '600 12px system-ui', color: '#9a3412', textDecoration: 'none' }}>Open application →</a>
                    : <button onClick={() => bringIntoMaia(u)} disabled={importing === u.folderName || !u.unitRef}
                        style={{ font: '600 12px system-ui', color: '#fff', background: importing === u.folderName ? '#c9ccd3' : '#f26a1b', border: 'none', borderRadius: 7, padding: '4px 10px', cursor: importing === u.folderName ? 'default' : 'pointer' }}>
                        {importing === u.folderName ? 'Bringing in…' : 'Bring into MAIA'}
                      </button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const td: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid #f3f4f6', color: '#374151', verticalAlign: 'top' }

const PROVIDED_LABEL: Record<string, string> = { applicant: 'Applicant', landlord: 'Owner', agent: 'Agent' }
function ChecklistCard({ c }: { c: TypeChecklist }) {
  const req = c.items.filter(i => i.required).length
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '10px 13px', borderBottom: '1px solid #f3f4f6' }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>{c.label}</span>
        <span style={{ font: '600 11px system-ui', color: '#9ca3af' }}>{c.items.length} items · {req} required</span>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {c.items.map((it, i) => (
          <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '8px 13px', borderTop: i ? '1px solid #f6f6f6' : 'none', fontSize: 13.5 }}>
            <span style={{ color: '#1f2937' }}>
              <span style={{ color: '#9ca3af', fontVariant: 'tabular-nums', marginRight: 8 }}>{i + 1}</span>
              {it.label}
              <span style={{ font: '600 10px system-ui', color: '#4338ca', background: '#eef2ff', borderRadius: 5, padding: '1px 6px', marginLeft: 7 }}>{PROVIDED_LABEL[it.provided_by] ?? it.provided_by}</span>
              {it.notarized && <span style={{ font: '600 10px system-ui', color: '#7a5a1e', background: '#f5ecd8', borderRadius: 5, padding: '1px 6px', marginLeft: 5 }}>notarized</span>}
            </span>
            {it.required
              ? <span style={{ font: '700 10px system-ui', color: '#fff', background: '#c85d1b', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>REQUIRED</span>
              : <span style={{ font: '700 10px system-ui', color: '#9ca3af', border: '1px solid #e5e7eb', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>IF APPLICABLE</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}

// Build ONE application link to paste into an email reply. It carries only the
// association + unit (+ optional language) — the applicant picks the application
// TYPE themselves inside the flow, right after they identify + verify.
function LinkGenerator() {
  const LANGS: { key: string; label: string }[] = [
    { key: '', label: 'Language (they choose)' }, { key: 'en', label: 'English' }, { key: 'es', label: 'Español' },
    { key: 'pt', label: 'Português' }, { key: 'fr', label: 'Français' }, { key: 'ht', label: 'Kreyòl' },
    { key: 'he', label: 'עברית' }, { key: 'ru', label: 'Русский' },
  ]
  const [assoc, setAssoc] = useState('MANXI')
  const [unit, setUnit] = useState('')
  const [lang, setLang] = useState('')
  const [copied, setCopied] = useState(false)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const qs = [unit ? `unit=${encodeURIComponent(unit.trim())}` : '', lang ? `lang=${lang}` : ''].filter(Boolean).join('&')
  const link = `${origin}/pre-apply/${encodeURIComponent(assoc.trim().toUpperCase())}${qs ? `?${qs}` : ''}`
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* */ } }
  const s: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 8 }
  return (
    <div style={{ margin: '14px 0 20px', padding: 14, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff' }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Generate an application link (reply by email)</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={assoc} onChange={e => setAssoc(e.target.value)} placeholder="Association" style={{ ...s, width: 100 }} />
        <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="Unit (e.g. 103)" style={{ ...s, width: 130 }} />
        <select value={lang} onChange={e => setLang(e.target.value)} style={s}>{LANGS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}</select>
        <input readOnly value={link} onFocus={e => e.currentTarget.select()} style={{ ...s, flex: 1, minWidth: 220, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#374151' }} />
        <button onClick={copy} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: copied ? '#059669' : '#f26a1b', color: '#fff', font: '600 13px system-ui' }}>{copied ? '✓ Copied' : 'Copy'}</button>
      </div>
      <p style={{ fontSize: 11.5, color: '#9ca3af', margin: '8px 0 0' }}>One link per unit. The applicant identifies who they are, verifies, then picks the application type — MAIA files everything into the unit&apos;s On Going Applications Drive folder.</p>
    </div>
  )
}
