'use client'

// Staff Applications command center: every open application grouped by stage,
// with document counts, the On Going Drive folder, and a click through to the
// per-application audit + dual approval + staff document upload.

import { useEffect, useState } from 'react'

interface App {
  id: string; associationCode: string; type: string; unit: string | null; status: string
  stage: string; chipKey: string; stageLabel: string; detail: string
  submittedAt: string | null; startedAt: string | null; reviewedAt: string | null; driveFolderUrl: string | null
  applicant: { name: string | null; email: string | null } | null; docCount: number; signed: boolean
  lastRequestedAt: string | null
}
const isDecided = (status: string) => status === 'approved' || status === 'declined'
interface ChecklistItem { label: string; provided_by: string; required: boolean; notarized: boolean; exampleUrl: string | null }
interface TypeChecklist { type: string; label: string; blurb: string; items: ChecklistItem[] }
const TYPE_ORDER = ['lease', 'lease_renewal', 'purchase', 'additional_occupant']

const TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease renewal', additional_occupant: 'Additional occupant' }
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '—'

// Chip colors keyed by the API's `chipKey` — the real live document-review
// stage from lib/application-dashboard.ts (decideStage()), with 'decided'
// split back into 'approved'/'declined' for the visual distinction staff
// still need. NOT the raw `status` column anymore — that's what let MANXI
// 801 and 901 sit mislabeled "Documents approved — creating letter" for ten
// days despite genuinely being nowhere near complete (found live, 2026-08-21;
// see app/api/admin/pre-apply/route.ts). Order here is display order for the
// summary chips.
// Not imported from lib/application-dashboard.ts — that module pulls in
// supabaseAdmin (service-role key) at module scope, unsafe to bundle into a
// 'use client' page. Labels duplicated here match STAGE_LABEL there exactly;
// the API is the single source of truth for WHICH stage each row is in
// (chipKey/stageLabel) — this is presentation only.
const STAGE_META: Record<string, { label: string; c: string; b: string }> = {
  refused:    { label: 'Sent back — awaiting a replacement', c: '#991b1b', b: '#fee2e2' },
  applicant:  { label: 'Collecting documents',               c: '#854d0e', b: '#fef9c3' },
  not_sent:   { label: 'Ready to send to the board',         c: '#1e40af', b: '#dbeafe' },
  review:     { label: 'With the board to review',           c: '#1e40af', b: '#dbeafe' },
  letter:     { label: 'Documents approved — creating letter', c: '#5b21b6', b: '#ede9fe' },
  signature:  { label: 'Letter sent — awaiting signatures',  c: '#9a3412', b: '#ffedd5' },
  approved:   { label: 'Approved',                           c: '#166534', b: '#dcfce7' },
  declined:   { label: 'Declined',                           c: '#991b1b', b: '#fee2e2' },
}
const STAGE_ORDER = ['refused', 'applicant', 'not_sent', 'review', 'letter', 'signature', 'approved', 'declined']

