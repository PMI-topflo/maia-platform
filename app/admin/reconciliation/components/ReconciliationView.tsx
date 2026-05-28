// =====================================================================
// app/admin/reconciliation/components/ReconciliationView.tsx
// Client component. Multi-account ledger view per (association, month)
// — matches Isabela's existing Google-Sheet format.
//
// Header: assoc picker, month picker, Sync button, Download CSV button,
//   Add manual entry button. PLUS per-bank-account forecast cards
//   (current balance / approved unpaid / recurring projected / EOM).
//
// Table: every transaction sorted by effective_date ascending. Each
//   row hits exactly ONE bank account; that account's column shows the
//   running balance after the transaction, other columns carry the
//   prior balance forward unchanged. Dates render as MM/DD/YYYY.
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
  cincBalance:  number | null
  cashGl:       string | null
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

interface ForecastSummary {
  bankAccountId:          number
  bankAccountDescription: string
  currentBalance:         number
  approvedUnpaid:         number
  recurringProjected:     number
  projectedEomBalance:    number
  willOverdraw:           boolean
}

interface SyncErrorEntry {
  bankAccountDescription?: string
  bankAccountId?:          number
  message:                 string
}

interface Props {
  associations:   Association[]
  initialAssoc:   string
  initialAccount: string  // legacy — ignored in this multi-account refactor
  initialMonth:   string  // 'YYYY-MM'
}

// ── Date helpers ────────────────────────────────────────────────────
function formatMD(isoDate: string): string {
  // 'YYYY-MM-DD' → 'M/D/YYYY' (Karen's preferred format)
  const [y, m, d] = isoDate.split('-')
  if (!y || !m || !d) return isoDate
  return `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}`
}

