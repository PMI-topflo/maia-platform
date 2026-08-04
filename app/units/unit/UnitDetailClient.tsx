'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AuditUnit } from '@/lib/association-audit'
import { DocumentPreviewTrigger } from '@/components/DocumentPreviewTrigger'
import { formatBalance, balanceColor } from '@/lib/format-currency'

type Unit = AuditUnit & { balance: number | null; inCollections: boolean }
interface Submission {
  id: string; item_key: string; scope: string; filename: string | null
  submitted_by_persona: string; submitted_by_name: string | null
  ai_verdict: string | null; ai_identified_as: string | null; ai_expiration_date: string | null; ai_summary: string | null
  status: string; reviewed_by: string | null; review_note: string | null; created_at: string
}
interface Data {
  associationName: string; persona: string; canUpload: boolean; canReview: boolean
  unit: Unit; submissions: Submission[]
  contacts: { name: string; phones: string[]; emails: string[] }[]
  ownerEmail: string | null
  ownerPreviewPath: string
  tenantMissing: { key: string; label: string }[]
  tenantRecord: { tenant_name: string | null; tenant_phone: string | null; tenant_email: string | null; lease_start: string | null; lease_end: string | null; updated_by: string | null; updated_at: string | null } | null
}

const OCC = [
  { key: 'owner_occupied', label: 'Owner-occupied' },
  { key: 'leased',         label: 'Leased' },
  { key: 'vacant',         label: 'Vacant' },
] as const

// CINC display: positive = owed (blue), negative = credit (red, parentheses).
const money = (n: number | null) => formatBalance(n, 2)

