'use client'

// Staff Pre-Application audit view (B4 slice 3). Review one submitted intake:
// the applicant, the per-type checklist vs what was uploaded, each document
// (preview), the signed rules acknowledgment, and the Drive folder. Advance it:
// audit (PMI/Jonathan) → approve (on-site manager OR board) or decline.

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface Doc { id: string; doc_key: string | null; doc_label: string | null; filename: string; mime_type: string | null; url: string | null }
interface Detail {
  id: string; associationCode: string; type: string; unit: string | null; status: string; submittedAt: string | null
  applicant: { name: string | null; email: string | null; phone: string | null } | null
  rulesAck: { name?: string; at?: string } | null
  driveFolderUrl: string | null
  screeningProvider: string
  audit: { auditedBy: string | null; auditedAt: string | null; reviewedBy: string | null; reviewedAt: string | null; note: string | null; approvedByRole: string | null }
  checklist: { label: string; required: boolean; provided_by: string; uploaded: boolean }[]
  documents: Doc[]
}

const TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease renewal', additional_occupant: 'Additional occupant' }
const fmt = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '—'

export default function PreApplyDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [tax, setTax] = useState<{ kind: string; confidence: number; verdict: string } | null>(null)
  const [taxBusy, setTaxBusy] = useState(false)

  async function runTaxCheck() {
    setTaxBusy(true); setTax(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/tax-check`, { method: 'POST', credentials: 'include' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); setTax(j)
    } catch (e) { alert(`Tax check: ${(e as Error).message}`) } finally { setTaxBusy(false) }
  }

  const load = useCallback(() => {
    fetch(`/api/admin/pre-apply/${id}`, { credentials: 'include' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(setD).catch(e => setErr(String(e.message ?? e)))
  }, [id])
  useEffect(load, [load])

  async function act(action: string, by_role?: string) {
    if ((action === 'decline' || action === 'request') && !note.trim()) { alert('Add a note explaining what’s needed.'); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, by_role, note }) })
      if (!r.ok) throw new Error((await r.json()).error || 'failed'); setNote(''); load()
    } catch (e) { alert(`Could not update: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  if (err) return <div style={wrap}><p style={{ color: '#991b1b' }}>{err}</p></div>
  if (!d) return <div style={wrap}><p style={{ color: '#9ca3af' }}>Loading…</p></div>

  const missing = d.checklist.filter(c => c.required && !c.uploaded)
  const audited = !!d.audit.auditedAt
  const decided = d.status === 'approved' || d.status === 'declined'

  return (
    <div style={wrap}>
      <Link href="/admin/pre-apply" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>← Audit queue</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{d.applicant?.name || 'Applicant'} <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 18 }}>· {TYPE_LABEL[d.type] ?? d.type}</span></h1>
        <StatusPill status={d.status} />
      </div>
      <p style={{ color: '#6b7280', fontSize: 14, margin: '2px 0 0' }}>{d.associationCode}{d.unit ? ` · Unit ${d.unit}` : ''} · submitted {fmt(d.submittedAt)}</p>
      <p style={{ fontSize: 13, color: '#374151', margin: '4px 0 0' }}>{d.applicant?.email}{d.applicant?.phone ? ` · ${d.applicant.phone}` : ''}</p>
      {d.driveFolderUrl && <p style={{ margin: '8px 0 0' }}><a href={d.driveFolderUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontSize: 13, fontWeight: 600 }}>📁 Drive folder →</a></p>}

      {/* Checklist */}
      <h2 style={h2}>Documents ({d.documents.length} uploaded)</h2>
      {missing.length > 0 && <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 10, font: '13px system-ui', color: '#92400e', marginBottom: 10 }}>⚠ Missing required: {missing.map(m => m.label).join(', ')}</div>}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
        {d.checklist.map((c, i) => {
          const doc = d.documents.find(x => x.doc_label === c.label || x.doc_key === c.label)
          return (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 14px', borderTop: i ? '1px solid #f3f4f6' : 'none', alignItems: 'center' }}>
              <div><span style={{ fontWeight: 600, fontSize: 14 }}>{c.label}</span> <span style={{ font: '600 10px system-ui', color: '#4338ca', background: '#eef2ff', borderRadius: 5, padding: '1px 6px' }}>{c.provided_by}</span>{!c.required && <span style={{ fontSize: 11, color: '#6b7280' }}> · optional</span>}</div>
              {c.uploaded && doc?.url ? <a href={doc.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#166534', fontWeight: 600 }}>✓ View</a> : c.uploaded ? <span style={{ fontSize: 13, color: '#166534' }}>✓ Uploaded</span> : <span style={{ fontSize: 13, color: c.required ? '#b45309' : '#9ca3af' }}>{c.required ? 'Missing' : '—'}</span>}
            </div>
          )
        })}
        {d.documents.filter(doc => !d.checklist.some(c => c.label === doc.doc_label)).map(doc => (
          <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 14px', borderTop: '1px solid #f3f4f6', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{doc.doc_label || doc.filename} <span style={{ fontSize: 11, color: '#9ca3af' }}>(extra)</span></span>
            {doc.url && <a href={doc.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#166534', fontWeight: 600 }}>✓ View</a>}
          </div>
        ))}
      </div>

      {/* Tax-return-vs-W-2 check (the one real validation) */}
      {d.checklist.some(c => /tax/i.test(c.label)) && (
        <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button disabled={taxBusy} onClick={runTaxCheck} style={{ ...btn('#4338ca'), padding: '7px 12px' }}>{taxBusy ? 'Checking…' : 'Check tax doc (is it a return, not a W-2?)'}</button>
          {tax && (
            <span style={{ font: '600 13px system-ui', color: tax.verdict === 'ok' ? '#166534' : tax.verdict === 'w2' ? '#b91c1c' : '#b45309' }}>
              {tax.verdict === 'ok' ? '✓ Looks like a tax return' : tax.verdict === 'w2' ? '⚠ This is a W-2, not a tax return' : tax.verdict === 'unknown' ? 'Could not read it' : '⚠ Not a tax return (' + tax.kind + ')'}
              {tax.confidence ? ` · ${Math.round(tax.confidence * 100)}%` : ''}
            </span>
          )}
        </div>
      )}

      {/* Rules ack */}
      <h2 style={h2}>Rules acknowledgment</h2>
      <p style={{ fontSize: 13, color: '#374151' }}>{d.rulesAck?.name ? <>Signed by <strong>{d.rulesAck.name}</strong> · {fmt(d.rulesAck.at)}</> : <span style={{ color: '#b45309' }}>Not signed</span>}</p>

      {/* Audit trail */}
      {(d.audit.auditedAt || d.audit.reviewedAt) && (
        <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 6 }}>
          {d.audit.auditedAt && <div>Audited by {d.audit.auditedBy} · {fmt(d.audit.auditedAt)}</div>}
          {d.audit.reviewedAt && <div>{d.status === 'approved' ? `Approved (${d.audit.approvedByRole})` : 'Decided'} by {d.audit.reviewedBy} · {fmt(d.audit.reviewedAt)}{d.audit.note ? ` — ${d.audit.note}` : ''}</div>}
        </div>
      )}

      {/* Actions */}
      {!decided && (
        <div style={{ marginTop: 20, padding: 16, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fafafa' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Actions</div>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note (required to decline or request more)" style={{ width: '100%', boxSizing: 'border-box', minHeight: 54, padding: 10, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!audited && <button disabled={busy} onClick={() => act('audit')} style={btn('#2563eb')}>Mark audited (PMI/Jonathan)</button>}
            {audited && <>
              <button disabled={busy} onClick={() => act('approve', 'onsite_manager')} style={btn('#059669')}>Approve — on-site manager</button>
              <button disabled={busy} onClick={() => act('approve', 'board')} style={btn('#059669')}>Approve — board</button>
            </>}
            <button disabled={busy} onClick={() => act('request')} style={btn('#b45309')}>Request more</button>
            <button disabled={busy} onClick={() => act('decline')} style={btn('#b91c1c')}>Decline</button>
          </div>
          <p style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 10 }}>
            Audit first (PMI + Jonathan), then the on-site manager or the board approves. On approval this hands off to{' '}
            <strong>{d.screeningProvider === 'maia_checkr' ? 'MAIA + Checkr' : 'Tenant Evaluation (current system)'}</strong> for the background check — change per association on the Association Hub.
          </p>
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { c: string; b: string }> = { submitted: { c: '#92400e', b: '#ffedd5' }, under_review: { c: '#1d4ed8', b: '#dbeafe' }, approved: { c: '#166534', b: '#dcfce7' }, declined: { c: '#991b1b', b: '#fee2e2' } }
  const s = map[status] ?? { c: '#374151', b: '#f3f4f6' }
  return <span style={{ font: '700 12px system-ui', color: s.c, background: s.b, borderRadius: 8, padding: '4px 12px' }}>{status.replace('_', ' ')}</span>
}

const wrap: React.CSSProperties = { maxWidth: 780, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#1f2a44', margin: '22px 0 6px' }
const btn = (bg: string): React.CSSProperties => ({ padding: '9px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: bg, color: '#fff', font: '600 13px system-ui' })