export default function PreApplyQueue() {
  const [apps, setApps] = useState<App[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
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

  useEffect(() => {
    fetch('/api/admin/pre-apply', { credentials: 'include' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(d => setApps(d.applications)).catch(e => setErr(String(e.message ?? e)))
  }, [])

  const count = (k: string) => (apps ?? []).filter(a => a.chipKey === k).length

  // Only ever offered for a bare-shell application (0 docs, per the row's own
  // Docs count) — the endpoint independently re-checks every table an
  // application can hold data in and refuses if any of them are non-empty, so
  // this can't remove something that turns out to have anything in it.
  async function deleteApp(a: App) {
    if (!confirm(`Delete this empty application (${a.associationCode} · Unit ${a.unit ?? '—'})? This also trashes its Drive folder, if any. This cannot be undone from here.`)) return
    setDeleting(a.id)
    try {
      const r = await fetch(`/api/admin/pre-apply/${a.id}`, { method: 'DELETE', credentials: 'include' })
      const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'failed')
      setApps(prev => (prev ?? []).filter(x => x.id !== a.id))
    } catch (e) { alert(`Could not delete: ${(e as Error).message}`) } finally { setDeleting(null) }
  }

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

      <StaffCreate />
      <LinkGenerator />

      {/* Stage summary chips (click to filter) */}
      {apps && apps.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '14px 0 18px' }}>
          {STAGE_ORDER.map(key => {
            const s = STAGE_META[key]
            return (
              <button key={key} onClick={() => setFilter(filter === key ? null : key)}
                style={{ cursor: 'pointer', border: filter === key ? `2px solid ${s.c}` : '1px solid #e5e7eb', background: s.b, color: s.c, borderRadius: 10, padding: '6px 12px', font: '600 13px system-ui' }}>
                {s.label} · {count(key)}
              </button>
            )
          })}
        </div>
      )}

      {err && <p style={{ color: '#991b1b' }}>{err}</p>}

      {/* In progress — the applicant is uploading but hasn't submitted. These are
          invisible on the board view and easy to miss in the table, which is how
          MANXI 1002's three documents sat unnoticed. */}
      {(() => {
        const inFlight = (apps ?? []).filter(a => a.status === 'started' && a.docCount > 0)
        if (inFlight.length === 0) return null
        return (
          <div style={{ margin: '4px 0 18px', border: '1px solid #fbbf24', borderLeft: '4px solid #f59e0b', background: '#fffbeb', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ font: '700 13.5px system-ui', color: '#92400e', marginBottom: 6 }}>📥 Documents arriving — {inFlight.length} application{inFlight.length === 1 ? '' : 's'} in progress (not submitted yet)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {inFlight.map(a => (
                <a key={a.id} href={`/admin/pre-apply/${a.id}`} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', font: '13px system-ui', color: '#1f2937', textDecoration: 'none' }}>
                  <strong>{a.associationCode}{a.unit ? ` · Unit ${a.unit}` : ''}</strong>
                  <span style={{ color: '#6b7280' }}>{a.applicant?.name || 'applicant'} · {TYPE_LABEL[a.type] ?? a.type}</span>
                  <span style={{ font: '700 11px system-ui', color: '#fff', background: '#f59e0b', borderRadius: 999, padding: '2px 8px' }}>{a.docCount} doc{a.docCount === 1 ? '' : 's'}</span>
                  <span style={{ color: '#9ca3af', fontSize: 12 }}>started {fmt(a.startedAt)}</span>
                </a>
              ))}
            </div>
          </div>
        )
      })()}

      {!apps ? <p style={{ color: '#9ca3af' }}>Loading…</p> : apps.length === 0 ? <p style={{ color: '#9ca3af' }}>No applications yet.</p> : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#f9fafb', textAlign: 'left' }}>
              {['Applicant', 'Assoc', 'Unit', 'Type', 'Docs', 'Signed', 'Started', 'Stage', 'Drive', ''].map(h => <th key={h} style={{ padding: '10px 12px', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {apps.filter(a => !filter || a.chipKey === filter)
                // Decided (approved/declined) applications sink to the end —
                // staff report, 2026-08-20: "Put the approved in the final
                // of the list." Array.sort is stable, so within each group
                // the API's own order (startedAt desc) is unchanged.
                .slice().sort((a, b) => Number(isDecided(a.status)) - Number(isDecided(b.status)))
                .map(a => {
                const st = STAGE_META[a.chipKey] ?? { label: a.stageLabel, c: '#374151', b: '#f3f4f6' }
                return (
                  <tr key={a.id} style={{ cursor: 'pointer' }}>
                    <td style={td} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}><div style={{ fontWeight: 600, color: '#1d4ed8' }}>{a.applicant?.name || '—'}</div><div style={{ color: '#9ca3af', fontSize: 12 }}>{a.applicant?.email}</div></td>
                    <td style={td} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}>{a.associationCode}</td>
                    <td style={td} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}>{a.unit || '—'}</td>
                    <td style={td} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}>{TYPE_LABEL[a.type] ?? a.type}</td>
                    <td style={{ ...td, textAlign: 'center' }} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}>{a.docCount}</td>
                    <td style={{ ...td, textAlign: 'center' }} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}>{a.signed ? '✓' : '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}>{fmt(a.startedAt)}</td>
                    <td style={td} onClick={() => { window.location.href = `/admin/pre-apply/${a.id}` }}>
                      <span style={{ font: '600 11px system-ui', color: st.c, background: st.b, borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>{a.stageLabel}</span>
                      {/* What's actually outstanding, live — this is the whole
                          point of computing stage from real document state
                          instead of the status column: it can SAY what's
                          missing, not just report a status word. */}
                      {!isDecided(a.status) && a.detail && <div style={{ font: '11px system-ui', color: '#6b7280', marginTop: 3, maxWidth: 260 }}>{a.detail}</div>}
                      {/* Decision date under the pill — was invisible before,
                          so an approved/declined row gave no sense of when.
                          Staff report: "with a date that was approved under
                          the green APPROVED text." */}
                      {isDecided(a.status) && a.reviewedAt && <div style={{ font: '11px system-ui', color: '#9ca3af', marginTop: 3, whiteSpace: 'nowrap' }}>{fmt(a.reviewedAt)}</div>}
                      {/* When docs were last requested — the state machine
                          itself never changes on a request (document_requests
                          doesn't touch listing_applications.status), so
                          "Submitted — awaiting audit" looks identical whether
                          nobody has looked at it yet or staff already asked
                          for more and are waiting on the applicant. Staff
                          report, 2026-08-20: "shouldn't change from audit to
                          Collecting Documents or Documents Requested and also
                          below the last date?" */}
                      {!isDecided(a.status) && a.lastRequestedAt && <div style={{ font: '11px system-ui', color: '#b45309', marginTop: 3, whiteSpace: 'nowrap' }}>📨 requested {fmt(a.lastRequestedAt)}</div>}
                    </td>
                    <td style={td}>{a.driveFolderUrl ? <a href={a.driveFolderUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>📁</a> : <span style={{ color: '#d1d5db' }}>—</span>}</td>
                    <td style={td}>
                      {a.docCount === 0 && (
                        <button onClick={e => { e.stopPropagation(); deleteApp(a) }} disabled={deleting === a.id}
                          title="Delete this empty application"
                          style={{ cursor: deleting === a.id ? 'default' : 'pointer', font: '600 11px system-ui', color: '#b91c1c', background: 'none', border: '1px solid #fecaca', borderRadius: 6, padding: '3px 8px' }}>
                          {deleting === a.id ? '…' : '🗑 Delete'}
                        </button>
                      )}
                    </td>
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

const PROVIDED_LABEL: Record<string, string> = { applicant: 'Applicant', landlord: 'Owner', agent: 'Agent', both: 'Owner or Tenant', staff: 'Staff' }
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

// Open an application HERE, with its Drive folder, instead of only being able
// to send a link and wait. The case this covers is documents that arrive by
// email: until now they had nowhere to live, because an application only came
// into existence when the applicant used a link.
//
// No email is sent — staff are recording something that already happened.
//
// Hardened, 2026-08-20: this used to let staff open a completely bare shell
// (no email, no phone, no document) — the exact hole "Bring into MAIA" fell
// into (MANXI 605: empty, unreachable, sat for six hours). Now the lead
// applicant's email + phone are required, and the type's required document is
// collected right here, so the application reaches Submitted the moment
// staff finish this form instead of sitting as an untracked shell.
const REQUIRED_DOC: Record<string, { docKey: string; label: string }> = {
  lease: { docKey: 'signed_lease', label: 'Signed lease' },
  lease_renewal: { docKey: 'signed_lease', label: 'Signed lease' },
  purchase: { docKey: 'signed_purchase', label: 'Signed purchase agreement' },
  additional_occupant: { docKey: 'lease_addendum', label: 'Lease addendum' },
}

const OCC_LABEL: Record<string, string> = { owner_occupied: 'Owner-occupied', leased: 'Leased', vacant: 'Vacant' }
interface UnitOption {
  unit: string; accountNumber: string; ownerName: string | null
  occupancy: 'owner_occupied' | 'leased' | 'vacant' | null; occupancyKnown: boolean; tenantName: string | null
}

function StaffCreate() {
  const TYPES = [
    { key: 'lease', label: 'Lease / Rental' }, { key: 'purchase', label: 'Purchase' },
    { key: 'lease_renewal', label: 'Lease Renewal' }, { key: 'additional_occupant', label: 'Additional Occupant' },
  ]
  const [open, setOpen] = useState(false)
  const [assoc, setAssoc] = useState('MANXI')
  const [unit, setUnit] = useState('')
  const [type, setType] = useState('lease')
  const [assocList, setAssocList] = useState<{ code: string; name: string }[]>([])
  useEffect(() => {
    fetch('/api/associations').then(r => r.json())
      .then((rows: { association_code: string; association_name: string }[]) => setAssocList(rows.map(r => ({ code: r.association_code, name: r.association_name }))))
      .catch(() => setAssocList([]))
  }, [])
  // The unit list for the selected association — owner + a best-known
  // occupancy status per unit, so staff pick a real unit instead of
  // free-typing one and see who's there before opening the application.
  const [unitList, setUnitList] = useState<UnitOption[]>([])
  const [unitsLoading, setUnitsLoading] = useState(false)
  useEffect(() => {
    const a = assoc.trim().toUpperCase()
    setUnit(''); setUnitList([])
    if (!a) return
    setUnitsLoading(true)
    fetch(`/api/admin/pre-apply/units?assoc=${encodeURIComponent(a)}`, { credentials: 'include' })
      .then(r => r.json()).then(d => setUnitList(d.units ?? [])).catch(() => setUnitList([])).finally(() => setUnitsLoading(false))
  }, [assoc])
  const selectedUnit = unitList.find(u => u.unit === unit) ?? null
  const [people, setPeople] = useState([{ name: '', email: '', phone: '' }])
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // Additional occupant: does the unit's current lease already name them? If
  // so, no fresh document is required — otherwise fall back to a Lease
  // Addendum upload. Re-checked whenever the unit or the lead name changes.
  const [occCheck, setOccCheck] = useState<{ checked: boolean; found: boolean } | null>(null)
  const [occBusy, setOccBusy] = useState(false)

  const upd = (i: number, patch: Partial<{ name: string; email: string; phone: string }>) =>
    setPeople(ps => ps.map((p, j) => j === i ? { ...p, ...patch } : p))

  useEffect(() => {
    setOccCheck(null)
    if (type !== 'additional_occupant') return
    const a = assoc.trim().toUpperCase(), u = unit.trim(), name = people[0]?.name.trim()
    if (!a || !u || !name) return
    setOccBusy(true)
    const t = setTimeout(() => {
      fetch(`/api/admin/pre-apply/occupant-lease-check?assoc=${encodeURIComponent(a)}&unit=${encodeURIComponent(u)}&name=${encodeURIComponent(name)}`, { credentials: 'include' })
        .then(r => r.json()).then(d => setOccCheck(d)).catch(() => setOccCheck({ checked: false, found: false })).finally(() => setOccBusy(false))
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, assoc, unit, people[0]?.name])

  const required = REQUIRED_DOC[type]
  const needsUpload = type !== 'additional_occupant' || occCheck?.found !== true

  async function create() {
    if (!unit.trim()) { setMsg('Enter the unit.'); return }
    if (!people[0]?.name.trim()) { setMsg('Add the applicant name.'); return }
    if (!people[0]?.email.trim().includes('@')) { setMsg("Enter the lead applicant's email."); return }
    if (!people[0]?.phone.trim()) { setMsg("Enter the lead applicant's phone."); return }
    if (needsUpload && !file) { setMsg(`Upload the ${required.label.toLowerCase()}.`); return }
    setBusy(true); setMsg(null)
    try {
      const doCreate = (force: boolean) => fetch('/api/admin/pre-apply/create', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ associationCode: assoc, unit: unit.trim(), applicationType: type, applicants: people, note, ...(force ? { force: true } : {}) }),
      })
      let r = await doCreate(false)
      let j = await r.json()
      if (r.status === 409 && j.needsConfirm) {
        if (!confirm(`${j.error}\n\nStart another anyway?`)) { setBusy(false); return }
        r = await doCreate(true); j = await r.json()
      }
      if (!r.ok) throw new Error(j.error || 'failed')
      const applicationId = j.applicationId as string

      if (file) {
        const upUrl = await fetch(`/api/admin/pre-apply/${applicationId}/upload-url`, {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ doc_key: required.docKey, filename: file.name }),
        })
        const upJ = await upUrl.json(); if (!upUrl.ok) throw new Error(upJ.error || 'could not prepare the upload')
        const put = await fetch(upJ.signedUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } })
        if (!put.ok) throw new Error('the upload failed')
        const fin = await fetch(`/api/admin/pre-apply/${applicationId}/upload`, {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ doc_key: required.docKey, doc_label: required.label, storage_path: upJ.path, filename: file.name, mime_type: file.type }),
        })
        const finJ = await fin.json(); if (!fin.ok) throw new Error(finJ.error || 'could not save the upload')
      }

      // Everything the type requires is now on file — move straight to Submitted
      // instead of leaving it as an untracked 'started' shell. No note here:
      // the create step already wrote "Opened by {staff}" as the review_note,
      // and the PATCH handler only overwrites it when a note is actually given.
      await fetch(`/api/admin/pre-apply/${applicationId}`, {
        method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'request' }),
      }).catch(() => null)

      window.location.href = `/admin/pre-apply/${applicationId}`
    } catch (e) { setMsg(`Could not create: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  const inp: React.CSSProperties = { font: '13px system-ui', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 7 }
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <span style={{ font: '700 14px system-ui', color: '#1f2a44' }}>Open an application</span>
          <span style={{ font: '13px system-ui', color: '#6b7280' }}> — the same way an agent or tenant does, for documents that came by email</span>
        </div>
        <button onClick={() => setOpen(o => !o)} style={{ font: '600 13px system-ui', color: '#fff', background: open ? '#6b7280' : '#1f2a44', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }}>
          {open ? 'Cancel' : '+ New application'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={assoc} onChange={e => setAssoc(e.target.value)} style={{ ...inp, minWidth: 110, cursor: 'pointer' }}>
              {!assocList.some(a => a.code === assoc) && <option value={assoc}>{assoc}</option>}
              {assocList.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
            <select value={unit} onChange={e => setUnit(e.target.value)} disabled={unitsLoading || !unitList.length} style={{ ...inp, minWidth: 150, cursor: unitsLoading ? 'default' : 'pointer' }}>
              <option value="">{unitsLoading ? 'Loading units…' : unitList.length ? 'Select a unit…' : 'No units on file'}</option>
              {unitList.map(u => <option key={u.accountNumber} value={u.unit}>{u.unit}</option>)}
            </select>
            <select value={type} onChange={e => { setType(e.target.value); setFile(null) }} style={{ ...inp, cursor: 'pointer' }}>
              {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          {selectedUnit && (
            <div style={{ font: '12.5px system-ui', color: '#374151', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 10px' }}>
              Owner: <strong>{selectedUnit.ownerName ?? '—'}</strong>
              {' · '}
              {selectedUnit.occupancy
                ? <strong style={{ color: selectedUnit.occupancy === 'leased' ? '#5b21b6' : selectedUnit.occupancy === 'vacant' ? '#6b7280' : '#166534' }}>
                    {OCC_LABEL[selectedUnit.occupancy]}{!selectedUnit.occupancyKnown ? ' (tenant on file — not explicitly marked)' : ''}
                  </strong>
                : <span style={{ color: '#9ca3af' }}>Occupancy not on file</span>}
              {selectedUnit.tenantName && selectedUnit.occupancy === 'leased' && <> · Tenant: <strong>{selectedUnit.tenantName}</strong></>}
            </div>
          )}

          {people.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={p.name} onChange={e => upd(i, { name: e.target.value })} placeholder={i === 0 ? 'Applicant name' : 'Also on the application'} style={{ ...inp, width: 210, fontWeight: i === 0 ? 600 : 400 }} />
              <input value={p.email} onChange={e => upd(i, { email: e.target.value })} placeholder={i === 0 ? 'email (required)' : 'email (optional)'} style={{ ...inp, width: 210 }} />
              <input value={p.phone} onChange={e => upd(i, { phone: e.target.value })} placeholder={i === 0 ? 'phone (required)' : 'phone (optional)'} style={{ ...inp, width: 140 }} />
              {people.length > 1 && <button onClick={() => setPeople(ps => ps.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', color: '#9ca3af', cursor: 'pointer', font: '700 15px system-ui' }}>×</button>}
            </div>
          ))}
          <button onClick={() => setPeople(ps => [...ps, { name: '', email: '', phone: '' }])} style={{ alignSelf: 'flex-start', font: '600 12px system-ui', color: '#374151', background: '#fff', border: '1px dashed #d1d5db', borderRadius: 7, padding: '6px 12px', cursor: 'pointer' }}>+ Add another person</button>

          {type === 'additional_occupant' && (
            <div style={{ font: '12.5px system-ui', color: occCheck?.found ? '#166534' : '#92400e' }}>
              {occBusy ? 'Checking the current lease on this unit…'
                : occCheck?.found ? '✓ Found on the current lease — no extra document needed.'
                : occCheck ? 'Not found on the current lease — upload a Lease Addendum below.'
                : 'Enter the unit and the occupant’s name to check the current lease.'}
            </div>
          )}

          {needsUpload && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ font: '600 12.5px system-ui', color: '#374151' }}>{required.label}:</label>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ font: '13px system-ui' }} />
            </div>
          )}

          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note — e.g. documents received by email from the owner" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => create()} disabled={busy} style={{ font: '600 13px system-ui', color: '#fff', background: busy ? '#9ca3af' : '#166534', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: busy ? 'default' : 'pointer' }}>
              {busy ? 'Creating…' : 'Create + submit'}
            </button>
            <span style={{ font: '12px system-ui', color: '#9ca3af' }}>The applicant is not emailed — send them a link separately if you need to.</span>
          </div>
          {msg && <p style={{ font: '13px system-ui', color: '#b91c1c', margin: 0 }}>⚠ {msg}</p>}
        </div>
      )}
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
  const [assocList, setAssocList] = useState<{ code: string; name: string }[]>([])
  useEffect(() => {
    fetch('/api/associations').then(r => r.json())
      .then((rows: { association_code: string; association_name: string }[]) => setAssocList(rows.map(r => ({ code: r.association_code, name: r.association_name }))))
      .catch(() => setAssocList([]))
  }, [])
  const [copied, setCopied] = useState(false)
  const [owner, setOwner] = useState<{ name: string | null; emails: string[]; phone: string | null }[] | null>(null)
  const [ownerBusy, setOwnerBusy] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [sName, setSName] = useState('')
  const [sEmail, setSEmail] = useState('')
  const [ccOwner, setCcOwner] = useState(true)
  const [ccBoard, setCcBoard] = useState(false)
  const [sBusy, setSBusy] = useState(false)
  async function sendInvite() {
    if (!sEmail.includes('@')) { alert("Enter the applicant's email."); return }
    setSBusy(true)
    try {
      const r = await fetch('/api/admin/pre-apply/send-invite', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assoc: assoc.trim().toUpperCase(), unit: unit.trim(), name: sName, email: sEmail, lang, ccOwner, ccBoard }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      alert(`Invite sent to ${j.sentTo}${j.cc?.length ? `\nCC: ${j.cc.join(', ')}` : ''}`)
      setSendOpen(false); setSName(''); setSEmail('')
    } catch (e) { alert(`Could not send: ${(e as Error).message}`) } finally { setSBusy(false) }
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const qs = [unit ? `unit=${encodeURIComponent(unit.trim())}` : '', lang ? `lang=${lang}` : ''].filter(Boolean).join('&')
  const link = `${origin}/pre-apply/${encodeURIComponent(assoc.trim().toUpperCase())}${qs ? `?${qs}` : ''}`
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* */ } }
  const s: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 8 }

  // Look up the owner for this unit (debounced) so staff see who to contact.
  useEffect(() => {
    const a = assoc.trim().toUpperCase(), u = unit.trim()
    const t = setTimeout(() => {
      if (!a || !u) { setOwner(null); setOwnerBusy(false); return }
      setOwnerBusy(true)
      fetch(`/api/admin/pre-apply/owner-lookup?assoc=${encodeURIComponent(a)}&unit=${encodeURIComponent(u)}`, { credentials: 'include' })
        .then(r => r.json()).then(d => setOwner(d.owners ?? [])).catch(() => setOwner([])).finally(() => setOwnerBusy(false))
    }, 350)
    return () => clearTimeout(t)
  }, [assoc, unit])
  return (
    <div style={{ margin: '14px 0 20px', padding: 14, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff' }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Generate an application link (reply by email)</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={assoc} onChange={e => setAssoc(e.target.value)} style={{ ...s, minWidth: 100 }}>
          {/* A native <datalist> filters its popup by the current text, so once
              the field already held a code (defaults to MANXI) opening it only
              ever showed that one match — looked like the other associations
              had disappeared. A real <select> always lists every option. */}
          {!assocList.some(a => a.code === assoc) && <option value={assoc}>{assoc}</option>}
          {assocList.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
        </select>
        <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="Unit (e.g. 103)" style={{ ...s, width: 130 }} />
        <select value={lang} onChange={e => setLang(e.target.value)} style={s}>{LANGS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}</select>
        <input readOnly value={link} onFocus={e => e.currentTarget.select()} style={{ ...s, flex: 1, minWidth: 220, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#374151' }} />
        <button onClick={copy} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: copied ? '#059669' : '#f26a1b', color: '#fff', font: '600 13px system-ui' }}>{copied ? '✓ Copied' : 'Copy'}</button>
        <button onClick={() => setSendOpen(o => !o)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #c7d2fe', cursor: 'pointer', background: sendOpen ? '#eef2ff' : '#fff', color: '#3730a3', font: '600 13px system-ui' }}>📨 Send invite</button>
      </div>

      {sendOpen && (
        <div style={{ marginTop: 10, border: '1px solid #c7d2fe', background: '#f8faff', borderRadius: 10, padding: 12 }}>
          <div style={{ font: '700 12.5px system-ui', color: '#1f2937', marginBottom: 8 }}>Email the applicant the standard invite (with the link)</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={sName} onChange={e => setSName(e.target.value)} placeholder="Applicant name" style={{ ...s, width: 190 }} />
            <input value={sEmail} onChange={e => setSEmail(e.target.value)} type="email" placeholder="Applicant email" style={{ ...s, flex: '1 1 220px', minWidth: 200 }} />
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
            <label style={{ font: '12.5px system-ui', color: '#374151', display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={ccOwner} onChange={e => setCcOwner(e.target.checked)} /> CC owner{owner && owner[0]?.emails[0] ? ` (${owner[0].emails.join(', ')})` : ''}</label>
            <label style={{ font: '12.5px system-ui', color: '#374151', display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={ccBoard} onChange={e => setCcBoard(e.target.checked)} /> CC board</label>
          </div>
          <button onClick={sendInvite} disabled={sBusy} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: sBusy ? 'default' : 'pointer', background: sBusy ? '#c9ccd3' : '#166534', color: '#fff', font: '600 13px system-ui' }}>{sBusy ? 'Sending…' : '✉ Send invite'}</button>
        </div>
      )}
      {unit.trim() && (
        <div style={{ marginTop: 8, fontSize: 12.5 }}>
          {ownerBusy && owner === null ? <span style={{ color: '#9ca3af' }}>Looking up the owner…</span>
            : owner && owner.length > 0 ? owner.map((o, i) => (
              <div key={i} style={{ color: '#374151', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '2px 0' }}>
                <span style={{ font: '600 11px system-ui', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em' }}>👤 Owner</span>
                <strong>{o.name ?? '—'}</strong>
                {o.emails.map(e => <a key={e} href={`mailto:${e}`} style={{ color: '#2563eb', textDecoration: 'none' }}>{e}</a>)}
                {o.emails[0] && <button onClick={async () => { try { await navigator.clipboard.writeText(o.emails.join(', ')) } catch { /* */ } }} style={{ font: '600 11px system-ui', color: '#6b7280', background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '1px 7px', cursor: 'pointer' }}>copy email</button>}
                {o.phone && <span style={{ color: '#9ca3af' }}>· {o.phone}</span>}
              </div>
            )) : <span style={{ color: '#9ca3af' }}>No owner on file for this unit.</span>}
        </div>
      )}
      <p style={{ fontSize: 11.5, color: '#9ca3af', margin: '8px 0 0' }}>One link per unit. The applicant identifies who they are, verifies, then picks the application type — MAIA files everything into the unit&apos;s On Going Applications Drive folder.</p>
    </div>
  )
}