export default function UnitDetailClient({ account, assoc }: { account: string; assoc: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr]   = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/units/unit?account=${encodeURIComponent(account)}&assoc=${encodeURIComponent(assoc)}`, { credentials: 'include' })
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`); return r.json() })
      .then(setData).catch(e => setErr(String(e.message ?? e)))
  }, [account, assoc])
  useEffect(load, [load])

  const setOccupancy = async (status: string) => {
    setBusy('occ')
    try {
      const r = await fetch('/api/units/occupancy', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, assoc, status }) })
      if (!r.ok) throw new Error((await r.json()).error || 'failed')
      load()
    } catch (e) { alert(`Could not update occupancy: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  const review = async (id: string, decision: 'approve' | 'reject') => {
    const note = decision === 'reject' ? (prompt('Reason for rejecting (optional):') ?? '') : ''
    setBusy(id)
    try {
      const r = await fetch(`/api/units/documents/${id}/review`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision, note, assoc }) })
      if (!r.ok) throw new Error((await r.json()).error || 'failed')
      load()
    } catch (e) { alert(`Could not ${decision}: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  const emailOwner = async () => {
    if (!confirm(`Email the owner (${data?.ownerEmail}) a link to confirm occupancy, tenant info, and upload their documents?`)) return
    setBusy('email')
    try {
      const r = await fetch('/api/units/owner-outreach', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, assoc }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      alert(`Sent to ${j.sentTo}. They'll be asked how the unit is used, then to upload what's missing.`)
    } catch (e) { alert(`Could not email owner: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  const sendLeasePacket = async () => {
    if (!confirm('Email the owner and the tenant their links to e-sign the Landlord–Tenant Agreement?')) return
    setBusy('packet')
    try {
      const r = await fetch('/api/units/lease-packet/send', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, assoc }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      const parts = [j.sent.length ? `Sent: ${j.sent.join(', ')}` : '', j.skipped.length ? `Skipped: ${j.skipped.join(', ')}` : ''].filter(Boolean)
      alert(parts.join('\n') || 'Packet created.')
    } catch (e) { alert(`Could not send lease packet: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  if (err)   return <Shell><div style={{ color: '#991b1b' }}>Could not load unit: {err}</div></Shell>
  if (!data) return <Shell><div style={{ color: '#6b7280' }}>Loading…</div></Shell>
  const u = data.unit

  return (
    <Shell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ font: '700 24px system-ui', margin: 0 }}>Unit {u.unit}</h1>
          <div style={{ color: '#6b7280', font: '500 13px system-ui' }}>{data.associationName} · {u.accountNumber}{u.floor != null ? ` · Floor ${u.floor}, line ${String(u.line).padStart(2, '0')}` : ''}</div>
        </div>
        <a href={`/units?assoc=${encodeURIComponent(assoc)}`} style={{ font: '500 13px system-ui', color: '#2563eb', textDecoration: 'none' }}>← Back to building</a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginTop: 18 }}>
        <Card title={data.contacts.length > 1 ? 'Owners' : 'Owner'}>
          {data.contacts.length === 0 ? (u.ownerName || '—') : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.contacts.map((c, i) => (
                <div key={i} style={{ paddingTop: i ? 8 : 0, borderTop: i ? '1px solid #f3f4f6' : 'none' }}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  {c.phones.map(p => (
                    <div key={p} style={{ font: '500 13px system-ui', color: '#374151' }}>
                      📞 <a href={`tel:${p}`} style={{ color: '#2563eb', textDecoration: 'none' }}>{p}</a>
                    </div>
                  ))}
                  {c.emails.map(e => (
                    <div key={e} style={{ font: '500 13px system-ui', color: '#374151' }}>
                      ✉ <a href={`mailto:${e}`} style={{ color: '#2563eb', textDecoration: 'none' }}>{e}</a>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Balance">
          <span style={{ color: balanceColor(u.balance), fontWeight: 700 }}>{money(u.balance)}</span>
          {u.inCollections && <span style={{ marginLeft: 8, font: '700 11px system-ui', color: '#fff', background: '#dc2626', borderRadius: 6, padding: '2px 6px' }}>IN COLLECTIONS</span>}
        </Card>
        {u.occupancy === 'leased' && <Card title="Tenant">{u.tenantName || '—'}{u.leaseEndDate ? ` · lease ends ${u.leaseEndDate}` : ''}</Card>}
        {data.tenantRecord && (data.tenantRecord.tenant_name || data.tenantRecord.lease_end) && (
          <Card title="Tenant on file (confirm)">
            <div style={{ fontWeight: 600 }}>{data.tenantRecord.tenant_name || '—'}</div>
            {(data.tenantRecord.lease_start || data.tenantRecord.lease_end) && (
              <div style={{ font: '500 13px system-ui', color: '#374151' }}>Lease {data.tenantRecord.lease_start || '?'} → {data.tenantRecord.lease_end || '?'}</div>
            )}
            {data.tenantRecord.tenant_phone && <div style={{ font: '500 13px system-ui', color: '#374151' }}>📞 {data.tenantRecord.tenant_phone}</div>}
            {data.tenantRecord.tenant_email && <div style={{ font: '500 13px system-ui', color: '#374151' }}>✉ {data.tenantRecord.tenant_email}</div>}
            {data.tenantRecord.updated_by && <div style={{ font: '400 11px system-ui', color: '#9ca3af', marginTop: 4 }}>source: {data.tenantRecord.updated_by}</div>}
          </Card>
        )}
      </div>

      {/* Lease-packet e-signature — leased units only. Emails the owner AND
          the tenant their links to e-sign the Landlord–Tenant Agreement; the
          Rent Demand is generated on demand (owner delinquency). */}
      {u.occupancy === 'leased' && (
        <div style={{ marginTop: 18, padding: 16, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff' }}>
          <div style={{ font: '700 15px system-ui', color: '#1f2a44' }}>Landlord–Tenant Agreement (e-signature)</div>
          <div style={{ font: '400 13px system-ui', color: '#6b7280', margin: '4px 0 12px' }}>
            Sends the owner and the tenant each a link to review and electronically sign the Agreement. When both sign, it&apos;s filed against this unit (expiry tracks the lease end).
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={sendLeasePacket} disabled={busy === 'packet'}
              style={{ padding: '10px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#f26a1b', color: '#fff', font: '600 13px system-ui' }}>
              {busy === 'packet' ? 'Sending…' : 'Send lease packet to owner & tenant'}
            </button>
            <a href={`/api/units/lease-packet/rent-demand?account=${encodeURIComponent(account)}&assoc=${encodeURIComponent(assoc)}`} target="_blank" rel="noreferrer"
              style={{ font: '600 13px system-ui', color: '#b91c1c', textDecoration: 'none' }}>
              Generate Rent Demand Notice (PDF) →
            </a>
          </div>
          {!data.tenantRecord?.tenant_email && (
            <div style={{ font: '500 12px system-ui', color: '#b45309', marginTop: 10 }}>⚠ No tenant email on file — only the owner will receive a link until a tenant email is added.</div>
          )}
        </div>
      )}

      {/* Ledger / collections. In collections → send board/managers/staff to
          the Axela collections platform (their login) instead of the statement.
          Link to the platform root — it starts a fresh OIDC login; the full
          authorize URL carries one-time PKCE/nonce/state that would expire. */}
      <div style={{ marginTop: 16 }}>
        {u.inCollections ? (
          <a href="https://platform.axela.tech" target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', textDecoration: 'none', font: '600 14px system-ui' }}>
            ⛔ In collections — open in Axela
            <span style={{ font: '500 12px system-ui', color: '#b91c1c' }}>platform.axela.tech · (800) 875-9221 →</span>
          </a>
        ) : (
          <a href={`/api/units/ledger?account=${encodeURIComponent(account)}&assoc=${encodeURIComponent(assoc)}`} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#0f1729', color: '#fff', borderRadius: 10, padding: '12px 16px', textDecoration: 'none', font: '600 14px system-ui' }}>
            📄 View full ledger (PDF) →
          </a>
        )}
      </div>

      {/* Owner outreach — email the owner the self-service page (asks
          occupancy first, then tenant info if leased, then uploads). */}
      <Section title="Owner records">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={emailOwner} disabled={busy === 'email' || !data.ownerEmail}
            style={{ padding: '10px 16px', borderRadius: 8, border: 'none', cursor: data.ownerEmail ? 'pointer' : 'not-allowed', background: data.ownerEmail ? '#f26a1b' : '#e5e7eb', color: data.ownerEmail ? '#fff' : '#9ca3af', font: '600 13px system-ui' }}>
            {busy === 'email' ? 'Sending…' : '📧 Email owner to confirm / update records'}
          </button>
          <a href={data.ownerPreviewPath} target="_blank" rel="noopener noreferrer" style={{ font: '600 13px system-ui', color: '#2563eb', textDecoration: 'none' }}>
            👁 Preview the page they&rsquo;ll get →
          </a>
          <span style={{ font: '500 12px system-ui', color: '#6b7280' }}>
            {data.ownerEmail ? `Goes to ${data.ownerEmail}` : 'No owner email on file'}
          </span>
        </div>
        <p style={{ font: '500 12px system-ui', color: '#9ca3af', margin: '8px 0 0' }}>
          The owner is asked how the unit is used (owner-occupied / leased / vacant); if leased, they enter tenant contact info — then upload anything missing.
        </p>
      </Section>

      {/* Occupancy editor */}
      <Section title="Occupancy">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {OCC.map(o => (
            <button key={o.key} onClick={() => setOccupancy(o.key)} disabled={busy === 'occ'}
              style={{ padding: '8px 14px', borderRadius: 8, cursor: 'pointer', font: '600 13px system-ui',
                border: u.occupancy === o.key ? '2px solid #2563eb' : '1px solid #d1d5db',
                background: u.occupancy === o.key ? '#eff6ff' : '#fff', color: u.occupancy === o.key ? '#1d4ed8' : '#374151' }}>
              {o.label}
            </button>
          ))}
          {!u.occupancy && <span style={{ alignSelf: 'center', color: '#b45309', font: '500 13px system-ui' }}>Not set — pick one</span>}
        </div>
      </Section>

      {/* Documents */}
      <Section title={`Documents (${u.onFileKeys.length}/${u.requiredKeys.length} on file)`}>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {u.requiredKeys.map(k => {
            const have = u.onFileKeys.includes(k)
            const label = u.missing.find(m => m.key === k)?.label ?? k
            return (
              <li key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', font: '500 14px system-ui' }}>
                <span style={{ color: have ? '#16a34a' : '#dc2626', fontWeight: 700 }}>{have ? '✓' : '✕'}</span>
                <span style={{ color: have ? '#374151' : '#991b1b' }}>{label}</span>
              </li>
            )
          })}
          {u.requiredKeys.length === 0 && <li style={{ color: '#6b7280' }}>No required documents configured.</li>}
        </ul>
      </Section>

      {/* Documents on file — the actual filed files with their expiration, so
          the board can preview them here (no Google account needed). */}
      {u.docs.filter(d => d.driveUrl || d.expiryDate).length > 0 && (
        <Section title="Documents on file">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {u.docs.filter(d => d.driveUrl || d.expiryDate).map(d => {
              const col = d.state === 'expired' ? '#dc2626' : d.state === 'expiring' ? '#d97706' : '#16a34a'
              return (
                <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid #f3f4f6' }}>
                  <span style={{ font: '600 14px system-ui', minWidth: 190 }}>{d.label}</span>
                  {d.expiryDate
                    ? <span style={{ font: '600 12px system-ui', color: col }}>{d.state === 'expired' ? 'Expired' : d.state === 'expiring' ? 'Expiring' : 'Expires'} {d.expiryDate}</span>
                    : <span style={{ font: '500 12px system-ui', color: '#9ca3af' }}>no expiry</span>}
                  {d.driveUrl && (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
                      <DocumentPreviewTrigger label="👁 Preview" className="rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        previewUrl={`/api/units/document-preview?account=${encodeURIComponent(account)}&assoc=${encodeURIComponent(assoc)}&key=${encodeURIComponent(d.key)}`} />
                      <a href={d.driveUrl} target="_blank" rel="noreferrer" style={{ font: '600 12px system-ui', color: '#2563eb', textDecoration: 'none' }}>↗ Open</a>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* Upload — unit docs, plus TENANT docs when the unit is leased so the
          manager can upload tenant files too. */}
      {data.canUpload && (
        <Section title="Upload a document">
          <UploadForm account={account} assoc={assoc}
            items={[
              ...u.requiredKeys.map(k => ({ key: k, scope: 'unit' as const, label: u.missing.find(m => m.key === k)?.label ?? k })),
              ...data.tenantMissing.map(t => ({ key: t.key, scope: 'tenant' as const, label: `Tenant — ${t.label}` })),
            ]}
            onDone={load} />
          {u.occupancy === 'leased' && (
            <p style={{ font: '500 12px system-ui', color: '#9ca3af', margin: '8px 0 0' }}>
              Leased unit — &ldquo;Tenant —&hellip;&rdquo; items file against the tenant&rsquo;s record.
            </p>
          )}
        </Section>
      )}

      {/* Pending / reviewed submissions */}
      {data.submissions.length > 0 && (
        <Section title="Uploaded documents & review">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.submissions.map(s => (
              <div key={s.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <DocumentPreviewTrigger
                    label={`👁 ${s.filename ?? s.item_key}`}
                    previewUrl={`/api/units/documents/${s.id}/preview?assoc=${encodeURIComponent(assoc)}`}
                    className="unit-doc-preview-link"
                    style={{ font: '600 14px system-ui', color: '#2563eb', background: 'none', border: 'none', padding: 0, textAlign: 'left' }}
                  />
                  <StatusPill status={s.status} />
                </div>
                <div style={{ font: '500 12px system-ui', color: '#6b7280', marginTop: 4 }}>
                  {s.item_key} · uploaded by {s.submitted_by_name ?? s.submitted_by_persona} · {new Date(s.created_at).toLocaleDateString()}
                </div>
                <div style={{ font: '500 12px system-ui', color: '#374151', marginTop: 6, background: '#f9fafb', borderRadius: 6, padding: '6px 8px' }}>
                  <b>MAIA read:</b> {s.ai_verdict ?? 'not analyzed'}
                  {s.ai_identified_as ? ` · ${s.ai_identified_as}` : ''}
                  {s.ai_expiration_date ? ` · expires ${s.ai_expiration_date}` : ''}
                  {s.ai_summary ? <div style={{ marginTop: 2, color: '#6b7280' }}>{s.ai_summary}</div> : null}
                </div>
                {data.canReview && s.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={() => review(s.id, 'approve')} disabled={busy === s.id} style={btn('#16a34a')}>Approve</button>
                    <button onClick={() => review(s.id, 'reject')} disabled={busy === s.id} style={btn('#dc2626')}>Reject</button>
                  </div>
                )}
                {s.status !== 'pending' && s.reviewed_by && (
                  <div style={{ font: '500 12px system-ui', color: '#6b7280', marginTop: 6 }}>{s.status} by {s.reviewed_by}{s.review_note ? ` — ${s.review_note}` : ''}</div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </Shell>
  )
}

function UploadForm({ account, assoc, items, onDone }: { account: string; assoc: string; items: { key: string; scope: 'unit' | 'tenant'; label: string }[]; onDone: () => void }) {
  // Composite value (scope:key) so a unit + tenant item sharing a key stay distinct.
  const [sel, setSel]   = useState(items[0] ? `${items[0].scope}:${items[0].key}` : '')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg]   = useState<string | null>(null)

  const submit = async () => {
    if (!file || !sel) return
    const [scope, ...rest] = sel.split(':'); const itemKey = rest.join(':')
    setBusy(true); setMsg(null)
    try {
      const u = await fetch('/api/units/documents/upload-url', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, assoc, filename: file.name }) })
      const uj = await u.json(); if (!u.ok) throw new Error(uj.error || 'upload-url failed')
      const put = await fetch(uj.signedUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } })
      if (!put.ok) throw new Error(`storage upload failed (${put.status})`)
      const s = await fetch('/api/units/documents/submit', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, assoc, item_key: itemKey, scope, storage_path: uj.path, filename: file.name, mime_type: file.type }) })
      const sj = await s.json(); if (!s.ok) throw new Error(sj.error || 'submit failed')
      setMsg(`Uploaded — MAIA read it as "${sj.submission?.ai_verdict ?? 'analyzed'}". Sent for approval.`)
      setFile(null); onDone()
    } catch (e) { setMsg(`Error: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <select value={sel} onChange={e => setSel(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', font: '500 13px system-ui' }}>
        {items.map(i => <option key={`${i.scope}:${i.key}`} value={`${i.scope}:${i.key}`}>{i.label}</option>)}
      </select>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ font: '13px system-ui' }} />
      <button onClick={submit} disabled={!file || busy} style={btn('#f26a1b')}>{busy ? 'Uploading…' : 'Upload for approval'}</button>
      {msg && <div style={{ width: '100%', font: '500 13px system-ui', color: msg.startsWith('Error') ? '#991b1b' : '#166534' }}>{msg}</div>}
    </div>
  )
}

function btn(color: string): React.CSSProperties {
  return { padding: '8px 14px', borderRadius: 8, border: 'none', background: color, color: '#fff', cursor: 'pointer', font: '600 13px system-ui' }
}
function StatusPill({ status }: { status: string }) {
  const c = status === 'approved' ? ['#dcfce7', '#166534'] : status === 'rejected' ? ['#fee2e2', '#991b1b'] : ['#fef9c3', '#854d0e']
  return <span style={{ font: '700 11px system-ui', background: c[0], color: c[1], borderRadius: 6, padding: '2px 8px', textTransform: 'uppercase' }}>{status}</span>
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}><div style={{ font: '600 11px system-ui', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div><div style={{ font: '500 15px system-ui', color: '#111827', marginTop: 4 }}>{children}</div></div>
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={{ marginTop: 24 }}><h2 style={{ font: '600 15px system-ui', margin: '0 0 10px' }}>{title}</h2>{children}</div>
}
function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 18px', font: '400 14px system-ui' }}>{children}</div>
}
