'use client'

// Board / on-site-manager application review + approval (the dual-approval
// stage). They see their association's submitted Pre-Application intakes,
// review the documents, and approve or decline. Units-portal auth (their
// persona sets the approver role: board vs on-site manager).

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface AppRow { id: string; type: string; unit: string | null; status: string; submittedAt: string | null; audited: boolean; decided: boolean; approvedByRole: string | null; applicant: string | null; docCount: number }
interface ChecklistItem { label: string; provided_by: string; required: boolean; notarized: boolean; exampleUrl: string | null }
interface TypeChecklist { type: string; label: string; blurb: string; items: ChecklistItem[] }
interface Detail {
  id: string; type: string; unit: string | null; status: string; submittedAt: string | null
  applicant: { name: string | null; email: string | null; phone: string | null } | null
  stakeholders?: { id: string; role: string; roleLabel: string; name: string | null; email: string | null; isPrimary: boolean; status: string; signs: boolean; signedAt: string | null; rulesAckName: string | null; emailVerified: boolean }[]
  rulesAck: { name?: string; at?: string } | null; driveFolderUrl: string | null
  audited: boolean; decided: boolean; note: string | null; approvedByRole: string | null; canApprove: boolean; canUpload?: boolean
  checklist: { doc_key: string; label: string; required: boolean; provided_by: string; uploaded: boolean; url: string | null; exampleUrl: string | null }[]
}

const TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease renewal', additional_occupant: 'Additional occupant' }
const fmt = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '—'
const assocFromUrl = () => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('assoc') : null)

const TYPE_ORDER = ['lease', 'lease_renewal', 'purchase', 'additional_occupant']

