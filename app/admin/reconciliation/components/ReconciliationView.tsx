// =====================================================================
// app/admin/reconciliation/components/ReconciliationView.tsx
// Client component. Spreadsheet-like reconciliation view per
// (association, bank account, month).
//
// Header controls: assoc picker, bank-account picker, month picker,
// Sync button, Download CSV button, Add manual entry button.
//
// Table: every transaction sorted by effective_date ascending.
// Inline edit on notes columns; checkbox to mark reconciled.
// CINC-sourced rows can't be deleted (re-sync would re-create them);
// manual rows have a delete affordance.
// =====================================================================

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface Association { code: string; name: string }

interface BankAccountOption {
  id:           number
  description:  string
  last4:        string | null
  kind:         'operating' | 'reserve' | 'special' | 'other'
  bankBalance:  number | null
  restricted:   boolean
}

interface ReconEntry {
  id:                          string
  association_code:            string
  bank_account_id:             number
  bank_account_description:    string | null
  source:                      'cinc' | 'manual'
  cinc_invoice_id:             number | null
  cinc_payment_id:             string | null
  effective_date:              string  // YYYY-MM-DD
  customer:                    string | null
  vendor_payee:                string | null
  description:                 string | null
  invoice_number:              string | null
  amount:                      number
  paid_type:                   string | null
  additional_notes:            string | null
  invoice_attached_url:        string | null
  running_balance:             number | null
  pmi_coordinator_notes:       string | null
  reconciled_at:               string | null
  reconciled_by:               string | null
  entered_by:                  string
  created_at:                  string
  updated_at:                  string
}

interface Props {
  associations:   Association[]
  initialAssoc:   string
  initialAccount: string
  initialMonth:   string  // 'YYYY-MM'
}

