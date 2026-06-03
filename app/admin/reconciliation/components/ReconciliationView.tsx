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

// ── Upcoming Payments (future / scheduled) ───────────────────────────
interface ScheduledPayment {
  id:               number
  association_code: string
  bank_account_id:  number | null
  due_month:        string  // YYYY-MM
  due_date:         string | null
  vendor_payee:     string | null
  description:      string | null
  category:         string | null
  amount:           number  // positive magnitude
  direction:        'outflow' | 'inflow'
  series_id:        string | null
  status:           'pending' | 'paid' | 'cancelled'
  paid_date:        string | null
  notes:            string | null
}
interface UpcomingCinc { vendorName: string | null; invoiceNumber: string | null; amount: number; dueDate: string | null; scheduledPayDate: string | null; account: string }
interface UpcomingRecurring { key: string; displayName: string; avgAmount: number; lastSeenMonth: string }
interface UpcomingScheduled { vendorName: string | null; invoiceNumber: string | null; amount: number; scheduledPayDate: string }

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

  // Upcoming Payments (future) state.
  const [upManual,    setUpManual]    = useState<ScheduledPayment[]>([])
  const [upCinc,      setUpCinc]      = useState<UpcomingCinc[]>([])
  const [upRecurring, setUpRecurring] = useState<UpcomingRecurring[]>([])
  const [upScheduled, setUpScheduled] = useState<UpcomingScheduled[]>([])
  const [upLoading,   setUpLoading]   = useState(false)
  const [showFuture,  setShowFuture]  = useState(false)
  const [futureBusy,  setFutureBusy]  = useState(false)
  const [future, setFuture] = useState({ due_month: '', vendor_payee: '', description: '', category: 'insurance', amount: '', months: '1', notes: '' })

  const [forecasts,        setForecasts]        = useState<Map<number, ForecastSummary>>(new Map())
  const [forecastsLoading, setForecastsLoading] = useState(false)

  const [error,      setError]      = useState<string | null>(null)
  const [info,       setInfo]       = useState<string | null>(null)
  const [syncErrors, setSyncErrors] = useState<SyncErrorEntry[]>([])

  const [syncBusy,    setSyncBusy]    = useState(false)
  const [savingRowId, setSavingRowId] = useState<string | null>(null)

  // Invoice detail modal: the embed URL currently shown in the overlay,
  // or null when closed. Opened by clicking an Invoice #/details link.
  const [invoiceModalUrl, setInvoiceModalUrl] = useState<string | null>(null)

  // Build the invoice-detail URL for a row (direct when we hold the CINC
  // id, else the number→id lookup hop). Returns null when there's nothing
  // to link to.
  function invoiceHref(e: ReconEntry): string | null {
    if (!e.invoice_number) return null
    return e.cinc_invoice_id
      ? `/admin/invoices/cinc/${e.cinc_invoice_id}`
      : `/admin/invoices/cinc/lookup?number=${encodeURIComponent(e.invoice_number)}&assoc=${encodeURIComponent(e.association_code)}&date=${encodeURIComponent(e.effective_date)}`
  }
  // Plain click → open in the modal (embed mode). ⌘/Ctrl/middle-click keep
  // the native behaviour (open the full page in a new tab).
  function onInvoiceLinkClick(ev: React.MouseEvent, href: string | null) {
    if (!href || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return
    ev.preventDefault()
    setInvoiceModalUrl(href)   // base href; the iframe adds ?embed=1
  }

  // Close the invoice modal on Escape.
  useEffect(() => {
    if (!invoiceModalUrl) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setInvoiceModalUrl(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [invoiceModalUrl])

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

  // ── Upcoming Payments (future) ─────────────────────────────────────
  const loadUpcoming = useCallback(async () => {
    if (!assoc) { setUpManual([]); setUpCinc([]); setUpRecurring([]); setUpScheduled([]); return }
    setUpLoading(true)
    try {
      const r = await fetch(`/api/admin/reconciliation/upcoming?assoc=${encodeURIComponent(assoc)}&month=${encodeURIComponent(month)}`, { cache: 'no-store' })
      const d = await r.json()
      if (r.ok) { setUpManual(d.manual ?? []); setUpCinc(d.cinc ?? []); setUpRecurring(d.recurring ?? []); setUpScheduled(d.scheduled ?? []) }
    } catch { /* non-fatal */ }
    finally { setUpLoading(false) }
  }, [assoc, month])
  useEffect(() => { void loadUpcoming() }, [loadUpcoming])

  /** Hide a MAIA recurring estimate judged wrong/unwanted. */
  async function dismissRecurring(vendorKey: string) {
    await fetch('/api/admin/reconciliation/recurring-dismiss', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assoc, vendor_key: vendorKey }),
    })
    await loadUpcoming()
  }
  /** Turn a MAIA estimate into an editable manual entry (then hide the
   *  estimate so it doesn't double-show). Lets staff correct a wrong
   *  amount/date — the estimate itself isn't editable. */
  async function convertRecurring(r: UpcomingRecurring) {
    await fetch('/api/admin/reconciliation/scheduled', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ association_code: assoc, due_month: month, vendor_payee: r.displayName, description: 'From MAIA estimate — edit as needed', category: 'vendor', amount: Math.round(r.avgAmount * 100) / 100, months: 1 }),
    })
    await dismissRecurring(r.key)  // also reloads
  }

  async function submitFuture() {
    if (!assoc || !future.due_month || future.amount === '') { setError('Month and amount are required'); return }
    setFutureBusy(true); setError(null)
    try {
      const r = await fetch('/api/admin/reconciliation/scheduled', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ association_code: assoc, ...future, months: parseInt(future.months, 10) || 1 }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? 'Save failed')
      setShowFuture(false)
      setFuture({ due_month: month, vendor_payee: '', description: '', category: 'insurance', amount: '', months: '1', notes: '' })
      await loadUpcoming()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setFutureBusy(false) }
  }
  async function markScheduledPaid(id: number) {
    await fetch(`/api/admin/reconciliation/scheduled/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark_paid' }) })
    await loadUpcoming()
  }
  async function deleteScheduled(id: number, series: boolean) {
    if (!confirm(series ? 'Delete the entire installment series?' : 'Delete this future payment?')) return
    await fetch(`/api/admin/reconciliation/scheduled/${id}${series ? '?series=1' : ''}`, { method: 'DELETE' })
    await loadUpcoming()
  }
  /** Push a scheduled payment one month later — for deferring an outflow
   *  to a month with funds, so we don't pay while short. */
  async function postponeScheduled(id: number, currentMonth: string) {
    const [y, m] = currentMonth.split('-').map(Number)
    const d = new Date(Date.UTC(y, m, 1))  // m is 1-based → Date month m = next month
    const next = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    await fetch(`/api/admin/reconciliation/scheduled/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due_month: next, due_date: null }),
    })
    await loadUpcoming()
  }

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
              <Th stickyIndex={0}>Effective Date</Th>
              <Th stickyIndex={1}>Vendor/Payee</Th>
              <Th stickyIndex={2}>Description</Th>
              <Th stickyIndex={3}>Invoice #</Th>
              <Th stickyIndex={4} right>Amount</Th>
              <Th stickyIndex={5}>Paid Type</Th>
              <Th stickyIndex={6}>Notes</Th>
              <Th stickyIndex={7}>Invoice</Th>
              <Th stickyIndex={8}>PMI Coord.</Th>
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
              <tr><td colSpan={13 + banks.length} style={{ padding: 12, textAlign: 'center', color: '#9ca3af' }}>Loading…</td></tr>
            )}
            {!entriesLoading && entries.length === 0 && (
              <tr><td colSpan={13 + banks.length} style={{ padding: 12, textAlign: 'center', color: '#9ca3af' }}>
                {assoc ? 'No entries this month. Click "Sync now" to pull CINC payments, or "+ Manual entry" to add a row.' : 'Pick an association above.'}
              </td></tr>
            )}
            {/* Starting balance row */}
            {entries.length > 0 && (
              <tr style={{ background: '#fefce8', borderTop: '1px solid #f3f4f6', fontWeight: 600 }}>
                <Td colSpan={9} stickyIndex={0} stickyWidth={STICKY_TOTAL} bg="#fefce8">Starting balance — {new Date(month + '-01').toLocaleString('en-US', { month: 'long', year: 'numeric' })}</Td>
                {sortedBanks.map(b => (
                  <Td key={b.id} right><span style={{ fontVariantNumeric: 'tabular-nums', color: '#111827' }}>${fmt$(startingBalances.get(b.id) ?? 0)}</span></Td>
                ))}
                <Td></Td><Td></Td><Td></Td>
              </tr>
            )}
            {entries.map((e, idx) => {
              const balsAfter = runningBalances[idx] ?? new Map()
              const rowBg = e.reconciled_at ? '#f0fdf4' : '#fff'
              return (
                <tr key={e.id} style={{ background: rowBg, borderTop: '1px solid #f3f4f6' }}>
                  <Td stickyIndex={0} bg={rowBg}>{formatMD(e.effective_date)}</Td>
                  <Td stickyIndex={1} bg={rowBg}>{e.vendor_payee ?? ''}</Td>
                  <Td stickyIndex={2} bg={rowBg}>{e.description ?? ''}</Td>
                  <Td stickyIndex={3} bg={rowBg}>
                    {e.invoice_number ? (
                      <a
                        href={invoiceHref(e) ?? '#'}
                        onClick={ev => onInvoiceLinkClick(ev, invoiceHref(e))}
                        style={{ color: '#2563eb', textDecoration: 'underline' }}
                        title="Open CINC invoice detail"
                      >
                        {e.invoice_number}
                      </a>
                    ) : (
                      ''
                    )}
                  </Td>
                  <Td stickyIndex={4} right bg={rowBg}>
                    <span style={{ color: e.amount < 0 ? '#991b1b' : '#166534', fontVariantNumeric: 'tabular-nums' }}>
                      ${fmt$(Math.abs(e.amount))}
                      {e.amount < 0 ? ' ⬇' : e.amount > 0 ? ' ⬆' : ''}
                    </span>
                  </Td>
                  <Td stickyIndex={5} bg={rowBg}>
                    <InlineNote
                      initial={e.paid_type ?? ''}
                      placeholder="ACH / Check / …"
                      saving={savingRowId === e.id}
                      onSave={v => updateEntry(e.id, { paid_type: v || null })}
                    />
                  </Td>
                  <Td stickyIndex={6} bg={rowBg}>
                    <InlineNote
                      initial={e.additional_notes ?? ''}
                      placeholder="Add note…"
                      saving={savingRowId === e.id}
                      onSave={v => updateEntry(e.id, { additional_notes: v || null })}
                    />
                  </Td>
                  <Td stickyIndex={7} bg={rowBg}>
                    {e.invoice_attached_url ? (
                      <a href={e.invoice_attached_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontSize: 10 }}>PDF</a>
                    ) : e.invoice_number ? (
                      <a
                        href={invoiceHref(e) ?? '#'}
                        onClick={ev => onInvoiceLinkClick(ev, invoiceHref(e))}
                        style={{ color: '#2563eb', fontSize: 10 }}
                        title="Open CINC invoice detail"
                      >
                        details
                      </a>
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: 10 }}>—</span>
                    )}
                  </Td>
                  <Td stickyIndex={8} bg={rowBg}>
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

      {/* ── Upcoming Payments (future / scheduled) ───────────────────── */}
      {assoc && (
        <div style={{ marginTop: 28 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Upcoming Payments</h2>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6b7280' }}>
                Future / not-yet-paid: CINC approved-unpaid invoices, MAIA recurring estimates, and your manual entries (e.g. insurance installments).
                Unpaid items carry forward into later months until marked paid. {upLoading && <span style={{ color: '#9ca3af' }}>· loading…</span>}
              </p>
            </div>
            <button
              onClick={() => { setFuture(s => ({ ...s, due_month: month })); setShowFuture(v => !v) }}
              style={{ padding: '6px 12px', border: '1px solid #6b7280', borderRadius: 4, background: '#fff', color: '#111', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {showFuture ? 'Close' : '+ Add future payment'}
            </button>
          </div>

          {showFuture && (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 14, marginBottom: 10, background: '#f9fafb' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <Field label="First month (YYYY-MM)">
                  <input type="month" value={future.due_month} onChange={e => setFuture(s => ({ ...s, due_month: e.target.value }))} style={inputStyle} />
                </Field>
                <Field label="Repeat for N months (installments)">
                  <input type="number" min={1} max={36} value={future.months} onChange={e => setFuture(s => ({ ...s, months: e.target.value }))} style={inputStyle} />
                </Field>
                <Field label="Amount (per month)">
                  <input type="number" step="0.01" value={future.amount} onChange={e => setFuture(s => ({ ...s, amount: e.target.value }))} style={inputStyle} />
                </Field>
                <Field label="Vendor / Payee">
                  <input value={future.vendor_payee} onChange={e => setFuture(s => ({ ...s, vendor_payee: e.target.value }))} style={inputStyle} />
                </Field>
                <Field label="Category">
                  <select value={future.category} onChange={e => setFuture(s => ({ ...s, category: e.target.value }))} style={inputStyle}>
                    {['insurance', 'assessment', 'utility', 'vendor', 'tax', 'other'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Description">
                  <input value={future.description} onChange={e => setFuture(s => ({ ...s, description: e.target.value }))} style={inputStyle} />
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowFuture(false)} disabled={futureBusy} style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                <button onClick={submitFuture} disabled={futureBusy} style={{ padding: '6px 12px', border: '1px solid #2563eb', borderRadius: 4, background: '#2563eb', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
                  {futureBusy ? 'Saving…' : (parseInt(future.months, 10) > 1 ? `Schedule ${future.months} payments` : 'Schedule payment')}
                </button>
              </div>
            </div>
          )}

          <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 4 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  <Th>Due</Th><Th>Source</Th><Th>Vendor/Payee</Th><Th>Description</Th><Th>Category</Th>
                  <Th right>Amount</Th><Th>Status</Th><Th></Th>
                </tr>
              </thead>
              <tbody>
                {!upLoading && upManual.length === 0 && upCinc.length === 0 && upRecurring.length === 0 && upScheduled.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 12, textAlign: 'center', color: '#9ca3af' }}>Nothing upcoming. Add a future payment, or CINC approved-unpaid invoices will appear here.</td></tr>
                )}
                {/* Manual scheduled payments */}
                {upManual.map(m => {
                  const carried = m.due_month < month
                  return (
                    <tr key={`m-${m.id}`} style={{ borderTop: '1px solid #f3f4f6' }}>
                      <Td>{m.due_month}{m.due_date ? ` (${formatMD(m.due_date)})` : ''}{carried && <span style={{ marginLeft: 4, fontSize: 9, color: '#b45309', background: '#fef3c7', padding: '0 4px', borderRadius: 3 }}>carried</span>}</Td>
                      <Td><span style={{ fontSize: 9, color: '#374151', background: '#e5e7eb', padding: '1px 5px', borderRadius: 3 }}>Manual</span>{m.series_id && <span style={{ marginLeft: 3, fontSize: 9, color: '#6b7280' }}>· installment</span>}</Td>
                      <Td>{m.vendor_payee ?? ''}</Td>
                      <Td>{m.description ?? ''}</Td>
                      <Td>{m.category ?? ''}</Td>
                      <Td right><span style={{ color: m.direction === 'inflow' ? '#166534' : '#991b1b', fontVariantNumeric: 'tabular-nums' }}>${fmt$(m.amount)} {m.direction === 'inflow' ? '⬆' : '⬇'}</span></Td>
                      <Td><span style={{ fontSize: 10, color: '#92400e' }}>pending</span></Td>
                      <Td>
                        <button onClick={() => void markScheduledPaid(m.id)} title="Mark as paid" style={{ fontSize: 10, color: '#16a34a', border: '1px solid #bbf7d0', background: '#fff', borderRadius: 3, padding: '1px 6px', cursor: 'pointer', marginRight: 4 }}>Paid</button>
                        <button onClick={() => void postponeScheduled(m.id, m.due_month)} title="Postpone one month (defer to a month with funds)" style={{ fontSize: 10, color: '#b45309', border: '1px solid #fde68a', background: '#fff', borderRadius: 3, padding: '1px 6px', cursor: 'pointer', marginRight: 4 }}>Postpone ▸</button>
                        <button onClick={() => void deleteScheduled(m.id, false)} title="Delete" style={{ fontSize: 11, color: '#9ca3af', border: 'none', background: 'transparent', cursor: 'pointer' }}>×</button>
                        {m.series_id && <button onClick={() => void deleteScheduled(m.id, true)} title="Delete whole series" style={{ fontSize: 9, color: '#9ca3af', border: 'none', background: 'transparent', cursor: 'pointer' }}>×series</button>}
                      </Td>
                    </tr>
                  )
                })}
                {/* CINC approved-unpaid invoices */}
                {upCinc.map((c, i) => (
                  <tr key={`c-${i}`} style={{ borderTop: '1px solid #f3f4f6', background: '#f8fafc' }}>
                    <Td>
                      {c.scheduledPayDate
                        ? <>{formatMD(c.scheduledPayDate)}<span style={{ marginLeft: 4, fontSize: 9, color: '#1e40af', background: '#dbeafe', padding: '0 4px', borderRadius: 3 }}>scheduled</span>
                            {c.dueDate && c.dueDate.slice(0, 10) !== c.scheduledPayDate.slice(0, 10) && <span style={{ marginLeft: 4, color: '#9ca3af', fontSize: 9 }}>due {formatMD(c.dueDate)}</span>}</>
                        : (c.dueDate ? formatMD(c.dueDate) : '—')}
                    </Td>
                    <Td><span style={{ fontSize: 9, color: '#1e40af', background: '#dbeafe', padding: '1px 5px', borderRadius: 3 }}>CINC · approved</span></Td>
                    <Td>{c.vendorName ?? ''}</Td>
                    <Td>{c.invoiceNumber ? `Inv.#${c.invoiceNumber}` : ''} <span style={{ color: '#9ca3af' }}>· {c.account}</span></Td>
                    <Td></Td>
                    <Td right><span style={{ color: '#991b1b', fontVariantNumeric: 'tabular-nums' }}>${fmt$(c.amount)} ⬇</span></Td>
                    <Td><span style={{ fontSize: 10, color: '#1e40af' }}>ready to pay</span></Td>
                    <Td></Td>
                  </tr>
                ))}
                {/* MAIA scheduled — audited invoices not yet pushed to CINC */}
                {upScheduled.map((s, i) => {
                  const carried = s.scheduledPayDate.slice(0, 7) < month
                  return (
                    <tr key={`s-${i}`} style={{ borderTop: '1px solid #f3f4f6', background: '#f5f3ff' }}>
                      <Td>{formatMD(s.scheduledPayDate)}{carried && <span style={{ marginLeft: 4, fontSize: 9, color: '#b45309', background: '#fef3c7', padding: '0 4px', borderRadius: 3 }}>carried</span>}</Td>
                      <Td><span style={{ fontSize: 9, color: '#6d28d9', background: '#ede9fe', padding: '1px 5px', borderRadius: 3 }}>MAIA · scheduled</span></Td>
                      <Td>{s.vendorName ?? ''}</Td>
                      <Td>{s.invoiceNumber ? `Inv.#${s.invoiceNumber}` : ''} <span style={{ color: '#9ca3af' }}>· not pushed yet</span></Td>
                      <Td></Td>
                      <Td right><span style={{ color: '#991b1b', fontVariantNumeric: 'tabular-nums' }}>${fmt$(s.amount)} ⬇</span></Td>
                      <Td><span style={{ fontSize: 10, color: '#6d28d9' }}>scheduled</span></Td>
                      <Td></Td>
                    </tr>
                  )
                })}
                {/* MAIA recurring estimates */}
                {upRecurring.map((r, i) => (
                  <tr key={`r-${i}`} style={{ borderTop: '1px solid #f3f4f6', background: '#fffdf7' }}>
                    <Td>~ {month}</Td>
                    <Td><span style={{ fontSize: 9, color: '#92400e', background: '#fef3c7', padding: '1px 5px', borderRadius: 3 }}>MAIA estimate</span></Td>
                    <Td>{r.displayName}</Td>
                    <Td><span style={{ color: '#9ca3af' }}>recurring · last seen {r.lastSeenMonth}</span></Td>
                    <Td></Td>
                    <Td right><span style={{ color: '#b45309', fontVariantNumeric: 'tabular-nums' }}>~${fmt$(r.avgAmount)} ⬇</span></Td>
                    <Td><span style={{ fontSize: 10, color: '#b45309' }}>estimated</span></Td>
                    <Td>
                      <button onClick={() => void convertRecurring(r)} title="Convert to an editable manual entry (fix the amount/date)" style={{ fontSize: 10, color: '#2563eb', border: '1px solid #bfdbfe', background: '#fff', borderRadius: 3, padding: '1px 6px', cursor: 'pointer', marginRight: 4 }}>→ Manual</button>
                      <button onClick={() => void dismissRecurring(r.key)} title="Dismiss — wrong/unwanted estimate; hide it" style={{ fontSize: 11, color: '#9ca3af', border: 'none', background: 'transparent', cursor: 'pointer' }}>×</button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

      {/* Invoice detail modal — embeds the invoice-detail page (chrome-less)
          in an overlay so Karen can peek at an invoice without leaving the
          ledger. Click the backdrop or ✕ (or press Esc) to close. */}
      {invoiceModalUrl && (
        <div
          onClick={() => setInvoiceModalUrl(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            onClick={ev => ev.stopPropagation()}
            style={{ background: '#fff', borderRadius: 8, width: 'min(1100px, 96vw)', height: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Invoice detail</span>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <a href={invoiceModalUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#2563eb', textDecoration: 'none' }}>Open full page ↗</a>
                <button
                  onClick={() => setInvoiceModalUrl(null)}
                  style={{ fontSize: 12, fontWeight: 600, color: '#374151', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}
                >
                  ✕ Close
                </button>
              </div>
            </div>
            <iframe
              src={`${invoiceModalUrl}${invoiceModalUrl.includes('?') ? '&' : '?'}embed=1`}
              title="Invoice detail"
              style={{ flex: 1, width: '100%', border: 'none' }}
            />
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

// Frozen-column widths (px) for the ledger's leading identity columns —
// Effective Date, Vendor/Payee, Description, Invoice #, Amount, Paid Type,
// Notes, Invoice, PMI Coord. — so they stay visible while scrolling right
// across many bank-account columns.
// `left` is the cumulative offset; `STICKY_TOTAL` is the full frozen width.
const STICKY_W = [92, 130, 220, 92, 96, 100, 150, 60, 120]
const STICKY_LEFT = STICKY_W.reduce<number[]>((acc, w, i) => { acc.push(i === 0 ? 0 : acc[i - 1] + STICKY_W[i - 1]); return acc }, [])
const STICKY_TOTAL = STICKY_W.reduce((s, w) => s + w, 0)

function Th({ children, right, stickyIndex }: { children?: React.ReactNode; right?: boolean; stickyIndex?: number }) {
  const s = stickyIndex != null
  return <th style={{
    textAlign: right ? 'right' : 'left', padding: '5px 6px', fontWeight: 600, color: '#374151', fontSize: 10,
    borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap',
    ...(s ? { position: 'sticky' as const, left: STICKY_LEFT[stickyIndex], width: STICKY_W[stickyIndex], minWidth: STICKY_W[stickyIndex], background: '#f3f4f6', zIndex: 5 } : {}),
  }}>{children}</th>
}

function Td({ children, right, colSpan, stickyIndex, bg, stickyWidth }: { children?: React.ReactNode; right?: boolean; colSpan?: number; stickyIndex?: number; bg?: string; stickyWidth?: number }) {
  const s = stickyIndex != null
  const w = stickyWidth ?? (s ? STICKY_W[stickyIndex] : undefined)
  return <td colSpan={colSpan} style={{
    padding: '4px 6px', textAlign: right ? 'right' : 'left', verticalAlign: 'top', whiteSpace: 'nowrap',
    ...(s ? { position: 'sticky' as const, left: STICKY_LEFT[stickyIndex], width: w, minWidth: w, background: bg ?? '#fff', zIndex: 2 } : {}),
  }}>{children}</td>
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
