'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import FloorPlanGrid, { type AuditUnitEnriched } from './FloorPlanGrid'
import { formatBalance, balanceColor, COLLECTIONS_BALANCE_NOTE } from '@/lib/format-currency'
import BoardCertWhyExpired from '@/components/BoardCertWhyExpired'

type Filter = 'complete' | 'partial' | 'missing' | 'leased' | 'vacant' | 'collections' | 'expired' | 'expiring'

const matches: Record<Filter, (u: AuditUnitEnriched) => boolean> = {
  complete:    u => u.missingCount === 0,
  partial:     u => u.missingCount > 0 && u.missingCount <= 2,
  missing:     u => u.missingCount > 2,
  leased:      u => u.occupancy === 'leased',
  vacant:      u => u.occupancy === 'vacant',
  collections: u => u.inCollections,
  expired:     u => u.expiredCount > 0,
  expiring:    u => u.expiringCount > 0,
}

export default function UnitsAuditClient({ assoc }: { assoc?: string }) {
  const [data, setData] = useState<{ associationName: string; persona: string; units: AuditUnitEnriched[] } | null>(null)
  const [err, setErr]   = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter | null>(null)

  useEffect(() => {
    const q = assoc ? `?assoc=${encodeURIComponent(assoc)}` : ''
    fetch(`/api/units/audit${q}`, { credentials: 'include' })
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`); return r.json() })
      .then(setData)
      .catch(e => setErr(String(e.message ?? e)))
  }, [assoc])

  const stats = useMemo(() => {
    const u = data?.units ?? []
    return {
      total:       u.length,
      complete:    u.filter(matches.complete).length,
      partial:     u.filter(matches.partial).length,
      missing:     u.filter(matches.missing).length,
      leased:      u.filter(matches.leased).length,
      vacant:      u.filter(matches.vacant).length,
      collections: u.filter(matches.collections).length,
      expired:     u.filter(matches.expired).length,
      expiring:    u.filter(matches.expiring).length,
    }
  }, [data])

  const filtered = useMemo(
    () => (filter && data ? data.units.filter(matches[filter]) : []),
    [filter, data],
  )

  if (err)   return <div style={{ padding: 24, color: '#991b1b', font: '500 14px system-ui' }}>Could not load units: {err}</div>
  if (!data) return <div style={{ padding: 24, color: '#6b7280', font: '500 14px system-ui' }}>Loading units…</div>

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px', font: '400 14px system-ui' }}>
      <h1 style={{ font: '700 22px system-ui', margin: '0 0 2px' }}>{data.associationName}</h1>
      <div style={{ color: '#6b7280', marginBottom: 12 }}>Unit audit — {stats.total} units · click a block to list those units · click any unit to open its full record in a new tab</div>

      <ApplicationsBanner assoc={assoc} />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <Stat f="complete"    active={filter} set={setFilter} label="Docs complete"  value={stats.complete}    color="#166534" bg="#dcfce7" />
        <Stat f="partial"     active={filter} set={setFilter} label="1–2 missing"    value={stats.partial}     color="#854d0e" bg="#fef9c3" />
        <Stat f="missing"     active={filter} set={setFilter} label="3+ missing"     value={stats.missing}     color="#991b1b" bg="#fee2e2" />
        <Stat f="expired"     active={filter} set={setFilter} label="Expired"        value={stats.expired}     color="#991b1b" bg="#fee2e2" />
        <Stat f="expiring"    active={filter} set={setFilter} label="Expiring ≤30d"  value={stats.expiring}    color="#9a3412" bg="#ffedd5" />
        <Stat f="leased"      active={filter} set={setFilter} label="Leased"         value={stats.leased}      color="#5b21b6" bg="#ede9fe" />
        <Stat f="vacant"      active={filter} set={setFilter} label="Vacant"         value={stats.vacant}      color="#374151" bg="#f3f4f6" />
        <Stat f="collections" active={filter} set={setFilter} label="In collections" value={stats.collections} color="#991b1b" bg="#fee2e2" />
      </div>

      <BoardCertBanner assoc={assoc} />

      {filter
        ? <FilterPanel filter={filter} units={filtered} onClose={() => setFilter(null)} />
        : <FloorPlanGrid units={data.units} />}
    </div>
  )
}

interface BoardCertDoc { doc_type: string; status: string; certificate_date: string | null }
interface BoardCertMember { id: string; name: string | null; role: string | null; state: 'on_file' | 'expiring' | 'expired' | 'missing'; initialCertExpiration: string | null; continuingEdDue: string | null; continuingEdOverdue: boolean; docs: BoardCertDoc[] }
interface BoardCertData { kind: 'condo' | 'hoa'; canUpload: boolean; expiredCount: number; expiringCount: number; missingCount: number; members: BoardCertMember[] }

// Documents the DBPR rules describe — the certification form is condo-only.
const CERT_DOC_TYPES: { key: string; label: string; kinds: ('condo' | 'hoa')[] }[] = [
  { key: 'education_certificate', label: 'Education certificate', kinds: ['condo', 'hoa'] },
  { key: 'certification_form',    label: 'Certification form',    kinds: ['condo'] },
  { key: 'continuing_education',  label: 'Continuing education',   kinds: ['condo', 'hoa'] },
]
const CERT_STATE: Record<BoardCertMember['state'], { label: string; color: string }> = {
  on_file:  { label: 'On file',  color: '#166534' },
  expiring: { label: 'Expiring', color: '#92400e' },
  expired:  { label: 'Expired',  color: '#991b1b' },
  missing:  { label: 'Missing',  color: '#6b7280' },
}

// Board-education standing on the audit page. Read-only for viewers; on-site
// managers / board members with upload permission also get a separate labeled
// upload box per required document (kind-aware). Type confirmation + approval
// stay on the admin Association Hub.
// Entry to the board / on-site-manager application review + approval queue.
function ApplicationsBanner({ assoc }: { assoc?: string }) {
  const [count, setCount] = useState<{ total: number; pending: number } | null>(null)
  useEffect(() => {
    const q = assoc ? `?assoc=${encodeURIComponent(assoc)}` : ''
    fetch(`/api/units/pre-apply${q}`, { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(d => {
      if (!d?.applications) return
      setCount({ total: d.applications.length, pending: d.applications.filter((a: { status: string }) => a.status === 'submitted' || a.status === 'under_review').length })
    }).catch(() => {})
  }, [assoc])
  if (!count || count.total === 0) return null
  const href = `/units/applications${assoc ? `?assoc=${encodeURIComponent(assoc)}` : ''}`
  return (
    <Link href={href} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px', marginBottom: 16, background: count.pending ? '#fffbeb' : '#f0fdf4', textDecoration: 'none' }}>
      <span style={{ font: '600 13px system-ui', color: '#374151' }}>📋 Applications to review{count.pending ? <span style={{ color: '#991b1b' }}> · {count.pending} awaiting your decision</span> : <span style={{ color: '#166534' }}> · all handled</span>}</span>
      <span style={{ font: '600 12px system-ui', color: '#2563eb' }}>Open →</span>
    </Link>
  )
}

function BoardCertBanner({ assoc }: { assoc?: string }) {
  const [data, setData] = useState<BoardCertData | null>(null)
  const [open, setOpen] = useState(false)
  const load = useCallback(() => {
    const q = assoc ? `?assoc=${encodeURIComponent(assoc)}` : ''
    fetch(`/api/units/board-certifications${q}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null).then(setData).catch(() => setData(null))
  }, [assoc])
  useEffect(load, [load])
  if (!data || data.members.length === 0) return null
  const needAttention = data.expiredCount + data.missingCount
  const allGood = needAttention === 0 && data.expiringCount === 0

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px', marginBottom: 16, background: allGood ? '#f0fdf4' : '#fffbeb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left', gap: 8 }}>
          <span style={{ font: '600 13px system-ui', color: '#374151' }}>
            🎓 Board education certificates{' '}
            {allGood
              ? <span style={{ color: '#166534' }}>· all {data.members.length} on file</span>
              : <span style={{ color: '#991b1b' }}>· {needAttention} need attention{data.expiringCount ? `, ${data.expiringCount} expiring` : ''}</span>}
          </span>
          <span style={{ font: '11px system-ui', color: '#6b7280' }}>{open ? 'hide' : 'show'}</span>
        </button>
        {!allGood && <BoardCertWhyExpired kind={data.kind} />}
      </div>
      {open && (() => {
        const today = new Date().toISOString().slice(0, 10)
        const c = new Date(`${today}T00:00:00Z`); c.setUTCDate(c.getUTCDate() + 60)
        const cutoff60 = c.toISOString().slice(0, 10)
        return (
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.members.map((m, i) => {
            const s = CERT_STATE[m.state]
            // When "expiring" is driven by an overdue continuing-ed requirement
            // (not the initial certificate, which may be years out), say so and
            // show the continuing-ed due date — not the far-off cert expiry.
            const ceOverdue = !!(m.continuingEdDue && m.continuingEdDue < today)
            const initialFarOff = !!(m.initialCertExpiration && m.initialCertExpiration > cutoff60)
            const ceDriven = m.state === 'expiring' && ceOverdue && initialFarOff
            const label = ceDriven ? 'Cont. ed due' : s.label
            const detail = m.state === 'missing' ? ''
              : ceDriven ? ` · due ${m.continuingEdDue}`
              : m.initialCertExpiration ? ` · exp ${m.initialCertExpiration}` : ''
            return (
              <li key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid #f3f4f6', paddingTop: i === 0 ? 0 : 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, font: '12px system-ui', color: '#374151' }}>
                  <span>{m.name ?? '—'}{m.role ? ` · ${m.role}` : ''}</span>
                  <span style={{ color: s.color, fontWeight: 600 }}>{label}{detail}</span>
                </div>
                {data.canUpload && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                    {CERT_DOC_TYPES.filter(dt => dt.kinds.includes(data.kind)).map(dt => {
                      const doc = m.docs.filter(d => d.doc_type === dt.key).sort((a, b) => ((a.certificate_date ?? '') < (b.certificate_date ?? '') ? 1 : -1))[0] ?? null
                      const exp = dt.key === 'continuing_education'
                        ? (m.continuingEdDue ? { label: m.continuingEdOverdue ? 'CE overdue since' : 'Next CE due', value: m.continuingEdDue, warn: m.continuingEdOverdue } : null)
                        : (m.initialCertExpiration ? { label: 'Valid through', value: m.initialCertExpiration, warn: m.initialCertExpiration < today } : null)
                      return <CertDocUpload key={dt.key} assoc={assoc} memberId={m.id} docType={dt.key} label={dt.label} doc={doc} exp={exp} onDone={load} />
                    })}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        )
      })()}
    </div>
  )
}

/** One labeled, fixed-type board-cert upload box for the /units audit (on-site
 *  manager / board). No dropdown — the document type is the box. Files a PENDING
 *  cert for staff review via the units-auth'd routes. */
function CertDocUpload({ assoc, memberId, docType, label, doc, exp, onDone }: {
  assoc?: string; memberId: string; docType: string; label: string
  doc: BoardCertDoc | null; exp: { label: string; value: string; warn: boolean } | null; onDone: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg]   = useState<string | null>(null)

  const submit = async () => {
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      const u = await fetch('/api/units/board-certifications/upload-url', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assoc, memberId, filename: file.name }),
      })
      const uj = await u.json(); if (!u.ok) throw new Error(uj.error || 'upload-url failed')
      const put = await fetch(uj.signedUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } })
      if (!put.ok) throw new Error('upload failed')
      const s = await fetch('/api/units/board-certifications/submit', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assoc, memberId, doc_type: docType, storage_path: uj.path, filename: file.name, mime_type: file.type }),
      })
      if (!s.ok) throw new Error((await s.json()).error || 'submit failed')
      setMsg('Received — PMI will review it.'); setFile(null); onDone()
    } catch (e) { setMsg(`Could not upload: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  return (
    <div style={{ border: `1px solid ${doc ? '#e5e7eb' : '#fde68a'}`, background: doc ? '#fff' : '#fffbeb', borderRadius: 8, padding: '7px 9px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ font: '700 11px system-ui', color: '#111827' }}>{label}</span>
        {exp
          ? <span style={{ font: '600 11px system-ui', color: exp.warn ? '#b91c1c' : '#166534' }}>{exp.label} {exp.value}</span>
          : <span style={{ font: '600 11px system-ui', color: doc ? '#166534' : '#92400e' }}>{doc ? doc.status : 'Not on file'}</span>}
      </div>
      <div style={{ marginTop: 5, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ font: '11px system-ui', maxWidth: 190 }} />
        <button onClick={submit} disabled={!file || busy}
          style={{ font: '600 11px system-ui', background: file && !busy ? '#f26a1b' : '#e5e7eb', color: file && !busy ? '#fff' : '#9ca3af', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: file && !busy ? 'pointer' : 'default' }}>
          {busy ? 'Uploading…' : doc ? 'Upload newer' : 'Upload'}
        </button>
        {msg && <span style={{ font: '11px system-ui', color: msg.startsWith('Could not') ? '#991b1b' : '#166534' }}>{msg}</span>}
      </div>
    </div>
  )
}

function Stat({ f, active, set, label, value, color, bg }: {
  f: Filter; active: Filter | null; set: (v: Filter | null) => void
  label: string; value: number; color: string; bg: string
}) {
  const on = active === f
  return (
    <button
      onClick={() => set(on ? null : f)}
      style={{
        background: bg, color, borderRadius: 10, padding: '8px 14px', minWidth: 92, textAlign: 'left',
        border: on ? `2px solid ${color}` : `2px solid ${color}55`, cursor: 'pointer', font: 'inherit',
      }}
    >
      <div style={{ font: '700 20px system-ui' }}>{value}</div>
      <div style={{ font: '600 11px system-ui' }}>{label}</div>
    </button>
  )
}

const TITLES: Record<Filter, string> = {
  complete: 'Units with all documents on file', partial: 'Units missing 1–2 documents',
  missing: 'Units missing 3+ documents', leased: 'Leased units', vacant: 'Vacant units',
  collections: 'Units in collections', expired: 'Units with expired documents',
  expiring: 'Units with documents expiring in the next 30 days',
}

function FilterPanel({ filter, units, onClose }: { filter: Filter; units: AuditUnitEnriched[]; onClose: () => void }) {
  // Which owners we can email (units with a request action shown).
  const showRequest = filter === 'expired' || filter === 'expiring' || filter === 'missing' || filter === 'partial'
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ font: '600 14px system-ui' }}>{TITLES[filter]} <span style={{ color: '#6b7280', fontWeight: 400 }}>· {units.length}</span></div>
        <div style={{ display: 'flex', gap: 8 }}>
          {showRequest && units.length > 0 && <BulkRequest units={units} />}
          <button onClick={onClose} style={{ font: '500 13px system-ui', color: '#374151', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, padding: '5px 12px', cursor: 'pointer' }}>← Back to grid</button>
        </div>
      </div>
      {units.some(u => u.inCollections) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 16px', background: '#fffbeb', borderBottom: '1px solid #fde68a', font: '400 12px system-ui', color: '#92400e', lineHeight: 1.45 }}>
          <span aria-hidden>⚠</span><span>{COLLECTIONS_BALANCE_NOTE}</span>
        </div>
      )}
      {units.length === 0
        ? <div style={{ padding: 24, color: '#6b7280', textAlign: 'center' }}>No units in this category.</div>
        : (filter === 'leased' || filter === 'vacant' || filter === 'collections')
          ? <UnitTable units={units} />
          : <div>{units.map(u => <UnitRow key={u.accountNumber} u={u} filter={filter} showRequest={showRequest} />)}</div>}
    </div>
  )
}

const money = (n: number | null) => formatBalance(n, 0)

// Richer drill-down for occupancy / collections filters: one row per unit with
// the columns staff want at a glance, before opening the full record.
function UnitTable({ units }: { units: AuditUnitEnriched[] }) {
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', font: '600 11px system-ui', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '9px 12px', font: '400 13px system-ui', color: '#374151', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={th}>Unit</th><th style={th}>Owner</th><th style={th}>Tenant</th>
          <th style={th}>Lease end</th><th style={{ ...th, textAlign: 'right' }}>Balance</th>
          <th style={th}>Status</th><th style={{ ...th, textAlign: 'center' }}>Missing</th>
        </tr></thead>
        <tbody>
          {units.map(u => (
            <tr key={u.accountNumber}>
              <td style={td}>
                <a href={`/units/unit?account=${encodeURIComponent(u.accountNumber)}&assoc=${encodeURIComponent(u.associationCode)}`}
                   target="_blank" rel="noopener noreferrer" style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                  Unit {u.unit ?? u.accountNumber} ↗
                </a>
              </td>
              <td style={td}>{u.ownerName || '—'}</td>
              <td style={{ ...td, color: u.occupancy === 'leased' ? '#5b21b6' : '#9ca3af' }}>{u.tenantName || '—'}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{u.leaseEndDate || '—'}</td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', color: balanceColor(u.balance) }}>
                {money(u.balance)}
                {u.inCollections && <span title={COLLECTIONS_BALANCE_NOTE} style={{ marginLeft: 4, cursor: 'help', color: '#b45309', font: '700 10px system-ui' }}>⚠</span>}
              </td>
              <td style={td}>{u.inCollections ? <span style={{ font: '600 11px system-ui', color: '#dc2626', background: '#fee2e2', borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>⛔ collections</span> : <span style={{ color: '#9ca3af', font: '400 12px system-ui' }}>{u.occupancy ?? '—'}</span>}</td>
              <td style={{ ...td, textAlign: 'center', fontWeight: 600, color: u.missingCount > 0 ? '#b45309' : '#16a34a' }}>{u.missingCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UnitRow({ u, filter, showRequest }: { u: AuditUnitEnriched; filter: Filter; showRequest: boolean }) {
  const dated = (filter === 'expired' || filter === 'expiring')
    ? u.dated.filter(d => d.state === (filter === 'expired' ? 'expired' : 'expiring'))
    : []
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ minWidth: 0 }}>
        <a href={`/units/unit?account=${encodeURIComponent(u.accountNumber)}&assoc=${encodeURIComponent(u.associationCode)}`}
           target="_blank" rel="noopener noreferrer"
           style={{ font: '600 14px system-ui', color: '#1d4ed8', textDecoration: 'none' }}>
          Unit {u.unit ?? u.accountNumber} ↗
        </a>
        <span style={{ color: '#6b7280', marginLeft: 8, font: '400 13px system-ui' }}>{u.ownerName || '—'}</span>
        <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {dated.length > 0
            ? dated.map(d => <DocChip key={d.key} label={d.label} date={d.expiryDate} state={d.state} />)
            : (filter === 'missing' || filter === 'partial')
              ? u.missing.map(m => <span key={m.key} style={{ font: '500 11px system-ui', color: '#6b7280', background: '#f3f4f6', borderRadius: 6, padding: '2px 7px' }}>{m.label}</span>)
              : <span style={{ font: '400 12px system-ui', color: '#9ca3af' }}>{u.occupancy ?? '—'}{u.inCollections ? ' · in collections' : ''}</span>}
        </div>
      </div>
      {showRequest && <RequestButton account={u.accountNumber} assoc={u.associationCode} />}
    </div>
  )
}

function DocChip({ label, date, state }: { label: string; date: string; state: string }) {
  const c = state === 'expired' ? { bg: '#fee2e2', fg: '#991b1b' } : { bg: '#ffedd5', fg: '#9a3412' }
  return (
    <span style={{ font: '600 11px system-ui', color: c.fg, background: c.bg, borderRadius: 6, padding: '2px 7px' }}>
      {label} · {state === 'expired' ? 'expired' : 'expires'} {date}
    </span>
  )
}

function RequestButton({ account, assoc }: { account: string; assoc: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [msg, setMsg] = useState<string | null>(null)
  const send = async () => {
    setState('sending'); setMsg(null)
    try {
      const r = await fetch('/api/units/owner-outreach', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account, assoc }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setState('sent'); setMsg(j.sentTo ? `Sent to ${j.sentTo}` : 'Sent')
    } catch (e) { setState('error'); setMsg(String((e as Error).message)) }
  }
  return (
    <div style={{ textAlign: 'right', flexShrink: 0 }}>
      <button onClick={send} disabled={state === 'sending' || state === 'sent'}
        style={{ font: '600 12px system-ui', color: state === 'sent' ? '#166534' : '#fff', background: state === 'sent' ? '#dcfce7' : '#1d4ed8', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: state === 'sent' ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
        {state === 'sending' ? 'Sending…' : state === 'sent' ? '✓ Emailed owner' : 'Request update'}
      </button>
      {msg && <div style={{ font: '400 10px system-ui', color: state === 'error' ? '#991b1b' : '#6b7280', marginTop: 3, maxWidth: 160 }}>{msg}</div>}
    </div>
  )
}

function BulkRequest({ units }: { units: AuditUnitEnriched[] }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null)
  const run = async () => {
    if (!confirm(`Email all ${units.length} owners a request to update their records?`)) return
    setState('sending')
    let sent = 0, failed = 0
    for (const u of units) {
      try {
        const r = await fetch('/api/units/owner-outreach', {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ account: u.accountNumber, assoc: u.associationCode }),
        })
        if (r.ok) sent++; else failed++
      } catch { failed++ }
    }
    setState('done'); setResult({ sent, failed })
  }
  if (state === 'done' && result) return <span style={{ font: '500 12px system-ui', color: '#166534' }}>✓ Emailed {result.sent}{result.failed ? ` · ${result.failed} failed` : ''}</span>
  return (
    <button onClick={run} disabled={state === 'sending'}
      style={{ font: '600 12px system-ui', color: '#fff', background: '#1d4ed8', border: 'none', borderRadius: 8, padding: '5px 12px', cursor: 'pointer' }}>
      {state === 'sending' ? 'Emailing…' : `Request from all ${units.length}`}
    </button>
  )
}
