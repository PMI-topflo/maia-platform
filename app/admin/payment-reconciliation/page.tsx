'use client'

// =====================================================================
// Accounting → Application payments.
// One month at a time: what applicants paid through Stripe (Stripe's real
// fee and net), which Stripe payout carried it to the bank, Karen's
// "received in bank" tick per payout, and what Checkr charged for the
// screenings (receipts uploaded from the Checkr dashboard, matched by
// order id). User request, 2026-09-13.
// =====================================================================

import { useCallback, useEffect, useState } from 'react'
import type { Reconciliation } from '@/lib/payment-reconciliation'

const money = (c: number | null | undefined) => c == null ? '—' : `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (iso: string | null | undefined) => iso ? new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }) : '—'
const fmtET = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : ''
const thisMonth = () => new Date().toISOString().slice(0, 7)

export default function PaymentReconciliationPage() {
  const [month, setMonth] = useState(thisMonth())
  const [data, setData] = useState<Reconciliation | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyPayout, setBusyPayout] = useState<string | null>(null)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async (m: string) => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch(`/api/admin/payment-reconciliation?month=${m}`, { credentials: 'include', cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setData(j as Reconciliation)
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load(month) }, [month, load])

  async function toggleReceived(payoutId: string, received: boolean) {
    setBusyPayout(payoutId)
    try {
      const r = await fetch('/api/admin/payment-reconciliation/payout', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payoutId, received }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      await load(month)
    } catch (e) { alert((e as Error).message) } finally { setBusyPayout(null) }
  }

  async function upload(files: FileList | null) {
    if (!files || !files.length) return
    setUploading(true); setUploadMsg(null)
    try {
      const fd = new FormData(); for (const f of Array.from(files)) fd.append('files', f)
      const r = await fetch('/api/admin/payment-reconciliation/checkr-receipts', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setUploadMsg(`${j.read} receipt(s) read · ${j.matched.length} matched to a screening · ${j.unmatched.length} unmatched${j.skipped.length ? ` · ${j.skipped.length} skipped (not a Checkr receipt)` : ''}`)
      await load(month)
    } catch (e) { setUploadMsg(`Could not read: ${(e as Error).message}`) } finally { setUploading(false) }
  }

  const s = data?.summary
  return (
    <div style={{ padding: '20px 24px', maxWidth: 1400 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ font: '700 11px system-ui', letterSpacing: '.12em', textTransform: 'uppercase', color: '#f26a1b' }}>Accounting</div>
          <h1 style={{ font: '700 22px system-ui', color: '#1f2a44', margin: '2px 0 4px' }}>Application payments</h1>
          <p style={{ font: '13px system-ui', color: '#6b7280', margin: 0, maxWidth: 720 }}>What applicants paid through Stripe, Stripe&apos;s fee and the deposit it went out in, against what Checkr charged for the screenings. Tick a payout once it shows on the bank statement.</p>
        </div>
        <label style={{ font: '13px system-ui', color: '#374151', display: 'flex', alignItems: 'center', gap: 8 }}>Month
          <input type="month" value={month} max={thisMonth()} onChange={e => setMonth(e.target.value)} style={{ font: '13px system-ui', border: '1px solid #d1d5db', borderRadius: 6, padding: '5px 8px' }} />
        </label>
      </div>

      {err && <div style={{ marginTop: 14, border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', borderRadius: 8, padding: '10px 12px', font: '13px system-ui' }}>{err}</div>}
      {loading && !data && <div style={{ marginTop: 20, font: '13px system-ui', color: '#9ca3af' }}>Reading Stripe…</div>}

      {data && s && (
        <>
          {!data.stripeConfigured && <div style={{ marginTop: 14, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', borderRadius: 8, padding: '10px 12px', font: '13px system-ui' }}>Stripe is not configured on this server: fees and payouts are unknown, amounts come from MAIA only.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, margin: '16px 0' }}>
            {[['Collected', s.collectedCents, '#1f2a44'], ['Stripe fees', s.feesCents, '#6b7280'], ['Net from Stripe', s.netCents, '#1f2a44'], ['Checkr paid', s.checkrCents, '#6b7280'], ['Margin', s.marginCents, '#166534'], ['In the bank', s.payoutsReceivedCents, '#166534'], ['Deposits pending', s.payoutsPendingCents, s.payoutsPendingCents ? '#b45309' : '#6b7280']].map(([label, v, color]) => (
              <div key={String(label)} style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ font: '600 10.5px system-ui', letterSpacing: '.08em', textTransform: 'uppercase', color: '#9ca3af' }}>{label}</div>
                <div style={{ font: '700 18px system-ui', color: String(color), fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{money(v as number)}</div>
              </div>
            ))}
          </div>

          {data.exceptions.length > 0 && (
            <div style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
              <div style={{ font: '600 12px system-ui', color: '#92400e', marginBottom: 4 }}>Needs a look</div>
              <ul style={{ margin: 0, paddingLeft: 18, font: '12.5px system-ui', color: '#78350f' }}>{data.exceptions.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}

          <h2 style={{ font: '600 14px system-ui', color: '#1f2a44', margin: '18px 0 8px' }}>Payments · {data.rows.length}</h2>
          <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 960, font: '13px system-ui' }}>
              <thead><tr style={{ font: '600 11px system-ui', letterSpacing: '.06em', textTransform: 'uppercase', color: '#9ca3af', textAlign: 'left' }}>
                {['Paid', 'Association · unit', 'Applicant(s)', 'Gross', 'Stripe fee', 'Net', 'Deposit', 'Screenings', 'Checkr', 'Margin'].map(h => <th key={h} style={{ padding: '9px 10px', borderBottom: '1px solid #e5e7eb' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {data.rows.length === 0 && <tr><td colSpan={10} style={{ padding: 18, color: '#9ca3af', textAlign: 'center' }}>No live application payments in this month.</td></tr>}
                {data.rows.map(r => (
                  <tr key={r.applicationId} style={{ borderTop: '1px solid #f3f4f6', verticalAlign: 'top' }}>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{fmtDate(r.chargeDate)}</td>
                    <td style={{ padding: '8px 10px' }}><div style={{ fontWeight: 600, color: '#1f2a44' }}>{(r.association ?? '').replace(/ Association.*$|,? Inc\.?$/i, '')}</div><div style={{ color: '#6b7280' }}>Unit {r.unit ?? '—'}</div></td>
                    <td style={{ padding: '8px 10px' }}>{r.applicants.map(a => <div key={a}>{a}</div>)}</td>
                    <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{money(r.grossCents)}</td>
                    <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums', color: '#6b7280' }}>{money(r.feeCents)}</td>
                    <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(r.netCents)}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      {r.payoutId ? (
                        <>
                          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#6b7280' }}>{r.payoutId.slice(0, 12)}…</div>
                          <div>{fmtDate(r.payoutArrival)} · {r.payoutStatus}</div>
                          <div style={{ color: r.bankReceivedAt ? '#166534' : '#b45309', fontWeight: 600 }}>{r.bankReceivedAt ? '✓ in the bank' : 'not confirmed'}</div>
                        </>
                      ) : <span style={{ color: '#9ca3af' }}>not paid out yet</span>}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {r.reports.length === 0 && <span style={{ color: '#b45309' }}>none ordered</span>}
                      {r.reports.map((p, i) => <div key={i} style={{ whiteSpace: 'nowrap' }}>{p.name ?? '?'} <span style={{ color: '#9ca3af' }}>· {fmtDate(p.orderedAt)}{p.receiptCents == null && p.orderId ? ' · no receipt' : ''}</span></div>)}
                    </td>
                    <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{r.checkrCents != null ? money(r.checkrCents) : <span style={{ color: '#9ca3af' }} title="Expected from the last known receipt price">~{money(r.checkrExpectedCents)}</span>}</td>
                    <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: '#166534' }}>{money(r.marginCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, marginTop: 22 }}>
            <section>
              <h2 style={{ font: '600 14px system-ui', color: '#1f2a44', margin: '0 0 8px' }}>Stripe deposits to the bank · {data.payouts.length}</h2>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
                {data.payouts.length === 0 && <div style={{ padding: 14, color: '#9ca3af', font: '13px system-ui' }}>No payouts carrying this month&apos;s payments yet.</div>}
                {data.payouts.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: '1px solid #f3f4f6', font: '13px system-ui' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!p.bankReceivedAt} disabled={busyPayout === p.id} onChange={e => toggleReceived(p.id, e.target.checked)} style={{ width: 16, height: 16, accentColor: '#166534' }} />
                      <span style={{ fontWeight: 600 }}>Received in bank</span>
                    </label>
                    <div style={{ flex: 1 }}>
                      <div><b style={{ fontVariantNumeric: 'tabular-nums' }}>{money(p.amountCents)}</b> · arrives {fmtDate(p.arrivalDate)} · Stripe says <b>{p.status}</b> · {p.applications} application payment{p.applications === 1 ? '' : 's'}{p.chargeIds.length > p.applications ? ` + ${p.chargeIds.length - p.applications} other charge(s)` : ''}</div>
                      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#9ca3af' }}>{p.id}{p.bankReceivedAt ? ` · confirmed by ${p.bankReceivedBy} ${fmtET(p.bankReceivedAt)}` : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ font: '12px system-ui', color: '#9ca3af', margin: '6px 0 0' }}>A payout is one bank deposit: the amount here is the amount on the statement.</p>
            </section>

            <section>
              <h2 style={{ font: '600 14px system-ui', color: '#1f2a44', margin: '0 0 8px' }}>Checkr receipts</h2>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', padding: 14, font: '13px system-ui' }}>
                <p style={{ margin: '0 0 8px', color: '#374151' }}>Download the month&apos;s receipts from the Checkr dashboard (Billing → Receipts) and drop the ZIP or the PDFs here. Each receipt is matched to the screening by its order number.</p>
                <input type="file" multiple accept=".pdf,.zip,application/pdf,application/zip" disabled={uploading} onChange={e => upload(e.target.files)} />
                {uploading && <div style={{ color: '#6b7280', marginTop: 6 }}>Reading…</div>}
                {uploadMsg && <div style={{ marginTop: 8, color: uploadMsg.startsWith('Could not') ? '#991b1b' : '#166534' }}>{uploadMsg}</div>}
                {data.unmatchedReceipts.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ font: '600 12px system-ui', color: '#92400e' }}>Receipts with no matching screening in MAIA</div>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: '#78350f' }}>{data.unmatchedReceipts.map(u => <li key={u.orderId}>{u.applicant ?? '?'} · {money(u.amountCents)} · {fmtDate(u.paidOn)} · <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{u.orderId}</span></li>)}</ul>
                  </div>
                )}
                <div style={{ marginTop: 10, color: '#6b7280' }}>Expected Checkr cost this month: {money(s.checkrExpectedCents)} for {s.reports} report(s) · receipts on file: {money(s.checkrCents)}</div>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