function fmt$(n: number | null | undefined): string {
  if (n == null) return ''
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ReconciliationView(props: Props) {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [assoc, setAssoc] = useState(props.initialAssoc)
  const [month, setMonth] = useState(props.initialMonth)

  const [banks,        setBanks]        = useState<BankAccountOption[]>([])
  const [banksLoading, setBanksLoading] = useState(false)

  const [entries,        setEntries]        = useState<ReconEntry[]>([])
  const [entriesLoading, setEntriesLoading] = useState(false)

  const [forecasts,        setForecasts]        = useState<Map<number, ForecastSummary>>(new Map())
  const [forecastsLoading, setForecastsLoading] = useState(false)

  const [error,      setError]      = useState<string | null>(null)
  const [info,       setInfo]       = useState<string | null>(null)
  const [syncErrors, setSyncErrors] = useState<SyncErrorEntry[]>([])

  const [syncBusy,    setSyncBusy]    = useState(false)
  const [savingRowId, setSavingRowId] = useState<string | null>(null)

  // ── Bank ordering + grouping ──────────────────────────────────────
  // Karen wants SSB accounts (which auto-sync from CINC) clearly
  // separated from non-SSB accounts (Popular, Truist, etc — those are
  // reconciled manually by Shemaiah's team + Isabela). Within the SSB
  // group, the operating account comes first, then other SSB accounts.
  // The order applies to BOTH the forecast cards at the top AND the
  // running-balance columns in the ledger table.
  function isSsbAccount(bank: BankAccountOption): boolean {
    return /\bSSB\b/i.test(bank.description ?? '')
  }
  function bankSortKey(bank: BankAccountOption): number {
    // Lower = appears first.
    //   0-9   : SSB Operating (one or more — sub-sort by description)
    //   10-19 : Other SSB accounts (reserve / SA / etc.)
    //   100+  : Non-SSB accounts
    if (isSsbAccount(bank)) {
      return bank.kind === 'operating' ? 0 : 10
    }
    return 100
  }
  const sortedBanks = useMemo(() => {
    return [...banks].sort((a, b) => {
      const ka = bankSortKey(a)
      const kb = bankSortKey(b)
      if (ka !== kb) return ka - kb
      return (a.description ?? '').localeCompare(b.description ?? '')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banks])

  const ssbBanks   = useMemo(() => sortedBanks.filter(b => isSsbAccount(b)), [sortedBanks])
  const otherBanks = useMemo(() => sortedBanks.filter(b => !isSsbAccount(b)), [sortedBanks])

  // ── URL sync ──────────────────────────────────────────────────────
  function pushUrlState(next: Partial<{ assoc: string; month: string }>) {
    const params = new URLSearchParams(searchParams.toString())
    const fields = { assoc, month, ...next }
    if (fields.assoc) params.set('assoc', fields.assoc); else params.delete('assoc')
    if (fields.month) params.set('month', fields.month); else params.delete('month')
    params.delete('account')  // legacy
    router.replace(`?${params.toString()}`)
  }

  // ── Bank accounts ─────────────────────────────────────────────────
  useEffect(() => {
    if (!assoc) { setBanks([]); return }
    setBanksLoading(true)
    fetch(`/api/admin/cinc/bank-accounts?assoc=${encodeURIComponent(assoc)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (data?.error) throw new Error(data.error)
        setBanks((data.accounts ?? []) as BankAccountOption[])
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBanksLoading(false))
  }, [assoc])

  // ── Entries (all bank accounts for assoc + month) ────────────────
  const loadEntries = useCallback(async () => {
    if (!assoc) { setEntries([]); return }
    setEntriesLoading(true); setError(null)
    try {
      const r = await fetch(
        `/api/admin/reconciliation?assoc=${encodeURIComponent(assoc)}&month=${encodeURIComponent(month)}`,
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
  }, [assoc, month])

  useEffect(() => { void loadEntries() }, [loadEntries])

  // ── Forecasts (one per bank account, fetched in parallel) ────────
  const loadForecasts = useCallback(async () => {
    if (!assoc || banks.length === 0) { setForecasts(new Map()); return }
    setForecastsLoading(true)
    try {
      const results = await Promise.all(banks.map(b =>
        fetch(`/api/admin/cinc/forecast?assoc=${encodeURIComponent(assoc)}&account=${b.id}`, { cache: 'no-store' })
          .then(r => r.json())
          .catch(() => null),
      ))
      const map = new Map<number, ForecastSummary>()
      for (const f of results) {
        if (f && typeof f.bankAccountId === 'number') {
          map.set(f.bankAccountId, f)
        }
      }
      setForecasts(map)
    } catch { /* silent — forecasts are informational */ }
    finally { setForecastsLoading(false) }
  }, [assoc, banks])

  useEffect(() => { void loadForecasts() }, [loadForecasts])

  // ── Per-row running balance ───────────────────────────────────────
  // For each bank account, start at (currentBalance − sum_of_entries_in_window)
  // and walk the entries chronologically, updating only the affected account.
  //
  // This makes the rightmost row's per-account running balance roughly equal
  // to the current CINC balance for that account, as long as the displayed
  // month contains the full set of transactions through "today".
  const startingBalances = useMemo(() => {
    const map = new Map<number, number>()
    for (const b of banks) {
      const sumOfMonth = entries
        .filter(e => e.bank_account_id === b.id)
        .reduce((s, e) => s + e.amount, 0)
      const current = b.cincBalance ?? b.bankBalance ?? 0
      map.set(b.id, current - sumOfMonth)
    }
    return map
  }, [banks, entries])

  /** For each entry index, the per-account running balance AFTER that
   *  transaction. Account columns that weren't touched in this row carry
   *  the prior balance forward unchanged. */
  const runningBalances = useMemo(() => {
    const rows: Map<number, number>[] = []
    const current = new Map(startingBalances)
    for (const e of entries) {
      const prior = current.get(e.bank_account_id) ?? 0
      current.set(e.bank_account_id, prior + e.amount)
      rows.push(new Map(current))
    }
    return rows
  }, [entries, startingBalances])

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
      await loadForecasts()
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
    bank_account_id: '',
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
    if (!assoc || !newEntry.bank_account_id) {
      setError('Pick a bank account in the modal before saving.')
      return
    }
    if (!newEntry.effective_date || newEntry.amount === '') {
      setError('Effective date + amount are required.')
      return
    }
    setAdding(true); setError(null)
    try {
      const bank = banks.find(b => String(b.id) === newEntry.bank_account_id)
      const r = await fetch('/api/admin/reconciliation', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          association_code:           assoc,
          bank_account_id:            parseInt(newEntry.bank_account_id, 10),
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
      setEntries(prev => [...prev, data.entry].sort((a, b) =>
        a.effective_date.localeCompare(b.effective_date) || a.created_at.localeCompare(b.created_at),
      ))
      setShowAdd(false)
      setNewEntry({
        bank_account_id: '',
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

  // ── Totals strip ──────────────────────────────────────────────────
  const totals = useMemo(() => {
    let inflow = 0, outflow = 0, reconciled = 0, unreconciled = 0
    for (const e of entries) {
      if (e.amount > 0) inflow  += e.amount
      else              outflow += e.amount
      if (e.reconciled_at) reconciled++; else unreconciled++
    }
    return { inflow, outflow, net: inflow + outflow, reconciled, unreconciled }
  }, [entries])

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1800, margin: '24px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Bank reconciliation</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>All bank accounts for the association on one page. CINC activity auto-pulled hourly.</p>
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
            href={assoc ? `/api/admin/reconciliation/export?assoc=${encodeURIComponent(assoc)}&month=${encodeURIComponent(month)}` : '#'}
            onClick={e => { if (!assoc) e.preventDefault() }}
            style={{ padding: '6px 12px', border: '1px solid #16a34a', borderRadius: 4, background: '#fff', color: '#16a34a', fontSize: 13, textDecoration: 'none', cursor: assoc ? 'pointer' : 'default' }}
          >
            Download CSV
          </a>
          <button
            onClick={() => setShowAdd(true)}
            disabled={!assoc || banks.length === 0}
            style={{ padding: '6px 12px', border: '1px solid #6b7280', borderRadius: 4, background: '#fff', color: '#111', fontSize: 13, cursor: assoc && banks.length > 0 ? 'pointer' : 'default' }}
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
            onChange={e => { const v = e.target.value.toUpperCase(); setAssoc(v); pushUrlState({ assoc: v }) }}
            style={{ marginLeft: 6, padding: 4 }}
          >
            <option value="">— pick —</option>
            {props.associations.map(a => (
              <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
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

      {error     && <div style={{ padding: 10, marginBottom: 10, background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 4, color: '#991b1b', fontSize: 13 }}>{error}</div>}
      {info      && <div style={{ padding: 10, marginBottom: syncErrors.length > 0 ? 4 : 10, background: '#dcfce7', border: '1px solid #86efac', borderRadius: 4, color: '#166534', fontSize: 13 }}>{info}</div>}
      {syncErrors.length > 0 && (
        <div style={{ padding: 10, marginBottom: 10, background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, color: '#92400e', fontSize: 12 }}>
          <div style={{ marginBottom: 6 }}>
            <strong>Sync errors</strong> — these bank accounts couldn&apos;t be fetched this run. Existing rows are unaffected.
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

      {/* Forecast cards — grouped by source.
          SSB accounts auto-sync from CINC (real-time activity).
          Non-SSB accounts (Popular, Truist, etc.) are reconciled manually
          by the CINC team + Isabela — balance is correct but transaction
          rows here may lag. Visually separated so Karen knows at a glance
          which data she can trust as up-to-the-minute. */}
      {ssbBanks.length > 0 && (
        <BankGroupCards
          title="Auto-synced from CINC"
          subtitle="Activity pulled from CINC's GL transactions every hour."
          containerBg="#f0f9ff"
          containerBorder="#bae6fd"
          accentLabel="SSB"
          banks={ssbBanks}
          forecasts={forecasts}
          forecastsLoading={forecastsLoading}
        />
      )}
      {otherBanks.length > 0 && (
        <BankGroupCards
          title="Manually reconciled"
          subtitle="Balances entered by the CINC team + Isabela. CINC doesn't auto-sync transaction activity for these banks."
          containerBg="#fffbeb"
          containerBorder="#fde68a"
          accentLabel="Manual"
          banks={otherBanks}
          forecasts={forecasts}
          forecastsLoading={forecastsLoading}
        />
      )}

      {/* Totals strip */}
      {entries.length > 0 && (
        <div style={{ display: 'flex', gap: 16, padding: '8px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 4, marginBottom: 10, fontSize: 12 }}>
          <span><strong>Inflow:</strong> ${fmt$(totals.inflow)}</span>
          <span><strong>Outflow:</strong> ${fmt$(totals.outflow)}</span>
          <span><strong>Net:</strong> ${fmt$(totals.net)}</span>
          <span style={{ marginLeft: 'auto' }}>
            <strong>{totals.reconciled}</strong> reconciled · <strong>{totals.unreconciled}</strong> pending
          </span>
        </div>
      )}

      {/* Multi-account ledger table — matches Isabela's spreadsheet
          format. Each row hits exactly ONE bank account; the running
          balance for that account is in its column; the other accounts'
          columns carry the prior balance forward unchanged. */}
      <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
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
              <Th>PMI Coord.</Th>
              {sortedBanks.map(b => (
                <Th key={b.id} right>{b.description}</Th>
              ))}
              <Th>Src</Th>
              <Th>Rec.</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {entriesLoading && (
              <tr><td colSpan={14 + banks.length} style={{ padding: 12, textAlign: 'center', color: '#9ca3af' }}>Loading…</td></tr>
            )}
            {!entriesLoading && entries.length === 0 && (
              <tr><td colSpan={14 + banks.length} style={{ padding: 12, textAlign: 'center', color: '#9ca3af' }}>
                {assoc ? 'No entries this month. Click "Sync now" to pull CINC payments, or "+ Manual entry" to add a row.' : 'Pick an association above.'}
              </td></tr>
            )}
            {/* Starting balance row */}
            {entries.length > 0 && (
              <tr style={{ background: '#fefce8', borderTop: '1px solid #f3f4f6', fontWeight: 600 }}>
                <Td colSpan={10}>Starting balance — {new Date(month + '-01').toLocaleString('en-US', { month: 'long', year: 'numeric' })}</Td>
                {sortedBanks.map(b => (
                  <Td key={b.id} right><span style={{ fontVariantNumeric: 'tabular-nums', color: '#111827' }}>${fmt$(startingBalances.get(b.id) ?? 0)}</span></Td>
                ))}
                <Td></Td><Td></Td><Td></Td>
              </tr>
            )}
            {entries.map((e, idx) => {
              const balsAfter = runningBalances[idx] ?? new Map()
              return (
                <tr key={e.id} style={{ background: e.reconciled_at ? '#f0fdf4' : '#fff', borderTop: '1px solid #f3f4f6' }}>
                  <Td>{formatMD(e.effective_date)}</Td>
                  <Td>{e.customer ?? ''}</Td>
                  <Td>{e.vendor_payee ?? ''}</Td>
                  <Td>{e.description ?? ''}</Td>
                  <Td>{e.invoice_number ?? ''}</Td>
                  <Td right>
                    <span style={{ color: e.amount < 0 ? '#991b1b' : '#166534', fontVariantNumeric: 'tabular-nums' }}>
                      ${fmt$(Math.abs(e.amount))}
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
                      <a href={e.invoice_attached_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontSize: 10 }}>PDF</a>
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: 10 }}>—</span>
                    )}
                  </Td>
                  <Td>
                    <InlineNote
                      initial={e.pmi_coordinator_notes ?? ''}
                      placeholder="PMI…"
                      saving={savingRowId === e.id}
                      onSave={v => updateEntry(e.id, { pmi_coordinator_notes: v || null })}
                    />
                  </Td>
                  {sortedBanks.map(b => {
                    const bal     = balsAfter.get(b.id) ?? 0
                    const touched = b.id === e.bank_account_id
                    return (
                      <Td key={b.id} right>
                        <span style={{
                          fontVariantNumeric: 'tabular-nums',
                          color: touched ? '#111827' : '#9ca3af',
                          fontWeight: touched ? 600 : 400,
                        }}>
                          ${fmt$(bal)}
                        </span>
                      </Td>
                    )
                  })}
                  <Td>
                    <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: e.source === 'cinc' ? '#dbeafe' : '#fef3c7', color: e.source === 'cinc' ? '#1e40af' : '#92400e' }}>
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
                        style={{ padding: '1px 5px', border: '1px solid #fca5a5', background: '#fff', color: '#991b1b', fontSize: 9, borderRadius: 3, cursor: 'pointer' }}
                      >Del</button>
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 10, fontSize: 11, color: '#6b7280' }}>
        Running-balance columns are computed: starting balance = current CINC balance − sum of this month&apos;s entries for that account, then walked forward chronologically. Account columns highlighted black/bold = touched in that row; gray = carried forward unchanged.
      </p>

      {/* Manual entry modal */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 6, padding: 20, maxWidth: 500, width: '100%', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
            <h2 style={{ marginTop: 0, fontSize: 16, fontWeight: 600 }}>Add manual entry</h2>
            <p style={{ marginTop: 0, color: '#6b7280', fontSize: 12 }}>
              For bank activity CINC doesn&apos;t track. Use negative amounts for outflows. Pick which bank account this entry hits.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <Field label="Bank account" wide>
                <select value={newEntry.bank_account_id} onChange={e => setNewEntry(s => ({ ...s, bank_account_id: e.target.value }))} style={inputStyle}>
                  <option value="">— pick —</option>
                  {sortedBanks.map(b => <option key={b.id} value={String(b.id)}>{b.description}</option>)}
                </select>
              </Field>
              <Field label="Effective date">
                <input type="date" value={newEntry.effective_date} onChange={e => setNewEntry(s => ({ ...s, effective_date: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="Amount (neg = out)">
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

/** Forecast cards grouped under a labelled container — used to visually
 *  separate auto-synced (SSB) accounts from manually-reconciled
 *  (Popular/Truist/etc) accounts. The container itself has a tinted
 *  background; each card inside still color-codes by EOM health. */
function BankGroupCards(props: {
  title:           string
  subtitle:        string
  containerBg:     string
  containerBorder: string
  accentLabel:     string
  banks:           BankAccountOption[]
  forecasts:       Map<number, ForecastSummary>
  forecastsLoading: boolean
}) {
  if (props.banks.length === 0) return null
  return (
    <div style={{ padding: 10, background: props.containerBg, border: `1px solid ${props.containerBorder}`, borderRadius: 6, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#111827', textTransform: 'uppercase', letterSpacing: 0.5 }}>{props.title}</span>
          <span style={{ marginLeft: 6, fontSize: 11, color: '#6b7280' }}>· {props.subtitle}</span>
        </div>
        <span style={{ fontSize: 10, padding: '2px 6px', background: '#fff', border: `1px solid ${props.containerBorder}`, borderRadius: 3, color: '#374151' }}>{props.accentLabel}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(props.banks.length, 4)}, 1fr)`, gap: 8 }}>
        {props.banks.map(b => {
          const f      = props.forecasts.get(b.id)
          const eom    = f?.projectedEomBalance ?? (b.cincBalance ?? b.bankBalance ?? 0)
          const danger = f?.willOverdraw ?? false
          const tight  = !danger && eom < 1000
          const bg     = danger ? '#fee2e2' : tight ? '#fef3c7' : '#fff'
          const border = danger ? '#fca5a5' : tight ? '#fcd34d' : '#e5e7eb'
          return (
            <div key={b.id} style={{ padding: 10, background: bg, border: `1px solid ${border}`, borderRadius: 4, fontSize: 11 }}>
              <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 4, color: '#111827' }}>{b.description}</div>
              <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Current</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', fontVariantNumeric: 'tabular-nums' }}>${fmt$(b.cincBalance ?? b.bankBalance)}</div>
              {f && (
                <>
                  <div style={{ marginTop: 6, fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>EOM projection</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: danger ? '#991b1b' : tight ? '#92400e' : '#065f46', fontVariantNumeric: 'tabular-nums' }}>
                    {danger ? '−' : ''}${fmt$(Math.abs(eom))}
                  </div>
                  {(f.approvedUnpaid > 0 || f.recurringProjected > 0) && (
                    <div style={{ marginTop: 4, fontSize: 10, color: '#4b5563' }}>
                      −${fmt$(f.approvedUnpaid)} unpaid · −${fmt$(f.recurringProjected)} recurring
                    </div>
                  )}
                </>
              )}
              {props.forecastsLoading && !f && <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>Loading EOM…</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th style={{ textAlign: right ? 'right' : 'left', padding: '5px 6px', fontWeight: 600, color: '#374151', fontSize: 10, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{children}</th>
}

function Td({ children, right, colSpan }: { children?: React.ReactNode; right?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} style={{ padding: '4px 6px', textAlign: right ? 'right' : 'left', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{children}</td>
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
  useEffect(() => { setV(initial) }, [initial])
  return (
    <input
      value={v}
      placeholder={placeholder}
      onChange={e => setV(e.target.value)}
      onBlur={() => { if (v !== initial) onSave(v) }}
      disabled={saving}
      style={{ width: '100%', padding: 2, fontSize: 11, border: '1px solid transparent', borderRadius: 3, background: 'transparent' }}
      onFocus={e => e.currentTarget.style.border = '1px solid #d1d5db'}
    />
  )
}
