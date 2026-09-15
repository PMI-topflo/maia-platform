'use client'

// =====================================================================
// Leasing → Lease escalations. Phase 5 of the Checkr-first redesign: the
// units whose lease has ended and whose owner never answered. Each row
// carries the 15-day clock, the Board's yes/no on a violation fee, and —
// once the further 30 days pass with nothing on file — the red flag that
// says a new lease application is now required. Same red treatment as an
// expired document on /admin/pre-apply/[id] (user direction: a blown
// window must read exactly as urgently). Data + actions:
// lib/lease-escalation.ts, /api/admin/lease-escalations.
// =====================================================================

import { useCallback, useEffect, useState } from 'react'
import type { BacklogRow, EscalationRow } from '@/lib/lease-escalation'

const fmtD = (iso: string | null) => iso ? new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const money = (n: number | null) => n == null ? '—' : '$' + n.toFixed(2)

export default function LeaseEscalationsPage() {
  const [rows, setRows] = useState<EscalationRow[]>([])
  const [backlog, setBacklog] = useState<BacklogRow[]>([])
  const [resolved, setResolved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (withResolved: boolean) => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch(`/api/admin/lease-escalations${withResolved ? '?resolved=1' : ''}`, { credentials: 'include', cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setRows(j.rows as EscalationRow[]); setBacklog(j.backlog as BacklogRow[])
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load(resolved) }, [resolved, load])

  async function decide(row: EscalationRow, authorized: boolean | null) {
    let amount: number | null = null
    if (authorized === true) {
      const raw = window.prompt(`Pre-authorize a violation fee for Unit ${row.unit}, ${row.associationName}?\n\nIt is charged only if the owner still has not answered by ${fmtD(row.feeDeadline)}. AR is then emailed to post it in CINC — MAIA cannot post the charge itself.\n\nAmount ($):`, row.feeAmount != null ? String(row.feeAmount) : '')
      if (raw == null) return
      amount = Number(raw)
      if (!Number.isFinite(amount) || amount <= 0) { setMsg('Enter a fee amount greater than zero.'); return }
    }
    setBusy(row.id); setMsg(null)
    try {
      const r = await fetch('/api/admin/lease-escalations', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id, authorized, amount }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setMsg(`Unit ${row.unit}: ${authorized === true ? `fee of ${money(amount)} pre-authorized` : authorized === false ? 'recorded as no fee' : 'back to undecided'}.`)
      await load(resolved)
    } catch (e) { setMsg(`Unit ${row.unit}: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  async function escalateNow(row: BacklogRow) {
    if (!window.confirm(`Escalate Unit ${row.unit}, ${row.associationName}?\n\nThe lease ended ${row.leaseEndedDaysAgo} days ago. ${row.ownerName ?? 'The owner'} is emailed today that the unit has no approved lease, is given 15 days to answer, and the violation-fee decision then comes back to this screen.\n\nMAIA does not do this one automatically because the lease is old enough that it may just be a stale tenant record — check the unit before sending.`)) return
    setBusy(row.id); setMsg(null)
    try {
      const r = await fetch('/api/admin/lease-escalations', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'escalate', id: row.id }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setMsg(`Unit ${row.unit}: the owner was notified — answer due ${fmtD(j.deadline)}.`)
      await load(resolved)
    } catch (e) { setMsg(`Unit ${row.unit}: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  const box: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', padding: '12px 14px', marginBottom: 14 }
  const th: React.CSSProperties = { textAlign: 'left', font: '600 11px system-ui', letterSpacing: '.05em', textTransform: 'uppercase', color: '#6b7280', padding: '6px 10px', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '10px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top', fontSize: 13 }
  const btn = (primary = false): React.CSSProperties => ({ font: '600 12px system-ui', padding: '5px 10px', borderRadius: 7, cursor: 'pointer', border: `1px solid ${primary ? '#b91c1c' : '#d1d5db'}`, background: primary ? '#b91c1c' : '#fff', color: primary ? '#fff' : '#1f2a44' })

  const redCount = rows.filter(r => r.red).length
  const decisionCount = rows.filter(r => r.feeNotifiedAt && r.feeAuthorized == null && !r.resolvedAt).length

  return (
    <div style={{ padding: 20, maxWidth: 1180, margin: '0 auto' }}>
      <h1 style={{ font: '700 20px system-ui', margin: '0 0 4px', color: '#1f2a44' }}>Lease escalations</h1>
      <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 14px', maxWidth: 760 }}>
        Units whose lease has ended and whose owner never answered either reminder. MAIA writes to the owner on the day the lease ends,
        gives them <strong>15 days</strong> to answer, then brings the violation fee here for a decision. After <strong>30 further days</strong>
        {' '}with nothing on file the application expires and any filing from then on is a new lease — full checklist, fresh screening, application fee.
        The clocks stop the moment the owner answers anything at all.
      </p>

      <div style={{ ...box, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ font: '700 13px system-ui', color: redCount ? '#b91c1c' : '#1f2a44' }}>{redCount} blown window{redCount === 1 ? '' : 's'}</span>
        <span style={{ font: '700 13px system-ui', color: decisionCount ? '#b45309' : '#1f2a44' }}>{decisionCount} waiting on a fee decision</span>
        <span style={{ color: '#6b7280', fontSize: 13 }}>{rows.length} in total</span>
        <label style={{ marginLeft: 'auto', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={resolved} onChange={e => setResolved(e.target.checked)} style={{ marginRight: 6 }} />
          Show the ones the owner answered
        </label>
      </div>

      {msg && <div style={{ ...box, background: '#f0f9ff', borderColor: '#bae6fd', fontSize: 13 }}>{msg}</div>}
      {err && <div style={{ ...box, background: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c', fontSize: 13 }}>{err}</div>}

      <div style={{ ...box, padding: 0, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
          <thead><tr>
            <th style={th}>Unit</th><th style={th}>Owner</th><th style={th}>Lease ended</th>
            <th style={th}>Answer due</th><th style={th}>Expires</th><th style={th}>Where it stands</th><th style={th}>Violation fee</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td style={td} colSpan={7}>Loading…</td></tr>}
            {!loading && !rows.length && <tr><td style={{ ...td, color: '#6b7280' }} colSpan={7}>No unit is in escalation. Every owner whose lease ended has answered.</td></tr>}
            {rows.map(r => (
              <tr key={r.id} style={{ background: r.red ? '#fef2f2' : undefined }}>
                <td style={{ ...td, borderLeft: r.red ? '3px solid #b91c1c' : '3px solid transparent' }}>
                  <div style={{ fontWeight: 700 }}>{r.red && <span style={{ marginRight: 4 }}>🚨</span>}{r.unit}</div>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>{r.associationName}</div>
                  {r.applicationId && <a href={`/admin/pre-apply/${r.applicationId}`} style={{ fontSize: 12, color: '#2563eb' }}>application · {r.documents} doc{r.documents === 1 ? '' : 's'}</a>}
                </td>
                <td style={td}>{r.ownerName ?? '—'}<div style={{ color: '#6b7280', fontSize: 12 }}>{r.ownerEmail ?? 'no email on file'}</div></td>
                <td style={td}>{fmtD(r.leaseEnd)}<div style={{ color: '#6b7280', fontSize: 12 }}>{r.leaseEndedDaysAgo} days ago</div></td>
                <td style={td}>{fmtD(r.feeDeadline)}{r.feeDaysLeft != null && !r.resolvedAt && <div style={{ color: r.feeDaysLeft < 0 ? '#b91c1c' : '#6b7280', fontSize: 12 }}>{r.feeDaysLeft < 0 ? `${-r.feeDaysLeft} days over` : `${r.feeDaysLeft} days left`}</div>}</td>
                <td style={td}>{fmtD(r.graceDeadline)}</td>
                <td style={{ ...td, maxWidth: 280 }}>{r.status}</td>
                <td style={td}>
                  {r.resolvedAt ? <span style={{ color: '#6b7280' }}>—</span> : r.feeAppliedAt ? (
                    <span style={{ color: '#b91c1c', fontWeight: 600 }}>{money(r.feeAmount)} sent to AR<div style={{ color: '#6b7280', fontWeight: 400, fontSize: 12 }}>{fmtD(r.feeAppliedAt)} · post it in CINC</div></span>
                  ) : (
                    <>
                      <div style={{ marginBottom: 6, fontSize: 12, color: r.feeAuthorized === true ? '#b91c1c' : r.feeAuthorized === false ? '#166534' : '#6b7280' }}>
                        {r.feeAuthorized === true ? `Authorized ${money(r.feeAmount)}` : r.feeAuthorized === false ? 'No fee' : 'Not decided'}
                        {r.feeDecidedBy && <> · {r.feeDecidedBy}</>}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button style={btn(true)} disabled={busy === r.id} onClick={() => decide(r, true)}>Authorize fee</button>
                        <button style={btn()} disabled={busy === r.id} onClick={() => decide(r, false)}>No fee</button>
                        {r.feeAuthorized != null && <button style={btn()} disabled={busy === r.id} onClick={() => decide(r, null)}>Undo</button>}
                      </div>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!!backlog.length && (
        <>
          <h2 style={{ font: '700 15px system-ui', margin: '22px 0 4px', color: '#1f2a44' }}>Backlog &mdash; not escalated automatically ({backlog.length})</h2>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 10px', maxWidth: 760 }}>
            Leases that ended more than 90 days ago with no answer from the owner, and units with no owner email on file. MAIA does not start a
            fee clock on these by itself: at this age it is usually a tenant record nobody updated rather than an owner ignoring us. Check the unit,
            then escalate the ones that are real.
          </p>
          <div style={{ ...box, padding: 0, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
              <thead><tr>
                <th style={th}>Unit</th><th style={th}>Owner</th><th style={th}>Tenant on file</th><th style={th}>Lease ended</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {backlog.map(r => (
                  <tr key={r.id}>
                    <td style={td}><div style={{ fontWeight: 700 }}>{r.unit}</div><div style={{ color: '#6b7280', fontSize: 12 }}>{r.associationName}</div></td>
                    <td style={td}>{r.ownerName ?? '—'}<div style={{ color: r.ownerEmail ? '#6b7280' : '#b91c1c', fontSize: 12 }}>{r.ownerEmail ?? 'no email on file'}</div></td>
                    <td style={td}>{r.tenantName ?? '—'}</td>
                    <td style={td}>{fmtD(r.leaseEnd)}<div style={{ color: '#6b7280', fontSize: 12 }}>{r.leaseEndedDaysAgo} days ago</div></td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {r.blocker === 'no_owner_email'
                        ? <span style={{ color: '#6b7280', fontSize: 12 }}>Add an owner email first</span>
                        : <button style={btn()} disabled={busy === r.id} onClick={() => escalateNow(r)}>Escalate now</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