export default function ReconciliationView(props: Props) {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [assoc,   setAssoc]   = useState(props.initialAssoc)
  const [account, setAccount] = useState(props.initialAccount)
  const [month,   setMonth]   = useState(props.initialMonth)

  const [banks,        setBanks]        = useState<BankAccountOption[]>([])
  const [banksLoading, setBanksLoading] = useState(false)

  const [entries,        setEntries]        = useState<ReconEntry[]>([])
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [info,           setInfo]           = useState<string | null>(null)
  // Per-bank error breakdown from the last sync, rendered separately
  // below the success line so each error gets its own row with the
  // human bank-account label.
  const [syncErrors, setSyncErrors] = useState<Array<{ bankAccountDescription?: string; bankAccountId?: number; message: string }>>([])

  const [syncBusy, setSyncBusy] = useState(false)
  const [savingRowId, setSavingRowId] = useState<string | null>(null)

  // ── URL sync ──────────────────────────────────────────────────────
  function pushUrlState(next: Partial<{ assoc: string; account: string; month: string }>) {
    const params = new URLSearchParams(searchParams.toString())
    const fields = { assoc, account, month, ...next }
    if (fields.assoc)   params.set('assoc',   fields.assoc);   else params.delete('assoc')
    if (fields.account) params.set('account', fields.account); else params.delete('account')
    if (fields.month)   params.set('month',   fields.month);   else params.delete('month')
    router.replace(`?${params.toString()}`)
  }

  // ── Load bank accounts when assoc changes ─────────────────────────
  useEffect(() => {
    if (!assoc) { setBanks([]); return }
    setBanksLoading(true)
    fetch(`/api/admin/cinc/bank-accounts?assoc=${encodeURIComponent(assoc)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (data?.error) throw new Error(data.error)
        const accounts: BankAccountOption[] = data.accounts ?? []
        setBanks(accounts)
        // If we don't have an account selected yet, default to the first
        // operating account so the page lands on something useful.
        if (!account && accounts.length > 0) {
          const op = accounts.find(a => a.kind === 'operating') ?? accounts[0]
          setAccount(String(op.id))
          pushUrlState({ account: String(op.id) })
        }
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBanksLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assoc])

  // ── Load entries when (assoc, account, month) changes ─────────────
  const loadEntries = useCallback(async () => {
    if (!assoc || !account) { setEntries([]); return }
    setEntriesLoading(true); setError(null)
    try {
      const r = await fetch(
        `/api/admin/reconciliation?assoc=${encodeURIComponent(assoc)}&account=${encodeURIComponent(account)}&month=${encodeURIComponent(month)}`,
        { cache: 'no-store' },
      )
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`)
      setEntries(data.entries ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setEntriesLoading(false)
    }
  }, [assoc, account, month])

  useEffect(() => { void loadEntries() }, [loadEntries])

  // ── Actions ───────────────────────────────────────────────────────
  async function runSync() {
    if (!assoc) return
    setSyncBusy(true); setInfo(null); setError(null); setSyncErrors([])
    try {
      const r = await fetch(`/api/admin/reconciliation/sync?assoc=${encodeURIComponent(assoc)}`, { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`)
      const stats = data.results?.[0]
      if (stats) {
        setInfo(`Synced ${assoc}: ${stats.transactionsSeen ?? 0} bank txs seen, ${stats.entriesCreated ?? 0} created, ${stats.entriesUpdated ?? 0} updated, ${stats.draftMatches ?? 0} matched to MAIA invoices${stats.errors?.length ? `, ${stats.errors.length} errors` : ''}.`)
        setSyncErrors(Array.isArray(stats.errors) ? stats.errors : [])
      } else {
        setInfo('Sync complete.')
      }
      await loadEntries()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncBusy(false)
    }
  }

  async function updateEntry(id: string, patch: Partial<ReconEntry> & { reconciled?: boolean }) {
    setSavingRowId(id)
    try {
      const r = await fetch('/api/admin/reconciliation', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id, ...patch }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`)
      setEntries(prev => prev.map(e => e.id === id ? data.entry : e))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingRowId(null)
    }
  }

  async function deleteEntry(id: string) {
    if (!confirm('Delete this manual entry?')) return
    try {
      const r = await fetch(`/api/admin/reconciliation?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`)
      setEntries(prev => prev.filter(e => e.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // ── Manual entry modal ────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false)
  const [adding,  setAdding]  = useState(false)
  const [newEntry, setNewEntry] = useState({
    effective_date:  new Date().toISOString().slice(0, 10),
    vendor_payee:    '',
    description:     '',
    invoice_number:  '',
    amount:          '',
    paid_type:       '',
    additional_notes: '',
    pmi_coordinator_notes: '',
  })

  async function submitNewEntry() {
    if (!assoc || !account) return
    if (!newEntry.effective_date || newEntry.amount === '') {
      setError('Effective date + amount are required.')
      return
    }
    setAdding(true); setError(null)
    try {
      const bank = banks.find(b => String(b.id) === account)
      const r = await fetch('/api/admin/reconciliation', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          association_code:           assoc,
          bank_account_id:            parseInt(account, 10),
          bank_account_description:   bank?.description ?? null,
          effective_date:             newEntry.effective_date,
          customer:                   assoc,
          vendor_payee:               newEntry.vendor_payee || null,
          description:                newEntry.description || null,
          invoice_number:             newEntry.invoice_number || null,
          amount:                     parseFloat(newEntry.amount),
          paid_type:                  newEntry.paid_type || null,
          additional_notes:           newEntry.additional_notes || null,
          pmi_coordinator_notes:      newEntry.pmi_coordinator_notes || null,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`)
      setEntries(prev => [...prev, data.entry].sort((a, b) => a.effective_date.localeCompare(b.effective_date)))
      setShowAdd(false)
      setNewEntry({
        effective_date:  new Date().toISOString().slice(0, 10),
        vendor_payee:    '',
        description:     '',
        invoice_number:  '',
        amount:          '',
        paid_type:       '',
        additional_notes: '',
        pmi_coordinator_notes: '',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  // ── Totals for the period ─────────────────────────────────────────
  const totals = useMemo(() => {
    let inflow = 0, outflow = 0, reconciled = 0, unreconciled = 0
    for (const e of entries) {
      if (e.amount > 0) inflow  += e.amount
      else              outflow += e.amount
      if (e.reconciled_at) reconciled++; else unreconciled++
    }
    return { inflow, outflow, net: inflow + outflow, reconciled, unreconciled }
  }, [entries])

  const bankLabel = useMemo(() => {
    const b = banks.find(x => String(x.id) === account)
    return b ? b.description : ''
  }, [banks, account])

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1400, margin: '24px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Bank reconciliation</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>Per association + bank account, with CINC payments auto-synced.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={runSync}
            disabled={syncBusy || !assoc}
            style={{ padding: '6px 12px', border: '1px solid #2563eb', borderRadius: 4, background: syncBusy ? '#bfdbfe' : '#2563eb', color: '#fff', fontSize: 13, cursor: syncBusy || !assoc ? 'default' : 'pointer' }}
          >
            {syncBusy ? 'Syncing…' : 'Sync now'}
          </button>
          <a
            href={assoc && account ? `/api/admin/reconciliation/export?assoc=${encodeURIComponent(assoc)}&account=${encodeURIComponent(account)}&month=${encodeURIComponent(month)}` : '#'}
            onClick={e => { if (!assoc || !account) e.preventDefault() }}
            style={{ padding: '6px 12px', border: '1px solid #16a34a', borderRadius: 4, background: '#fff', color: '#16a34a', fontSize: 13, textDecoration: 'none', cursor: assoc && account ? 'pointer' : 'default' }}
          >
            Download CSV
          </a>
          <button
            onClick={() => setShowAdd(true)}
            disabled={!assoc || !account}
            style={{ padding: '6px 12px', border: '1px solid #6b7280', borderRadius: 4, background: '#fff', color: '#111', fontSize: 13, cursor: assoc && account ? 'pointer' : 'default' }}
          >
            + Manual entry
          </button>
        </div>
      </header>

      {/* Selection controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: '#374151' }}>
          Association
          <select
            value={assoc}
            onChange={e => { const v = e.target.value.toUpperCase(); setAssoc(v); setAccount(''); pushUrlState({ assoc: v, account: '' }) }}
            style={{ marginLeft: 6, padding: 4 }}
          >
            <option value="">— pick —</option>
            {props.associations.map(a => (
              <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: '#374151' }}>
          Bank account
          <select
            value={account}
            onChange={e => { setAccount(e.target.value); pushUrlState({ account: e.target.value }) }}
            disabled={!assoc || banksLoading}
            style={{ marginLeft: 6, padding: 4 }}
          >
            <option value="">{banksLoading ? 'Loading…' : '— pick —'}</option>
            {banks.map(b => (
              <option key={b.id} value={String(b.id)}>
                {b.description}{b.bankBalance != null ? ` — $${b.bankBalance.toLocaleString('en-US', { maximumFractionDigits: 0 })} bal` : ''}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: '#374151' }}>
          Month
          <input
            type="month"
            value={month}
            onChange={e => { setMonth(e.target.value); pushUrlState({ month: e.target.value }) }}
            style={{ marginLeft: 6, padding: 3 }}
          />
        </label>
      </div>

      {error && (
        <div style={{ padding: 10, marginBottom: 10, background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 4, color: '#991b1b', fontSize: 13 }}>{error}</div>
      )}
      {info && (
        <div style={{ padding: 10, marginBottom: syncErrors.length > 0 ? 4 : 10, background: '#dcfce7', border: '1px solid #86efac', borderRadius: 4, color: '#166534', fontSize: 13 }}>{info}</div>
      )}
      {syncErrors.length > 0 && (
        <div style={{ padding: 10, marginBottom: 10, background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, color: '#92400e', fontSize: 12 }}>
          <div style={{ marginBottom: 6 }}>
            <strong>Sync errors</strong> — these bank accounts couldn&apos;t be fetched this run. Existing rows are unaffected; retry usually resolves transient CINC blips.
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {syncErrors.map((e, i) => (
              <li key={i}>
                <strong>{e.bankAccountDescription ?? (e.bankAccountId ? `Bank account #${e.bankAccountId}` : 'Unknown account')}:</strong>{' '}
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Totals strip */}
      {entries.length > 0 && (
        <div style={{ display: 'flex', gap: 16, padding: '8px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 4, marginBottom: 10, fontSize: 12 }}>
          <span><strong>Inflow:</strong> ${totals.inflow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span><strong>Outflow:</strong> ${totals.outflow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span><strong>Net:</strong> ${totals.net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span style={{ marginLeft: 'auto' }}>
            <strong>{totals.reconciled}</strong> reconciled · <strong>{totals.unreconciled}</strong> pending
          </span>
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <Th>Effective Date</Th>
              <Th>Customer</Th>
              <Th>Vendor/Payee</Th>
              <Th>Description</Th>
              <Th>Invoice #</Th>
              <Th right>Amount</Th>
              <Th>Paid Type</Th>
              <Th>Notes</Th>
              <Th>Invoice</Th>
              <Th>PMI Coordinator</Th>
              <Th>Source</Th>
              <Th>Recon.</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {entriesLoading && (
              <tr><td colSpan={13} style={{ padding: 12, textAlign: 'center', color: '#9ca3af' }}>Loading…</td></tr>
            )}
            {!entriesLoading && entries.length === 0 && (
              <tr><td colSpan={13} style={{ padding: 12, textAlign: 'center', color: '#9ca3af' }}>
                {assoc && account ? 'No entries yet for this month. Click "Sync now" to pull CINC payments, or "+ Manual entry" to add a row.' : 'Pick an association + bank account above.'}
              </td></tr>
            )}
            {entries.map(e => (
              <tr key={e.id} style={{ background: e.reconciled_at ? '#f0fdf4' : '#fff', borderTop: '1px solid #f3f4f6' }}>
                <Td>{e.effective_date}</Td>
                <Td>{e.customer ?? ''}</Td>
                <Td>{e.vendor_payee ?? ''}</Td>
                <Td>{e.description ?? ''}</Td>
                <Td>{e.invoice_number ?? ''}</Td>
                <Td right>
                  <span style={{ color: e.amount < 0 ? '#991b1b' : '#166534', fontVariantNumeric: 'tabular-nums' }}>
                    ${Math.abs(e.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    {e.amount < 0 ? ' ⬇' : e.amount > 0 ? ' ⬆' : ''}
                  </span>
                </Td>
                <Td>{e.paid_type ?? ''}</Td>
                <Td>
                  <InlineNote
                    initial={e.additional_notes ?? ''}
                    placeholder="Add note…"
                    saving={savingRowId === e.id}
                    onSave={v => updateEntry(e.id, { additional_notes: v || null })}
                  />
                </Td>
                <Td>
                  {e.invoice_attached_url ? (
                    <a href={e.invoice_attached_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontSize: 11 }}>PDF</a>
                  ) : (
                    <span style={{ color: '#9ca3af', fontSize: 11 }}>—</span>
                  )}
                </Td>
                <Td>
                  <InlineNote
                    initial={e.pmi_coordinator_notes ?? ''}
                    placeholder="PMI note…"
                    saving={savingRowId === e.id}
                    onSave={v => updateEntry(e.id, { pmi_coordinator_notes: v || null })}
                  />
                </Td>
                <Td>
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: e.source === 'cinc' ? '#dbeafe' : '#fef3c7', color: e.source === 'cinc' ? '#1e40af' : '#92400e' }}>
                    {e.source === 'cinc' ? 'CINC' : 'Manual'}
                  </span>
                </Td>
                <Td>
                  <input
                    type="checkbox"
                    checked={!!e.reconciled_at}
                    disabled={savingRowId === e.id}
                    onChange={ev => updateEntry(e.id, { reconciled: ev.target.checked })}
                  />
                </Td>
                <Td>
                  {e.source === 'manual' && (
                    <button
                      onClick={() => deleteEntry(e.id)}
                      style={{ padding: '2px 6px', border: '1px solid #fca5a5', background: '#fff', color: '#991b1b', fontSize: 10, borderRadius: 3, cursor: 'pointer' }}
                    >Delete</button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {bankLabel && (
        <p style={{ marginTop: 10, fontSize: 11, color: '#6b7280' }}>
          Bank: <strong>{bankLabel}</strong> · CINC payments are auto-pulled hourly + when you click Sync now. CSV export matches Isabela&apos;s spreadsheet column order.
        </p>
      )}

      {/* Manual entry modal */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 6, padding: 20, maxWidth: 500, width: '100%', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
            <h2 style={{ marginTop: 0, fontSize: 16, fontWeight: 600 }}>Add manual entry</h2>
            <p style={{ marginTop: 0, color: '#6b7280', fontSize: 12 }}>
              For bank activity CINC doesn&apos;t track (assessment income, auto-debits, interest, transfers). Use negative amounts for outflows.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <Field label="Effective date">
                <input type="date" value={newEntry.effective_date} onChange={e => setNewEntry(s => ({ ...s, effective_date: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="Amount (negative = out)">
                <input type="number" step="0.01" value={newEntry.amount} onChange={e => setNewEntry(s => ({ ...s, amount: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="Vendor / Payee">
                <input value={newEntry.vendor_payee} onChange={e => setNewEntry(s => ({ ...s, vendor_payee: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="Invoice #">
                <input value={newEntry.invoice_number} onChange={e => setNewEntry(s => ({ ...s, invoice_number: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="Description" wide>
                <input value={newEntry.description} onChange={e => setNewEntry(s => ({ ...s, description: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="Paid type" wide>
                <input placeholder="ACH / Check / Auto-debit / Online" value={newEntry.paid_type} onChange={e => setNewEntry(s => ({ ...s, paid_type: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="Additional notes" wide>
                <textarea rows={2} value={newEntry.additional_notes} onChange={e => setNewEntry(s => ({ ...s, additional_notes: e.target.value }))} style={{ ...inputStyle, resize: 'vertical' }} />
              </Field>
              <Field label="PMI Coordinator notes" wide>
                <textarea rows={2} value={newEntry.pmi_coordinator_notes} onChange={e => setNewEntry(s => ({ ...s, pmi_coordinator_notes: e.target.value }))} style={{ ...inputStyle, resize: 'vertical' }} />
              </Field>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowAdd(false)} disabled={adding} style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={submitNewEntry} disabled={adding} style={{ padding: '6px 12px', border: '1px solid #2563eb', borderRadius: 4, background: '#2563eb', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
                {adding ? 'Saving…' : 'Save entry'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = { width: '100%', padding: 5, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 3 }

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th style={{ textAlign: right ? 'right' : 'left', padding: '6px 8px', fontWeight: 600, color: '#374151', fontSize: 11, borderBottom: '1px solid #e5e7eb' }}>{children}</th>
}

function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td style={{ padding: '6px 8px', textAlign: right ? 'right' : 'left', verticalAlign: 'top' }}>{children}</td>
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined }}>
      <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 2 }}>{label}</label>
      {children}
    </div>
  )
}

function InlineNote({ initial, placeholder, saving, onSave }: { initial: string; placeholder: string; saving: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial)
  // If the row gets refreshed from the server, reset local state.
  useEffect(() => { setV(initial) }, [initial])
  return (
    <input
      value={v}
      placeholder={placeholder}
      onChange={e => setV(e.target.value)}
      onBlur={() => { if (v !== initial) onSave(v) }}
      disabled={saving}
      style={{ width: '100%', padding: 3, fontSize: 12, border: '1px solid transparent', borderRadius: 3, background: 'transparent' }}
      onFocus={e => e.currentTarget.style.border = '1px solid #d1d5db'}
    />
  )
}
