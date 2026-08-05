'use client'

// Board / on-site-manager application review + approval (the dual-approval
// stage). They see their association's submitted Pre-Application intakes,
// review the documents, and approve or decline. Units-portal auth (their
// persona sets the approver role: board vs on-site manager).

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface AppRow { id: string; type: string; unit: string | null; status: string; submittedAt: string | null; audited: boolean; decided: boolean; approvedByRole: string | null; applicant: string | null; docCount: number }
interface Detail {
  id: string; type: string; unit: string | null; status: string; submittedAt: string | null
  applicant: { name: string | null; email: string | null; phone: string | null } | null
  rulesAck: { name?: string; at?: string } | null; driveFolderUrl: string | null
  audited: boolean; decided: boolean; note: string | null; approvedByRole: string | null; canApprove: boolean
  checklist: { label: string; required: boolean; provided_by: string; uploaded: boolean; url: string | null }[]
}

const TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease renewal', additional_occupant: 'Additional occupant' }
const fmt = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '—'
const assocFromUrl = () => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('assoc') : null)

export default function UnitsApplications() {
  const [assoc] = useState(assocFromUrl())
  const [apps, setApps] = useState<AppRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const q = assoc ? `?assoc=${encodeURIComponent(assoc)}` : ''
  const load = useCallback(() => {
    fetch(`/api/units/pre-apply${q}`, { credentials: 'include' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(d => setApps(d.applications)).catch(e => setErr(String(e.message ?? e)))
  }, [q])
  useEffect(load, [load])

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <Link href={`/units${q}`} style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>← Unit audit</Link>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '8px 0 2px' }}>Applications to review</h1>
      <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>Review each applicant&apos;s documents and approve or decline.</p>
      {err && <p style={{ color: '#991b1b' }}>{err}</p>}
      {!apps ? <p style={{ color: '#9ca3af' }}>Loading…</p> : apps.length === 0 ? <p style={{ color: '#9ca3af' }}>No submitted applications.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          {apps.map(a => (
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

function AppDetail({ id, assoc, onChanged }: { id: string; assoc: string | null; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const q = assoc ? `?assoc=${encodeURIComponent(assoc)}` : ''

  useEffect(() => { fetch(`/api/units/pre-apply/${id}${q}`, { credentials: 'include' }).then(r => r.json()).then(setD).catch(() => {}) }, [id, q])

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
            <span>{c.label} <span style={{ font: '600 10px system-ui', color: '#4338ca', background: '#eef2ff', borderRadius: 5, padding: '1px 6px' }}>{c.provided_by}</span></span>
            {c.uploaded && c.url ? <a href={c.url} target="_blank" rel="noreferrer" style={{ color: '#166534', fontWeight: 600 }}>✓ View</a> : <span style={{ color: c.required ? '#b45309' : '#9ca3af' }}>{c.required ? 'Missing' : '—'}</span>}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: '#374151', marginBottom: 8 }}>Rules: {d.rulesAck?.name ? <>signed by <strong>{d.rulesAck.name}</strong></> : <span style={{ color: '#b45309' }}>not signed</span>}</div>
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

function StatusPill({ status }: { status: string }) {
  const m: Record<string, { c: string; b: string }> = { submitted: { c: '#92400e', b: '#ffedd5' }, under_review: { c: '#1d4ed8', b: '#dbeafe' }, approved: { c: '#166534', b: '#dcfce7' }, declined: { c: '#991b1b', b: '#fee2e2' } }
  const s = m[status] ?? { c: '#374151', b: '#f3f4f6' }
  return <span style={{ font: '700 11px system-ui', color: s.c, background: s.b, borderRadius: 8, padding: '3px 10px', whiteSpace: 'nowrap' }}>{status.replace('_', ' ')}</span>
}
const btn = (bg: string): React.CSSProperties => ({ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: bg, color: '#fff', font: '600 13px system-ui' })