export default function UnitsApplications() {
  const [assoc] = useState(assocFromUrl())
  const [apps, setApps] = useState<AppRow[] | null>(null)
  const [checklists, setChecklists] = useState<TypeChecklist[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [showRef, setShowRef] = useState(false)

  const q = assoc ? `?assoc=${encodeURIComponent(assoc)}` : ''
  const load = useCallback(() => {
    fetch(`/api/units/pre-apply${q}`, { credentials: 'include' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(d => { setApps(d.applications); setChecklists(d.checklists ?? []) }).catch(e => setErr(String(e.message ?? e)))
  }, [q])
  useEffect(load, [load])

  // Types present, ordered — for the filter chips (with counts).
  const counts = new Map<string, number>()
  for (const a of apps ?? []) counts.set(a.type, (counts.get(a.type) ?? 0) + 1)
  const chipTypes = [...new Set([...TYPE_ORDER.filter(t => counts.has(t)), ...checklists.map(c => c.type)])]
  const shown = (apps ?? []).filter(a => typeFilter === 'all' || a.type === typeFilter)
  const filteredChecklist = checklists.find(c => c.type === typeFilter) ?? null

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <Link href={`/units${q}`} style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>← Unit audit</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', margin: '8px 0 2px' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Pre-Application Compliance</h1>
          <p style={{ color: '#6b7280', fontSize: 14, margin: '2px 0 0' }}>Review each applicant&apos;s documents and approve or decline.</p>
        </div>
        {checklists.length > 0 && (
          <button onClick={() => setShowRef(s => !s)} style={{ padding: '9px 14px', borderRadius: 9, border: '1px solid #d1d5db', background: showRef ? '#eef2ff' : '#fff', color: '#3730a3', font: '600 13px system-ui', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            📋 Required documents {showRef ? '▲' : '▼'}
          </button>
        )}
      </div>
      {err && <p style={{ color: '#991b1b' }}>{err}</p>}

      {/* Reference: every application type's required documents (Pre-Application Compliance). */}
      {showRef && checklists.length > 0 && (
        <div style={{ margin: '12px 0 6px', border: '1px solid #e5e7eb', borderRadius: 12, background: '#fafafa', padding: 14 }}>
          <div style={{ font: '700 11px system-ui', letterSpacing: '.06em', textTransform: 'uppercase', color: '#6b7280', marginBottom: 4 }}>Pre-Application Compliance · required documents by type</div>
          <p style={{ fontSize: 12.5, color: '#9ca3af', margin: '0 0 12px' }}>What MAIA requests from applicants for each type of application at {assoc ?? 'this association'}.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[...checklists].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)).map(c => <ChecklistCard key={c.type} c={c} />)}
          </div>
        </div>
      )}

      {/* Filter the list by application type. */}
      {apps && apps.length > 0 && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', margin: '14px 0 4px' }}>
          <Chip on={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>All <span style={{ opacity: .6 }}>{apps.length}</span></Chip>
          {chipTypes.map(t => (
            <Chip key={t} on={typeFilter === t} onClick={() => setTypeFilter(t)}>{TYPE_LABEL[t] ?? t} <span style={{ opacity: .6 }}>{counts.get(t) ?? 0}</span></Chip>
          ))}
        </div>
      )}

      {/* When filtered to a type, show that type's checklist above its applications. */}
      {filteredChecklist && (
        <div style={{ margin: '10px 0 6px' }}><ChecklistCard c={filteredChecklist} /></div>
      )}

      {!apps ? <p style={{ color: '#9ca3af' }}>Loading…</p> : apps.length === 0 ? <p style={{ color: '#9ca3af' }}>No submitted applications.</p> : shown.length === 0 ? <p style={{ color: '#9ca3af', marginTop: 12 }}>No {TYPE_LABEL[typeFilter] ?? ''} applications submitted yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {shown.map(a => (
            <div key={a.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
              <button onClick={() => setOpen(open === a.id ? null : a.id)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 14px', background: '#fff', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{a.applicant || 'Applicant'} <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 13 }}>· {TYPE_LABEL[a.type] ?? a.type}{a.unit ? ` · Unit ${a.unit}` : ''}</span></div>
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>{a.docCount} docs · submitted {fmt(a.submittedAt)}</div>
                </div>
                <StatusPill status={a.status} />
              </button>
              {open === a.id && <AppDetail id={a.id} assoc={assoc} onChanged={load} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ padding: '6px 12px', borderRadius: 999, border: `1px solid ${on ? '#4338ca' : '#d1d5db'}`, background: on ? '#eef2ff' : '#fff', color: on ? '#3730a3' : '#374151', font: '600 13px system-ui', cursor: 'pointer' }}>{children}</button>
}

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
              {it.exampleUrl && <a href={it.exampleUrl} target="_blank" rel="noreferrer" style={{ font: '600 11px system-ui', color: '#2563eb', textDecoration: 'none', marginLeft: 7 }}>see example ↗</a>}
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
const PROVIDED_LABEL: Record<string, string> = { applicant: 'Applicant', landlord: 'Owner', agent: 'Agent' }

function AppDetail({ id, assoc, onChanged }: { id: string; assoc: string | null; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const q = assoc ? `?assoc=${encodeURIComponent(assoc)}` : ''

  const reload = useCallback(() => { fetch(`/api/units/pre-apply/${id}${q}`, { credentials: 'include' }).then(r => r.json()).then(setD).catch(() => {}) }, [id, q])
  useEffect(reload, [reload])

  async function act(action: string) {
    if ((action === 'decline' || action === 'request') && !note.trim()) { alert('Add a note.'); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/units/pre-apply/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assoc, action, note }) })
      if (!r.ok) throw new Error((await r.json()).error || 'failed'); setNote(''); onChanged()
      fetch(`/api/units/pre-apply/${id}${q}`, { credentials: 'include' }).then(r => r.json()).then(setD).catch(() => {})
    } catch (e) { alert(`Could not update: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  if (!d) return <div style={{ padding: 14, color: '#9ca3af', fontSize: 13, borderTop: '1px solid #f3f4f6' }}>Loading…</div>
  const decided = d.status === 'approved' || d.status === 'declined'
  const missing = d.checklist.filter(c => c.required && !c.uploaded)

  return (
    <div style={{ padding: 14, borderTop: '1px solid #f3f4f6', background: '#fafafa' }}>
      <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>{d.applicant?.email}{d.applicant?.phone ? ` · ${d.applicant.phone}` : ''}{d.driveFolderUrl && <> · <a href={d.driveFolderUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 600 }}>📁 Drive</a></>}</div>
      {!d.audited && <div style={{ fontSize: 12.5, color: '#b45309', marginBottom: 8 }}>⏳ Awaiting PMI compliance audit — you can still review the documents.</div>}
      {missing.length > 0 && <div style={{ fontSize: 12.5, color: '#b45309', marginBottom: 8 }}>Missing required: {missing.map(m => m.label).join(', ')}</div>}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff', marginBottom: 10 }}>
        {d.checklist.map((c, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 12px', borderTop: i ? '1px solid #f3f4f6' : 'none', alignItems: 'center', fontSize: 13 }}>
            <span>{c.label} <span style={{ font: '600 10px system-ui', color: '#4338ca', background: '#eef2ff', borderRadius: 5, padding: '1px 6px' }}>{PROVIDED_LABEL[c.provided_by] ?? c.provided_by}</span>
              {c.exampleUrl && <a href={c.exampleUrl} target="_blank" rel="noreferrer" style={{ font: '600 11px system-ui', color: '#2563eb', textDecoration: 'none', marginLeft: 7 }}>see example ↗</a>}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {c.uploaded && c.url ? <a href={c.url} target="_blank" rel="noreferrer" style={{ color: '#166534', fontWeight: 600 }}>✓ View</a> : <span style={{ color: c.required ? '#b45309' : '#9ca3af' }}>{c.required ? 'Missing' : '—'}</span>}
              {d.canUpload && <UploadItem id={id} assoc={assoc} docKey={c.doc_key} docLabel={c.label} uploaded={c.uploaded} onDone={reload} />}
            </span>
          </div>
        ))}
      </div>
      {d.stakeholders && d.stakeholders.length > 0 ? (
        <div style={{ margin: '4px 0 10px', border: '1px solid #eef0f3', borderRadius: 8, padding: '8px 10px', background: '#fafbfc' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#6b7280', marginBottom: 4 }}>People on this application</div>
          {d.stakeholders.map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: '#374151', padding: '2px 0' }}>
              <span><strong>{p.name || p.email || '—'}</strong> <span style={{ color: '#6b7280' }}>· {p.roleLabel}</span></span>
              <span>{p.signs ? (p.signedAt ? <span style={{ color: '#166534', fontWeight: 600 }}>✍ signed{p.rulesAckName ? ` — ${p.rulesAckName}` : ''}</span> : <span style={{ color: '#b45309' }}>not signed</span>) : <span style={{ color: '#9ca3af' }}>no signature needed</span>}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: '#374151', marginBottom: 8 }}>Rules: {d.rulesAck?.name ? <>signed by <strong>{d.rulesAck.name}</strong></> : <span style={{ color: '#b45309' }}>not signed</span>}</div>
      )}
      {decided ? (
        <div style={{ fontSize: 13, fontWeight: 600, color: d.status === 'approved' ? '#166534' : '#991b1b' }}>{d.status === 'approved' ? `Approved (${d.approvedByRole})` : 'Declined'}{d.note ? ` — ${d.note}` : ''}</div>
      ) : d.canApprove ? (
        <div>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note (required to decline or request more)" style={{ width: '100%', boxSizing: 'border-box', minHeight: 46, padding: 9, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button disabled={busy} onClick={() => act('approve')} style={btn('#059669')}>Approve</button>
            <button disabled={busy} onClick={() => act('request')} style={btn('#b45309')}>Request more</button>
            <button disabled={busy} onClick={() => act('decline')} style={btn('#b91c1c')}>Decline</button>
          </div>
        </div>
      ) : <div style={{ fontSize: 12.5, color: '#9ca3af' }}>View only.</div>}
    </div>
  )
}

// Board / on-site manager uploads a document for one checklist item. Files it
// against the application, mirrors to Drive, and notifies PMI + Jonathan to
// scan → confirm into MAIA.
function UploadItem({ id, assoc, docKey, docLabel, uploaded, onDone }: { id: string; assoc: string | null; docKey: string; docLabel: string; uploaded: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const inputId = `up-${id}-${docKey}`
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('assoc', assoc ?? ''); fd.append('file', f); fd.append('doc_key', docKey); fd.append('doc_label', docLabel)
      const r = await fetch(`/api/units/pre-apply/${id}/upload`, { method: 'POST', credentials: 'include', body: fd })
      if (!r.ok) throw new Error((await r.json()).error || 'failed')
      onDone()
    } catch (err) { alert(`Could not upload: ${(err as Error).message}`) } finally { setBusy(false); e.target.value = '' }
  }
  return (
    <label htmlFor={inputId} style={{ font: '600 11px system-ui', color: busy ? '#9ca3af' : '#7c3aed', cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
      {busy ? 'Uploading…' : uploaded ? '⤴ Replace' : '⤴ Upload'}
      <input id={inputId} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" onChange={onFile} disabled={busy} style={{ display: 'none' }} />
    </label>
  )
}

function StatusPill({ status }: { status: string }) {
  const m: Record<string, { c: string; b: string }> = { submitted: { c: '#92400e', b: '#ffedd5' }, under_review: { c: '#1d4ed8', b: '#dbeafe' }, approved: { c: '#166534', b: '#dcfce7' }, declined: { c: '#991b1b', b: '#fee2e2' } }
  const s = m[status] ?? { c: '#374151', b: '#f3f4f6' }
  return <span style={{ font: '700 11px system-ui', color: s.c, background: s.b, borderRadius: 8, padding: '3px 10px', whiteSpace: 'nowrap' }}>{status.replace('_', ' ')}</span>
}
const btn = (bg: string): React.CSSProperties => ({ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: bg, color: '#fff', font: '600 13px system-ui' })
