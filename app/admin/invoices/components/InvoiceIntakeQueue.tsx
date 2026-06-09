// =====================================================================
// app/admin/invoices/components/InvoiceIntakeQueue.tsx
// Client component. Tabs across the top (pending review / needs vendor
// / duplicates / pushed / rejected), card per draft, inline edit +
// push/reject/rematch actions.
// =====================================================================

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface Vendor      { id: number;  name: string; shortName: string | null; dba?: string | null }
interface Association { code: string; name: string }

interface Draft {
  id:                          number
  gmail_message_id:            string | null
  pdf_storage_key:             string | null
  pdf_signed_url:              string | null
  extracted_vendor_name:       string | null
  matched_cinc_vendor_id:      string | null
  matched_vendor_name:         string | null
  matched_vendor_short_name:   string | null
  extracted_invoice_number:    string | null
  extracted_account_number:    string | null
  extracted_amount:            number | null
  extracted_association_code:  string | null
  extracted_invoice_date:      string | null
  due_date:                    string | null
  scheduled_pay_date:          string | null
  gl_account_id:               string | null
  gl_account_name:             string | null
  pay_by_type:                 string | null
  observation_note:            string | null
  work_order_number:           number | null
  pay_from_bank_account_id:    number | null
  extraction_confidence:       number | null
  status:                      string
  audit_checklist:             Record<string, boolean> | null
  audit_ready_by:              string | null
  audit_ready_at:              string | null
  rejected_reason:             string | null
  cinc_invoice_id:             string | null
  cinc_dup_invoice_id:         string | null
  drive_file_id:               string | null
  pushed_at:                   string | null
  pushed_by:                   string | null
  hold_requested_items:        string[] | null
  hold_ticket_id:              number | null
  hold_requested_at:           string | null
  hold_note:                   string | null
  created_at:                  string
  updated_at:                  string
}

interface BankAccountOption {
  id:               number
  description:      string
  last4:            string | null
  cashGl:           string | null
  kind:             'operating' | 'reserve' | 'special' | 'other'
  bankBalance:      number | null
  cincBalance:      number | null
  restricted:       boolean
  restrictionLabel: string | null
}

interface PayByOption { value: string; label: string }
interface WorkOrderOption {
  number:      number
  description: string
  vendor:      string | null
  createdDate: string | null
  status:      string | null
}

interface BudgetGlOption {
  id:        string
  number:    string | null
  name:      string
  budget:    number | null
  actual:    number | null
  remaining: number | null
}

// Decide whether a MAIA GL suggestion is confident enough to pre-fill the
// dropdown automatically. The vendor-context endpoint encodes confidence in
// the `source` string: an explicit "CINC vendor account" mapping, or
// "N past invoice(s)". We auto-fill on the explicit mapping or ≥2 past
// invoices; a single "last MAIA invoice" data point stays a manual "Use it".
function isHighConfidenceGl(source?: string): boolean {
  if (!source) return false
  if (/cinc vendor account/i.test(source)) return true
  const m = source.match(/(\d+)\s+past invoice/i)
  return m ? Number(m[1]) >= 2 : false
}

const TABS: Array<{ key: string; label: string }> = [
  // 'Pending review' folds in no-vendor AND CINC-duplicate drafts — the
  // audit checklist assigns the vendor and its duplicate guard hard-blocks
  // marking a duplicate ready, so neither needs its own tab.
  { key: 'pending_review',    label: 'Pending review' },
  { key: 'on_hold',           label: 'On hold' },
  { key: 'ready_to_push',     label: 'Ready to push' },
  { key: 'pushed_to_cinc',    label: 'Archived' },   // pushed-to-CINC invoices are the archive (renamed from 'Pushed')
  { key: 'rejected',          label: 'Rejected' },
]

interface Props {
  initialStatus: string
  initialDrafts: Draft[]
  initialCounts: Record<string, number>
  vendors:       Vendor[]
  associations:  Association[]
}

export default function InvoiceIntakeQueue(props: Props) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState(props.initialStatus)
  const [drafts, setDrafts] = useState<Draft[]>(props.initialDrafts)
  // One invoice on screen at a time; idx is the position within the current
  // tab's list. The ◀ ▶ pager moves through them (Karen's request).
  const [idx, setIdx]       = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>(props.initialCounts)
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const fetchTab = useCallback(async (s: string) => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/admin/invoices/intake?status=${encodeURIComponent(s)}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      const list = (data.drafts ?? []) as Draft[]
      setDrafts(list)
      // Keep the pager in range after a refresh (e.g. a card moved tabs and
      // the list shrank) — clamp to the last item instead of going blank.
      setIdx(i => Math.max(0, Math.min(i, list.length - 1)))
      setCounts(data.counts ?? {})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  function switchTab(s: string) {
    setStatus(s)
    setIdx(0)   // start at the first invoice of the new tab
    const params = new URLSearchParams(searchParams.toString())
    params.set('status', s)
    router.replace(`?${params.toString()}`)
    void fetchTab(s)
  }

  async function refreshVendorCache() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/admin/vendors/cache/refresh', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      alert(`Vendor cache refreshed (${data.vendorCount} vendors).`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function seedAccountRoutes() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/admin/invoices/seed-account-routes', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      alert(`Account routes seeded from CINC (${data.routesSeeded} routes across ${data.vendorsScanned} utility vendors).`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '24px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Invoice intake</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={seedAccountRoutes}
            disabled={busy}
            title="Build the utility account-number → vendor/association/GL map from CINC. Run once; safe to re-run."
            style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }}
          >
            Seed account routes
          </button>
          <button
            onClick={refreshVendorCache}
            disabled={busy}
            style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }}
          >
            Refresh CINC vendor cache
          </button>
        </div>
      </header>

      <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
        {TABS.map(t => {
          const active = t.key === status
          // Pending review folds in no-vendor + CINC-duplicate drafts (no separate tabs).
          const count  = (counts[t.key] ?? 0) + (t.key === 'pending_review' ? ((counts['needs_vendor'] ?? 0) + (counts['duplicate_in_cinc'] ?? 0)) : 0)
          return (
            <button
              key={t.key}
              role="tab"
              onClick={() => switchTab(t.key)}
              style={{
                padding: '8px 12px', fontSize: 13, border: 'none', background: 'transparent',
                borderBottom: active ? '2px solid #f26a1b' : '2px solid transparent',
                color:        active ? '#111827' : '#6b7280', fontWeight: active ? 600 : 400, cursor: 'pointer',
              }}
            >
              {t.label}
              {count > 0 && (
                <span style={{
                  marginLeft: 6, fontSize: 11, padding: '2px 6px', borderRadius: 10,
                  background: active ? '#fef3c7' : '#f3f4f6', color: '#374151',
                }}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {error && (
        <div style={{ padding: 10, marginBottom: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 4, fontSize: 13 }}>
          {error}
        </div>
      )}

      {busy && <div style={{ color: '#6b7280', fontSize: 13, padding: 8 }}>Loading…</div>}

      {!busy && drafts.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 14, background: '#f9fafb', borderRadius: 6 }}>
          No drafts in <em>{status.replace(/_/g, ' ')}</em>.
        </div>
      )}

      {!busy && drafts.length > 0 && (() => {
        const safeIdx = Math.max(0, Math.min(idx, drafts.length - 1))
        const current = drafts[safeIdx]
        const atFirst = safeIdx === 0
        const atLast  = safeIdx >= drafts.length - 1
        return (
          <>
            {/* Pager — one invoice per view; ◀ N/total ▶ on the right. */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={atFirst} title="Previous invoice" aria-label="Previous invoice" style={pagerBtn(atFirst)}>‹</button>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#374151', minWidth: 46, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                {safeIdx + 1}/{drafts.length}
              </span>
              <button onClick={() => setIdx(i => Math.min(drafts.length - 1, i + 1))} disabled={atLast} title="Next invoice" aria-label="Next invoice" style={pagerBtn(atLast)}>›</button>
            </div>
            <DraftCard
              key={current.id}
              draft={current}
              vendors={props.vendors}
              associations={props.associations}
              onMutate={() => void fetchTab(status)}
            />
          </>
        )
      })()}
    </div>
  )
}

function pagerBtn(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 20, lineHeight: 1, width: 36, height: 32, padding: 0,
    border: '1px solid #d1d5db', borderRadius: 6,
    background: disabled ? '#f3f4f6' : '#fff',
    color:      disabled ? '#cbd5e1' : '#111827',
    cursor:     disabled ? 'default' : 'pointer',
  }
}

// ─────────────────────────────────────────────────────────────────────
// Card per draft
// ─────────────────────────────────────────────────────────────────────
const NOISE_WORDS = new Set([
  'llc', 'inc', 'corp', 'ltd', 'co', 'company',
  'pllc', 'pa', 'pc', 'lp', 'llp', 'pllp',
  'the', 'of', 'and',
])

/** Generate a sensible default short_name from a vendor's full name.
 *  Drops legal-suffix noise ("LLC", "Inc", "PLLC"), takes the first
 *  significant word(s) PascalCased until we have at least 6 chars,
 *  caps at 20. Karen can override before saving. Examples:
 *    "Atlas Electrical Performance LLC" → "Atlas" (… → "AtlasElectrical" if "Atlas" alone < 6)
 *    "REGISTERED AGENT SOLUTIONS, INC." → "Registered"
 *    "Ben-Hamo Law, PLLC"              → "BenHamo"  */
function suggestShortName(vendorName: string): string {
  if (!vendorName) return ''
  const words = vendorName
    .replace(/[^A-Za-z0-9 ]/g, ' ')                  // strip punctuation + hyphens
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 0 && !NOISE_WORDS.has(w))
  if (words.length === 0) return ''
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
  let out = cap(words[0])
  let i   = 1
  while (out.length < 6 && words[i] && out.length + words[i].length <= 20) {
    out += cap(words[i])
    i++
  }
  return out.slice(0, 20)
}

/** Mirror of server-side canonicalInvoiceFilename so Karen sees exactly
 *  what name will be written to CINC + Drive before she pushes. Must
 *  match the server's safe() / amt formatting rules. */
function buildFilenamePreview(opts: { assoc: string; short: string; invNo: string; amount: string }): string {
  const safe = (s: string) => (s ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  const amtN = parseFloat(opts.amount || '0')
  const amt  = (Number.isFinite(amtN) ? amtN : 0).toFixed(2).replace(/\.00$/, '')
  return `${safe(opts.assoc) || 'ASSOC'}_${safe(opts.short) || 'Vendor'}_${safe(opts.invNo) || 'INV'}_$${amt}.pdf`
}

// Format a YYYY-MM-DD date string in LOCAL time. `new Date('2026-06-15')`
// parses as UTC midnight and renders one day earlier in ET — which made the
// date look like it shifted back a day after the card flipped to read mode.
function fmtDate(s: string | null | undefined): string {
  if (!s) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function DraftCard(props: {
  draft:        Draft
  vendors:      Vendor[]
  associations: Association[]
  onMutate:     () => void
}) {
  const { draft, vendors, associations, onMutate } = props

  // Form state — always tracks the latest values (editable in edit
  // mode, displayed read-only in view mode).
  const [vendorId, setVendorId]   = useState<string>(draft.matched_cinc_vendor_id ?? '')
  const [shortName, setShortName] = useState<string>(draft.matched_vendor_short_name ?? '')
  const [assoc, setAssoc]         = useState<string>(draft.extracted_association_code ?? '')
  const [invNo, setInvNo]         = useState<string>(draft.extracted_invoice_number ?? '')
  const [acctNum, setAcctNum]     = useState<string>(draft.extracted_account_number ?? '')
  const [amount, setAmount]       = useState<string>(draft.extracted_amount != null ? String(draft.extracted_amount) : '')
  const [invDate, setInvDate]     = useState<string>(draft.extracted_invoice_date ?? '')
  const [dueDate, setDueDate]     = useState<string>(draft.due_date ?? '')
  const [glId, setGlId]           = useState<string>(draft.gl_account_id   ?? '')
  const [glName, setGlName]       = useState<string>(draft.gl_account_name ?? '')
  const [payBy, setPayBy]         = useState<string>(draft.pay_by_type     ?? '')
  const [note, setNote]           = useState<string>(draft.observation_note ?? '')
  const [woNumber, setWoNumber]   = useState<string>(draft.work_order_number != null ? String(draft.work_order_number) : '')
  const [bankId, setBankId]       = useState<string>(draft.pay_from_bank_account_id != null ? String(draft.pay_from_bank_account_id) : '')

  // GL options for the selected association — fetched on demand the
  // first time edit mode + assoc are both set, then memoised. Refresh
  // bypasses the server cache for cases where Karen just added a
  // budget line in CINC.
  const [glOptions, setGlOptions] = useState<BudgetGlOption[]>([])
  const [glLoading, setGlLoading] = useState(false)
  const [glError, setGlError]     = useState<string | null>(null)
  const [glLoadedFor, setGlLoadedFor] = useState<string>('')
  // Auto-select bookkeeping: we pre-fill the GL once per association when
  // MAIA's suggestion is high-confidence, but only if Karen hasn't already
  // chosen one. `glAutoAppliedFor` makes it fire at most once per assoc so
  // we never fight a manual clear; `glAutoFilled` flags the value as
  // machine-picked so the UI asks for a confirm rather than implying intent.
  const [glAutoAppliedFor, setGlAutoAppliedFor] = useState<string>('')
  const [payByAutoAppliedFor, setPayByAutoAppliedFor] = useState<string>('')
  const [glAutoFilled, setGlAutoFilled]         = useState(false)

  // Bank accounts for the selected association — Operating, Reserve,
  // Special Assessment, etc. Lazy-loaded per assoc just like the GL
  // list. Karen picks the bank that funds this invoice; the choice
  // maps to PayFromBankAccountID on the CINC createInvoice payload.
  const [bankOptions, setBankOptions]     = useState<BankAccountOption[]>([])
  const [bankLoading, setBankLoading]     = useState(false)
  const [bankError, setBankError]         = useState<string | null>(null)
  const [bankLoadedFor, setBankLoadedFor] = useState<string>('')

  // Payment-method options for the selected association — same lazy
  // pattern as the GL list. CINC returns assoc-specific PayByType
  // values (check, ACH, etc.) we have to send verbatim on createInvoice.
  // The vendor PAYMENT METHODS (CINC's per-vendor "Default Pmt Method" has
  // exactly these three). NOT the association payByTypes — those mix in
  // transaction types like "Bank Adjustment" / "NSF Fee" that aren't vendor
  // payment methods. CINC's API doesn't expose the vendor's saved default, so
  // we leave it blank and let CINC apply the vendor's setup on push; Karen can
  // override here. Available immediately on vendor match (no association needed).
  const [payByOptions] = useState<PayByOption[]>([
    { value: 'Check', label: 'Check' },
    { value: 'ACH',   label: 'ACH' },
    { value: 'EFT',   label: 'EFT' },
  ])

  // Open CINC work orders for the (assoc, vendor) pair — Karen links
  // a maintenance invoice to an existing WO so it shows up under that
  // WO instead of standalone. Lazy-loaded when both keys are set.
  const [woOptions, setWoOptions] = useState<WorkOrderOption[]>([])
  const [woLoading, setWoLoading] = useState(false)
  const [woLoadedKey, setWoLoadedKey] = useState<string>('')

  // CINC vendor's full profile — banking + 1099 + terms + the
  // DERIVED "DefaultPmtMethod" (ACH if Routing+Account configured,
  // else Check). Shown read-only under the Payment-method dropdown
  // so Karen can verify her Pay By selection matches the vendor's
  // CINC default BEFORE pushing. Lazy-fetched when vendorId is set.
  // Read-only: payment-method changes require bank/ACH setup in CINC,
  // not in MAIA.
  // Mode toggle. Cards open in view mode so the data is presented as
  // information first, with Edit as the explicit affordance to change
  // anything. Push / Reject only available in view mode (you can't
  // push half-edited values).
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg]   = useState<string | null>(null)

  // Lazy-load the GL list when we enter edit mode for an assoc we
  // haven't fetched yet. Keeps the page-load fast — we only hit CINC
  // for budgets Karen actually opens.
  useEffect(() => {
    if (mode !== 'edit' || !assoc || glLoadedFor === assoc || glLoading) return
    setGlLoading(true); setGlError(null)
    fetch(`/api/admin/cinc/budget?assoc=${encodeURIComponent(assoc)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (data?.error) throw new Error(data.error)
        setGlOptions(data.lines ?? [])
        setGlLoadedFor(assoc)
      })
      .catch(err => setGlError(err instanceof Error ? err.message : String(err)))
      .finally(() => setGlLoading(false))
  }, [mode, assoc, glLoadedFor, glLoading])

  // Lazy-load bank accounts the same way. Auto-select the Operating
  // account on first fetch if Karen hasn't picked anything — sensible
  // default since the vast majority of invoices pay from operating.
  // She can override to Reserve/Special before pushing.
  useEffect(() => {
    // Load in ANY mode (not just edit) so the read-only "ready to push" card
    // can resolve the picked account to its DESCRIPTION/number instead of
    // showing the bare BankAccountID.
    if (!assoc || bankLoadedFor === assoc || bankLoading) return
    setBankLoading(true); setBankError(null)
    fetch(`/api/admin/cinc/bank-accounts?assoc=${encodeURIComponent(assoc)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (data?.error) throw new Error(data.error)
        const accounts: BankAccountOption[] = data.accounts ?? []
        setBankOptions(accounts)
        setBankLoadedFor(assoc)
        // Default to the SouthState (SSB) Operating account when nothing is
        // chosen yet — prefer SSB among operating accounts (some assocs also
        // carry a CSB operating account). Only while editing; never override
        // a pushed pick.
        if (mode === 'edit' && !bankId) {
          const ops = accounts.filter(a => a.kind === 'operating')
          const operating = ops.find(a => /\bssb\b|south\s*state/i.test(a.description)) ?? ops[0]
          if (operating) setBankId(String(operating.id))
        }
      })
      .catch(err => setBankError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBankLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, assoc, bankLoadedFor, bankLoading])

  // Lazy-load open WOs for (assoc, vendor) pair. Refetch when either
  // changes — Karen might switch vendor or assoc mid-edit.
  useEffect(() => {
    if (mode !== 'edit' || !assoc || !vendorId) return
    const key = `${assoc}::${vendorId}`
    if (woLoadedKey === key || woLoading) return
    setWoLoading(true)
    fetch(`/api/admin/cinc/work-orders?assoc=${encodeURIComponent(assoc)}&vendor=${encodeURIComponent(vendorId)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (!data?.error) setWoOptions(data.workOrders ?? [])
        setWoLoadedKey(key)
      })
      .catch(() => { /* keep empty — dropdown stays manual */ })
      .finally(() => setWoLoading(false))
  }, [mode, assoc, vendorId, woLoadedKey, woLoading])

  // (Payment methods are a fixed Check/ACH/EFT list — see payByOptions above.)

  // Auto-suggest an observation note when Karen picks a payment method
  // and hasn't typed her own. Karen can always overwrite. Format follows
  // what the CINC team needs to see when processing payment.
  useEffect(() => {
    if (mode !== 'edit' || !payBy) return
    const vendorLabel = matchedVendor?.name ?? draft.matched_vendor_name ?? draft.extracted_vendor_name ?? 'vendor'
    const isCheck    = /check/i.test(payBy)
    const suggested = isCheck
      ? `${payBy.toUpperCase()} — Pay to: ${vendorLabel}`
      : `${payBy.toUpperCase()} — Use vendor's on-file ${payBy} account`
    // Only fill if currently blank or matches a previous auto-suggestion shape.
    if (!note.trim() || /^[A-Z][A-Z ]+ — /.test(note)) {
      setNote(suggested)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payBy])

  const matchedVendor = useMemo(
    () => vendors.find(v => String(v.id) === vendorId) ?? null,
    [vendors, vendorId],
  )

  // When the user picks a different vendor, reset short_name to CINC's
  // stored UserDefined1 if there is one; otherwise generate a sensible
  // suggestion from the vendor name. Karen can still edit before save.
  useEffect(() => {
    if (!matchedVendor) return
    if (matchedVendor.shortName) {
      setShortName(matchedVendor.shortName)
    } else {
      setShortName(prev => prev || suggestShortName(matchedVendor.name))
    }
  }, [matchedVendor])

  function cancelEdit() {
    setVendorId (draft.matched_cinc_vendor_id     ?? '')
    setShortName(draft.matched_vendor_short_name  ?? '')
    setAssoc    (draft.extracted_association_code ?? '')
    setInvNo    (draft.extracted_invoice_number   ?? '')
    setAcctNum  (draft.extracted_account_number   ?? '')
    setAmount   (draft.extracted_amount != null ? String(draft.extracted_amount) : '')
    setInvDate  (draft.extracted_invoice_date     ?? '')
    setDueDate  (draft.due_date                    ?? '')
    setGlId     (draft.gl_account_id   ?? '')
    setGlName   (draft.gl_account_name ?? '')
    setPayBy    (draft.pay_by_type     ?? '')
    setNote     (draft.observation_note ?? '')
    setWoNumber (draft.work_order_number != null ? String(draft.work_order_number) : '')
    setBankId   (draft.pay_from_bank_account_id != null ? String(draft.pay_from_bank_account_id) : '')
    setMode('view')
    setMsg(null)
  }

  /** The current edited field values, as the PATCH body the API expects.
   *  Shared by Save and by the auto-save-on-confirm path so confirming a
   *  compliance check persists the latest values without a separate Save. */
  function valuesPatch(): Record<string, unknown> {
    return {
      matched_cinc_vendor_id:      vendorId || null,
      matched_vendor_name:         matchedVendor?.name ?? null,
      matched_vendor_short_name:   shortName || null,
      extracted_invoice_number:    invNo || null,
      extracted_account_number:    acctNum || null,
      extracted_amount:            amount ? parseFloat(amount) : null,
      extracted_association_code:  assoc || null,
      extracted_invoice_date:      invDate || null,
      due_date:                    dueDate || null,
      scheduled_pay_date:          dueDate || null,
      gl_account_id:               glId   || null,
      gl_account_name:             glName || null,
      pay_by_type:                 payBy  || null,
      observation_note:            note   || null,
      work_order_number:           woNumber ? parseInt(woNumber, 10) : null,
      pay_from_bank_account_id:    bankId ? parseInt(bankId, 10) : null,
    }
  }

  async function save() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/invoices/intake', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: draft.id, ...valuesPatch() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setMsg('Saved.')
      setMode('view')
      onMutate()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function push(pushAnyway = false) {
    if (!confirm(`Push invoice ${invNo || '(no #)'} for $${amount || '0'} to CINC?`)) return
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/admin/invoices/intake/${draft.id}/push`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pushAnyway }),
      })
      const data = await res.json()
      // Double-pay guard: offer Karen the override (server still enforces
      // Karen-only). karenOnly=true means a non-Karen tried to override.
      if (res.status === 409 && data?.duplicateGuard) {
        setBusy(false)
        if (data.karenOnly) { setMsg(data.error); return }
        if (!pushAnyway && confirm(`⚠ ${data.error}\n\nPush anyway?`)) { void push(true) }
        else setMsg(data.error)
        return
      }
      if (!res.ok && res.status !== 207) throw new Error((data?.error ?? `HTTP ${res.status}`) + (data?.normalizeNote ? ` [compressor: ${data.normalizeNote}]` : ''))
      setMsg(data.warning ?? `Pushed to CINC (id ${data.cincInvoiceId}).`)
      onMutate()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function reject() {
    const reason = prompt('Reason for rejecting this draft?', '')
    if (reason === null) return
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/admin/invoices/intake/${draft.id}/reject`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      onMutate()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function rematch() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/admin/invoices/intake/${draft.id}/rematch`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setMsg(data.matched ? `Matched to ${data.vendor.name}.` : data.message)
      if (data.matched) onMutate()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Re-send a pushed invoice's PDF to the Drive "INVOICE TO INPUT" folder
  // when the original push's Drive copy missed (transient failure).
  async function remirror() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/admin/invoices/intake/${draft.id}/remirror`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setMsg(`Saved to Drive${data.filename ? ` as ${data.filename}` : ''}${data.sizeMB != null ? ` (${data.sizeMB} MB${data.compressor ? ` — ${data.compressor}` : ''})` : ''}.`)
      onMutate()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Re-attach the stored PDF to the existing CINC invoice — for invoices that
  // landed in CINC without their PDF (oversized scan skipped by an old push).
  async function reattachCinc() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/admin/invoices/intake/${draft.id}/reattach-cinc`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error((data?.error ?? `HTTP ${res.status}`) + (data?.normalizeNote ? ` [compressor: ${data.normalizeNote}]` : ''))
      setMsg(`PDF attached to CINC invoice ${data.cincInvoiceId}${data.filename ? ` as ${data.filename}` : ''}.`)
      onMutate()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Put-on-hold modal + release-from-hold.
  const [holdOpen, setHoldOpen] = useState(false)
  async function releaseHold() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/admin/invoices/intake/${draft.id}/hold`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      onMutate()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }

  const isPushed   = draft.status === 'pushed_to_cinc'
  const isRejected = draft.status === 'rejected'
  const isOnHold   = draft.status === 'on_hold'
  const readOnly   = isPushed || isRejected || isOnHold

  // ── AP audit checklist (inline) ────────────────────────────────────
  // Each audited field carries its own green-check toggle, rendered beside
  // the field, so the team fills the value and confirms it in one place.
  // The state + system double-pay guard live here so the whole card shares
  // one source of truth. Karen can mark the draft ready only when every
  // required field is checked and no hard duplicate is found.
  const [checked, setChecked]     = useState<Record<string, boolean>>(draft.audit_checklist ?? {})
  const [auditCtx, setAuditCtx]   = useState<VendorCtx | null>(null)
  const [auditBusy, setAuditBusy] = useState(false)
  const [auditMsg, setAuditMsg]   = useState<string | null>(null)

  const vendorNameForCtx = matchedVendor?.name ?? draft.matched_vendor_name ?? ''
  const filenamePreview  = buildFilenamePreview({ assoc, short: shortName, invNo, amount })

  // Load the duplicate-guard + GL suggestion + recent-payments context
  // whenever both vendor and association are known.
  useEffect(() => {
    if (!vendorId || !assoc) { setAuditCtx(null); return }
    const p = new URLSearchParams({
      vendorId, assoc, vendorName: vendorNameForCtx,
      invoiceNumber: invNo, amount, draftId: String(draft.id),
    })
    let live = true
    fetch(`/api/admin/invoices/intake/vendor-context?${p.toString()}`, { cache: 'no-store' })
      .then(r => r.json()).then(d => { if (live) setAuditCtx(d) }).catch(() => { if (live) setAuditCtx(null) })
    return () => { live = false }
  }, [vendorId, assoc, invNo, amount, vendorNameForCtx, draft.id])

  const dup     = auditCtx?.duplicate
  const hardDup = !!dup?.hasHardDuplicate
  const glHint  = auditCtx?.suggestedGl?.glAccount
    ? `usual GL: ${auditCtx.suggestedGl.glAccount}${auditCtx.suggestedGl.source ? ` (${auditCtx.suggestedGl.source})` : ''}`
    : undefined

  // GL auto-select: once the budget list is loaded for an association and
  // MAIA's suggestion is high-confidence, pre-fill the dropdown instead of
  // making Karen click "Use it". High confidence = an explicit CINC vendor
  // account mapping, or the vendor's expense GL seen on ≥2 past invoices.
  // The single-data-point fallback ("last MAIA invoice") stays a manual
  // "Use it" so a one-off doesn't silently steer the books. We never
  // overwrite an existing pick, and fire at most once per association so a
  // manual clear is respected. Karen still confirms 'gl_account' on the
  // audit checklist — auto-fill sets the value, not the green check.
  useEffect(() => {
    if (mode !== 'edit' || !assoc || glLoadedFor !== assoc) return
    if (glAutoAppliedFor === assoc) return
    const sg = auditCtx?.suggestedGl
    if (!sg || (!sg.accountNumber && !sg.glAccount)) return
    // The GL number lives in accountNumber for the ledger-derived source but
    // in glAccount for the CINC-vendor-account source — match either, loosely
    // (formats like "64-5791-00" vs "64579100" should still hit).
    const norm = (s: string | null | undefined) => (s ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase()
    const keys = [norm(sg.accountNumber), norm(sg.glAccount)].filter(Boolean)
    const hit = glOptions.find(o => keys.includes(norm(o.number)))
    if (!hit) return
    setGlAutoAppliedFor(assoc)            // mark attempted regardless, so a manual clear sticks
    if (glId) return                      // never override an existing choice
    if (!isHighConfidenceGl(sg.source)) return
    setGlId(hit.id); setGlName(hit.name); setGlAutoFilled(true)
  }, [mode, assoc, glLoadedFor, glOptions, auditCtx, glId, glAutoAppliedFor])

  // Auto-fill the PAYMENT METHOD from the vendor's last invoice — vendor-context
  // reads its PayByType from CINC history, so MAIA brings the method the vendor
  // was actually paid by (no fake push needed). Fires once per vendor; only when
  // Karen hasn't already chosen one.
  useEffect(() => {
    const sp = auditCtx?.suggestedPayBy?.method
    if (!sp || !vendorId || payByAutoAppliedFor === vendorId) return
    setPayByAutoAppliedFor(vendorId)
    if (payBy) return
    const hit = payByOptions.find(o => o.value.toLowerCase() === sp.toLowerCase())
    if (hit) setPayBy(hit.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditCtx, vendorId, payByAutoAppliedFor])

  const REQUIRED_CHECKS =['association', 'vendor', 'invoice_number', 'short_name', 'amount', 'gl_account', 'bank_account', 'due_date', 'filename']
  const requiredOk = REQUIRED_CHECKS.every(k => checked[k])
  const allReady   = requiredOk && !!checked['duplicate'] && !hardDup

  async function persistChecklist(next: Record<string, boolean>, opts?: { statusChange?: string; includeValues?: boolean }) {
    setAuditBusy(true); setAuditMsg(null)
    try {
      const body: Record<string, unknown> = { id: draft.id, audit_checklist: next }
      // Auto-save the current field values alongside the checklist when
      // confirming in edit mode — so each compliance confirmation persists
      // the latest values without a separate "Save" click. Only in edit mode,
      // where the vendor list is loaded (otherwise valuesPatch could null the
      // vendor name). Same body the Save button sends.
      if (opts?.includeValues) Object.assign(body, valuesPatch())
      if (opts?.statusChange)  body.status = opts.statusChange
      const res = await fetch('/api/admin/invoices/intake', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      if (opts?.statusChange) {
        if (data?.driveWarning) setAuditMsg(`Transferred — but Drive copy didn't land: ${data.driveWarning}`)
        onMutate()
      } else if (opts?.includeValues) setAuditMsg('Saved ✓')
    } catch (e) { setAuditMsg(e instanceof Error ? e.message : String(e)) } finally { setAuditBusy(false) }
  }

  function toggleCheck(id: string, present: boolean) {
    if (id === 'duplicate' && hardDup) { setAuditMsg('Hard duplicate — cannot clear. Reject this draft instead.'); return }
    if (id !== 'duplicate' && !present && !checked[id]) { setAuditMsg('Fill that field in Edit first, then confirm it.'); return }
    const next = { ...checked, [id]: !checked[id] }
    setChecked(next)
    // Confirming auto-saves the current values (edit mode only); unchecking
    // or confirming in view mode just persists the checklist boolean.
    void persistChecklist(next, { includeValues: mode === 'edit' })
  }

  // Let the funds check move the (due) payment date to an affordable month
  // without leaving view mode. One date now: we persist due_date and mirror
  // scheduled_pay_date to it so the reconciliation "Upcoming Payments" follows.
  async function updateScheduledDate(date: string) {
    setDueDate(date)
    setAuditBusy(true); setAuditMsg(null)
    try {
      const res = await fetch('/api/admin/invoices/intake', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: draft.id, due_date: date || null, scheduled_pay_date: date || null }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
    } catch (e) { setAuditMsg(e instanceof Error ? e.message : String(e)) } finally { setAuditBusy(false) }
  }

  const showAudit = !readOnly && (draft.status === 'pending_review' || draft.status === 'ready_to_push' || draft.status === 'needs_vendor' || draft.status === 'duplicate_in_cinc')
  const isReady   = draft.status === 'ready_to_push'

  // Per-field check toggle, shown beside a field only while auditing.
  const fieldCheck = (id: string, present: boolean) =>
    showAudit
      ? <CheckToggle on={!!checked[id]} present={present} disabled={auditBusy} onToggle={() => toggleCheck(id, present)} />
      : undefined

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 16, background: '#fff' }}>
      {draft.status === 'needs_vendor' && !vendorId && (
        <div style={{ padding: 8, marginBottom: 12, background: '#fef3c7', borderLeft: '3px solid #f59e0b', fontSize: 13 }}>
          No CINC vendor auto-matched for <strong>{draft.extracted_vendor_name ?? '(unknown vendor)'}</strong>.
          Use the <em>Vendor (CINC)</em> box below to search by name <em>or DBA</em> and pick it, then
          <strong> Save</strong>. If it isn&apos;t in CINC yet, create it there first.
        </div>
      )}
      {draft.status === 'needs_vendor' && !!vendorId && (
        <div style={{ padding: 8, marginBottom: 12, background: '#eff6ff', borderLeft: '3px solid #3b82f6', fontSize: 13 }}>
          Vendor selected — click <strong>Save</strong> to assign it and move this invoice into the review queue.
        </div>
      )}
      {draft.status === 'duplicate_in_cinc' && (
        <div style={{ padding: 8, marginBottom: 12, background: '#fee2e2', borderLeft: '3px solid #dc2626', fontSize: 13 }}>
          CINC says this invoice already exists (id <strong>{draft.cinc_dup_invoice_id}</strong>).
          Reject as duplicate, OR push anyway if this is intentional (e.g. downpayment + balance).
        </div>
      )}
      {isPushed && (
        <div style={{ padding: 8, marginBottom: 12, background: '#ecfdf5', borderLeft: '3px solid #10b981', fontSize: 13 }}>
          Pushed to CINC as invoice <strong>{draft.cinc_invoice_id}</strong>
          {draft.pushed_by && ` by ${draft.pushed_by}`}
          {draft.pushed_at && ` at ${new Date(draft.pushed_at).toLocaleString()}`}.
          {draft.gl_account_name && (
            <>
              {' · '}Expense GL: <strong>{draft.gl_account_name}</strong>
            </>
          )}
          {draft.cinc_invoice_id && (
            <>
              {' · '}
              <a href={`/admin/invoices/cinc/${draft.cinc_invoice_id}`} style={{ color: '#065f46', fontWeight: 600, textDecoration: 'underline' }}>
                View invoice detail →
              </a>
            </>
          )}
          {!draft.drive_file_id && (
            <div style={{ marginTop: 6, padding: '6px 8px', background: '#fff', border: '1px solid #fcd34d', borderRadius: 4, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              ⚠ The renamed PDF didn&apos;t reach the Drive &quot;INVOICE TO INPUT&quot; folder.
              <button onClick={remirror} disabled={busy} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', border: '1px solid #d97706', borderRadius: 4, background: '#fffbeb', color: '#92400e', cursor: 'pointer' }}>
                Save to Drive now
              </button>
            </div>
          )}
          {/* Re-attach PDF to CINC — for invoices that landed in CINC without
              their PDF (oversized scan skipped by an old push). */}
          <div style={{ marginTop: 6 }}>
            <button onClick={reattachCinc} disabled={busy} title="Compress and attach the stored PDF to this CINC invoice"
              style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', border: '1px solid #059669', borderRadius: 4, background: '#fff', color: '#065f46', cursor: 'pointer' }}>
              {busy ? 'Working…' : '📎 Re-attach PDF to CINC'}
            </button>
          </div>
          {/* Inline result right here by the buttons, so feedback is visible
              instead of only appearing at the very bottom of the card. */}
          {msg && (
            <div style={{ marginTop: 8, padding: '6px 8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, color: '#374151', whiteSpace: 'pre-wrap' }}>{msg}</div>
          )}
          {draft.cinc_invoice_id && (
            <InvoiceHistory invoiceId={parseInt(draft.cinc_invoice_id, 10)} />
          )}
        </div>
      )}
      {isRejected && (
        <div style={{ padding: 8, marginBottom: 12, background: '#f3f4f6', borderLeft: '3px solid #6b7280', fontSize: 13 }}>
          Rejected. {draft.rejected_reason && <em>&quot;{draft.rejected_reason}&quot;</em>}
        </div>
      )}
      {isOnHold && (
        <div style={{ padding: 10, marginBottom: 12, background: '#fffbeb', borderLeft: '3px solid #f59e0b', fontSize: 13, color: '#92400e' }}>
          ⏸ <strong>On hold</strong> — waiting on vendor documents
          {draft.hold_requested_at && ` (since ${new Date(draft.hold_requested_at).toLocaleDateString()})`}.
          {draft.hold_requested_items && draft.hold_requested_items.length > 0 && (
            <div style={{ marginTop: 4 }}>Requested: <strong>{draft.hold_requested_items.join(' · ')}</strong></div>
          )}
          {draft.hold_note && <div style={{ marginTop: 2, fontStyle: 'italic' }}>{draft.hold_note}</div>}
          <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={releaseHold} disabled={busy} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', border: '1px solid #059669', borderRadius: 4, background: '#fff', color: '#065f46', cursor: 'pointer' }}>
              ▸ Release from hold (→ Pending review)
            </button>
            {draft.hold_ticket_id && (
              <a href={`/admin/tickets/${draft.hold_ticket_id}`} style={{ fontSize: 12, color: '#92400e', fontWeight: 600 }}>View follow-up ticket →</a>
            )}
          </div>
        </div>
      )}

      {/* PDF + form SIDE BY SIDE — Karen reads the bill (left) while
          reviewing the fields (right). Stacks on narrow screens (flexWrap). */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 360px', minWidth: 300, position: 'sticky', top: 12 }}>
      {draft.pdf_signed_url ? (
        <div>
          <iframe
            src={draft.pdf_signed_url}
            title={`Invoice ${draft.id}`}
            style={{ width: '100%', height: '82vh', minHeight: 460, border: '1px solid #e5e7eb', borderRadius: 4, background: '#f9fafb' }}
          />
          <div style={{ marginTop: 4, textAlign: 'right' }}>
            <a href={draft.pdf_signed_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#6b7280', textDecoration: 'none' }}>
              Open in new tab ↗
            </a>
          </div>
        </div>
      ) : (
        <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, fontSize: 12, color: '#991b1b' }}>
          PDF preview not available — the original upload to storage failed at intake.
          The data below was extracted from the email body, not the PDF.
        </div>
      )}
      </div>

      {/* RIGHT column — actions + fields */}
      <div style={{ flex: '1.6 1 460px', minWidth: 340 }}>
      {/* Action bar — at the top of the form column. */}
      {!readOnly && (
        <div style={{ marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {mode === 'view' ? (
            <>
              <button onClick={() => setMode('edit')} disabled={busy} style={btnSecondary()}>Edit</button>
              {draft.status === 'needs_vendor' && (
                <button onClick={rematch} disabled={busy} style={btnSecondary()}>Re-match vendor</button>
              )}
              {draft.status === 'duplicate_in_cinc' && (
                <button onClick={() => push(true)} disabled={busy} style={btnPrimary()}>Push anyway</button>
              )}
              {draft.status === 'ready_to_push' && (
                <button onClick={() => push(false)} disabled={busy} style={btnPrimary()}>Push to CINC</button>
              )}
              <button onClick={() => setHoldOpen(true)} disabled={busy} style={btnSecondary()}>⏸ Put on hold</button>
              <button onClick={reject} disabled={busy} style={btnDanger()}>Reject</button>
            </>
          ) : (
            <>
              <button onClick={save}       disabled={busy} style={btnPrimary()}>Save</button>
              <button onClick={cancelEdit} disabled={busy} style={btnSecondary()}>Cancel</button>
            </>
          )}
        </div>
      )}

      {/* Form / display grid — same fields in both modes. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
        <Field label="Vendor (CINC)" right={fieldCheck('vendor', !!vendorId)}>
          {mode === 'edit' ? (
            <>
              <VendorCombobox
                vendors={vendors}
                value={vendorId}
                onChange={setVendorId}
                disabled={readOnly}
              />
              {draft.extracted_vendor_name && (
                <div style={{ marginTop: 4, color: '#6b7280', fontSize: 11 }}>
                  Extracted: &quot;{draft.extracted_vendor_name}&quot;
                </div>
              )}
            </>
          ) : (
            <ReadOnlyValue value={matchedVendor?.name ?? draft.matched_vendor_name} placeholder="— no vendor picked —" />
          )}
        </Field>

        <Field label="Short name (saved to CINC UserDefined1)" right={fieldCheck('short_name', !!shortName)}>
          {mode === 'edit' ? (
            <input
              type="text"
              value={shortName}
              onChange={e => setShortName(e.target.value)}
              disabled={readOnly || !vendorId}
              placeholder={matchedVendor ? suggestShortName(matchedVendor.name) : ''}
              style={{ width: '100%', padding: 6 }}
            />
          ) : (
            <ReadOnlyValue value={shortName} placeholder="— not set —" />
          )}
        </Field>

        <Field label="Association" right={fieldCheck('association', !!assoc)}>
          {mode === 'edit' ? (
            <select
              value={assoc}
              onChange={e => setAssoc(e.target.value)}
              disabled={readOnly}
              style={{ width: '100%', padding: 6 }}
            >
              <option value="">— pick association —</option>
              {associations.map(a => (
                <option key={a.code} value={a.code}>{a.name} ({a.code})</option>
              ))}
            </select>
          ) : (
            <ReadOnlyValue
              value={(() => {
                const a = associations.find(x => x.code === assoc)
                return a ? `${a.name} (${a.code})` : assoc
              })()}
              placeholder="— not set —"
            />
          )}
        </Field>

        <Field label="Invoice #" right={fieldCheck('invoice_number', !!invNo)}>
          {mode === 'edit' ? (
            <input
              type="text"
              value={invNo}
              onChange={e => setInvNo(e.target.value)}
              disabled={readOnly}
              style={{ width: '100%', padding: 6 }}
            />
          ) : (
            <ReadOnlyValue value={invNo} placeholder="—" />
          )}
        </Field>

        <Field label="Account # (utility)">
          {mode === 'edit' ? (
            <input
              type="text"
              value={acctNum}
              onChange={e => setAcctNum(e.target.value)}
              disabled={readOnly}
              placeholder="utility / customer account number"
              style={{ width: '100%', padding: 6 }}
            />
          ) : (
            <ReadOnlyValue value={acctNum} placeholder="—" />
          )}
          <div style={{ marginTop: 4, color: '#6b7280', fontSize: 11 }}>
            Routes future bills on this account to the right vendor + association + GL. Learned automatically on push.
          </div>
        </Field>

        <Field label="Amount ($)" right={fieldCheck('amount', !!amount)}>
          {mode === 'edit' ? (
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              disabled={readOnly}
              style={{ width: '100%', padding: 6 }}
            />
          ) : (
            <ReadOnlyValue
              value={amount ? `$${parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
              placeholder="—"
            />
          )}
        </Field>

        <Field label="Invoice date">
          {mode === 'edit' ? (
            <input
              type="date"
              value={invDate}
              onChange={e => setInvDate(e.target.value)}
              disabled={readOnly}
              style={{ width: '100%', padding: 6 }}
            />
          ) : (
            <ReadOnlyValue value={fmtDate(invDate)} placeholder="—" />
          )}
        </Field>

        <Field label="Payment due date" right={fieldCheck('due_date', !!dueDate)}>
          {mode === 'edit' ? (
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              disabled={readOnly}
              style={{ width: '100%', padding: 6 }}
            />
          ) : (
            <ReadOnlyValue value={fmtDate(dueDate)} placeholder="— not set —" />
          )}
        </Field>

        {/* Payment method — the vendor's three methods (Check / ACH / EFT).
            Left blank = CINC applies the vendor's saved Default Pmt Method
            on push (CINC's API doesn't expose it to pre-fill here). */}
        <Field label="Payment method">
          {mode === 'edit' ? (
              <select
                value={payBy}
                onChange={e => setPayBy(e.target.value)}
                disabled={readOnly}
                style={{ width: '100%', padding: 6 }}
              >
                <option value="">— CINC uses the vendor&apos;s default —</option>
                {payByOptions.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
          ) : (
            <ReadOnlyValue value={payBy} placeholder="— CINC applies the vendor's setup —" />
          )}
          {auditCtx?.suggestedPayBy ? (
            <div style={{ marginTop: 4, color: '#15803d', fontSize: 11 }}>
              💡 Vendor was last paid by <strong>{auditCtx.suggestedPayBy.method}</strong> ({auditCtx.suggestedPayBy.source})
            </div>
          ) : auditCtx && vendorId ? (
            <div style={{ marginTop: 4, color: '#92400e', fontSize: 11 }}>
              ⓘ No payment recorded yet for this vendor — leave blank and CINC will apply the vendor&apos;s saved <strong>Default Pmt Method</strong> on push (set it on the vendor in CINC for a brand-new vendor), or pick one above.
            </div>
          ) : null}
        </Field>

        {/* GL — spans both columns so long account names fit. Source is
            the association's CINC budget, fetched lazily on first edit. */}
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="GL line (from association budget)" right={fieldCheck('gl_account', !!glId)}>
            {mode === 'edit' ? (
              <>
                <select
                  value={glId}
                  onChange={e => {
                    const id = e.target.value
                    setGlId(id)
                    const hit = glOptions.find(o => o.id === id)
                    setGlName(hit?.name ?? '')
                    setGlAutoFilled(false)   // a manual pick is no longer "auto-selected"
                  }}
                  disabled={readOnly || !assoc}
                  style={{ width: '100%', padding: 6 }}
                >
                  <option value="">
                    {!assoc          ? '— pick an association first —'
                    : glLoading      ? 'Loading budget from CINC…'
                    : glOptions.length === 0
                      ? (glError ? '(failed to load — pick anyway is not allowed)' : 'No budgeted GL lines for this association')
                      : '— pick GL line —'}
                  </option>
                  {glOptions.map(o => {
                    // Surface budget context so Karen picks lines that
                    // still have room. Format: "5000 — Repairs  ·  $5,400 left of $20,000"
                    const parts: string[] = []
                    if (o.remaining != null) parts.push(`$${o.remaining.toLocaleString('en-US', { maximumFractionDigits: 0 })} left`)
                    if (o.budget    != null) parts.push(`of $${o.budget.toLocaleString('en-US', { maximumFractionDigits: 0 })}`)
                    const ctx = parts.length > 0 ? `  ·  ${parts.join(' ')}` : ''
                    return (
                      <option key={o.id} value={o.id}>
                        {o.number ? `${o.number} — ` : ''}{o.name}{ctx}
                      </option>
                    )
                  })}
                </select>
                {glError && (
                  <div style={{ marginTop: 4, color: '#b91c1c', fontSize: 11 }}>
                    Budget fetch failed: {glError}
                  </div>
                )}
                {glHint ? (
                  <div style={{ marginTop: 4, color: glAutoFilled ? '#15803d' : '#2563eb', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {(() => {
                      const sg = auditCtx?.suggestedGl
                      const norm = (s: string | null | undefined) => (s ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase()
                      const keys = [norm(sg?.accountNumber), norm(sg?.glAccount)].filter(Boolean)
                      const hit = keys.length ? glOptions.find(o => keys.includes(norm(o.number))) : null
                      // Suggestion already applied (auto-filled or matched a
                      // manual pick): show a confirm nudge, no "Use it".
                      if (hit && glId === hit.id) {
                        return (
                          <span>
                            {glAutoFilled ? '✓ MAIA auto-selected GL' : '✓ Using MAIA GL'} — {glHint}.{' '}
                            <span style={{ color: '#6b7280' }}>Confirm or change above.</span>
                          </span>
                        )
                      }
                      return (
                        <>
                          <span>💡 MAIA: {glHint}</span>
                          {hit && (
                            <button type="button" onClick={() => { setGlId(hit.id); setGlName(hit.name) }}
                              style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', border: '1px solid #2563eb', borderRadius: 10, background: '#eff6ff', color: '#2563eb', cursor: 'pointer' }}>
                              Use it
                            </button>
                          )}
                        </>
                      )
                    })()}
                  </div>
                ) : (vendorId && auditCtx && (
                  <div style={{ marginTop: 4, color: '#9ca3af', fontSize: 11 }}>
                    No prior GL on file for this vendor — pick from the budget above.
                  </div>
                ))}
              </>
            ) : (
              <ReadOnlyValue value={glName} placeholder={assoc ? '— not set —' : '— pick association first —'} />
            )}
          </Field>
        </div>

        {/* Pay-from bank account — maps to PayFromBankAccountID on the
            CINC createInvoice payload. Sourced from /banking/bankBalances.
            CINC's `Reserve` flag is broken, so kind is derived from the
            account description text (see lib/integrations/cinc.ts). */}
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Pay from bank account" right={fieldCheck('bank_account', !!bankId)}>
            {mode === 'edit' ? (
              <>
                <select
                  value={bankId}
                  onChange={e => setBankId(e.target.value)}
                  disabled={readOnly || !assoc}
                  style={{ width: '100%', padding: 6 }}
                >
                  <option value="">
                    {!assoc           ? '— pick an association first —'
                    : bankLoading     ? 'Loading bank accounts from CINC…'
                    : bankOptions.length === 0
                      ? (bankError ? '(failed to load — using CINC default)' : 'No bank accounts found for this association')
                      : '— pick a bank account —'}
                  </option>
                  {bankOptions.map(b => {
                    // Show CINC's account DESCRIPTION ("SSB - Operating - 8614")
                    // + its Cash account number — never the internal BankAccountID.
                    const num = b.cashGl ? `  ·  ${b.cashGl}` : ''
                    const bal = b.bankBalance != null
                      ? `  ·  $${b.bankBalance.toLocaleString('en-US', { maximumFractionDigits: 0 })} available`
                      : ''
                    return (
                      <option key={b.id} value={String(b.id)}>
                        {b.description}{num}{bal}
                      </option>
                    )
                  })}
                </select>
                {bankError && (
                  <div style={{ marginTop: 4, color: '#b91c1c', fontSize: 11 }}>
                    Bank-account fetch failed: {bankError}
                  </div>
                )}
                {/* Visual nudge when Karen picks something other than the
                    Operating account. Two severity tiers:
                      - restricted (Insurance/Loan Proceeds) → red, with the
                        specific restriction label. Funds can only pay
                        invoices tied to the underlying claim / loan.
                      - non-operating (Reserve / Special Assessment) → yellow.
                    A CINC audit note is added automatically on push in
                    either case. */}
                {(() => {
                  const sel = bankOptions.find(b => String(b.id) === bankId)
                  if (!sel) return null
                  if (sel.restricted) {
                    return (
                      <div style={{ marginTop: 6, padding: '8px 10px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 4, fontSize: 11, color: '#991b1b' }}>
                        🛑 <strong>Restricted account — {sel.restrictionLabel}.</strong> Funds here are earmarked. Only pay invoices tied to that specific {sel.restrictionLabel?.toLowerCase().includes('insurance') ? 'insurance claim' : 'loan-funded project'}. An audit note will be added to the CINC invoice on push.
                      </div>
                    )
                  }
                  if (sel.kind !== 'operating') {
                    return (
                      <div style={{ marginTop: 6, padding: '6px 8px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, fontSize: 11, color: '#92400e' }}>
                        ⚠ Non-operating account — an audit note will be added to the CINC invoice on push.
                      </div>
                    )
                  }
                  return null
                })()}
              </>
            ) : (
              <ReadOnlyValue
                value={(() => {
                  const sel = bankOptions.find(b => String(b.id) === bankId)
                  if (sel) return `${sel.description}${sel.cashGl ? `  ·  ${sel.cashGl}` : ''}`
                  // accounts not loaded yet → show nothing rather than the bare ID
                  return bankLoading ? 'Loading account…' : ''
                })()}
                placeholder={assoc ? '— not set (CINC default: Operating) —' : '— pick association first —'}
              />
            )}
          </Field>
        </div>

        {/* Observation — free text Karen edits. Maps to CINC's
            NoteDescription so the CINC processor sees it when viewing
            the invoice. */}
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Observation (CINC NoteDescription)">
            {mode === 'edit' ? (
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                disabled={readOnly}
                placeholder="Tell the CINC team how to process this invoice"
                maxLength={1000}
                style={{ width: '100%', padding: 6 }}
              />
            ) : (
              <ReadOnlyValue value={note} placeholder="— none —" />
            )}
          </Field>
        </div>

        {/* Work-order link (optional) — Karen ties a maintenance invoice
            to an existing CINC work order so the WO history shows the spend. */}
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Link to work order (optional)" right={fieldCheck('work_order', !!woNumber)}>
            {mode === 'edit' ? (
              <select
                value={woNumber}
                onChange={e => setWoNumber(e.target.value)}
                disabled={readOnly || !vendorId || !assoc}
                style={{ width: '100%', padding: 6 }}
              >
                <option value="">
                  {!vendorId || !assoc ? '— pick vendor + association first —'
                  : woLoading           ? 'Loading open work orders from CINC…'
                  : woOptions.length === 0
                    ? 'No open work orders for this vendor at this association'
                    : '— no work order (standalone invoice) —'}
                </option>
                {woOptions.map(wo => {
                  const desc = wo.description ? ` · ${wo.description.slice(0, 60)}` : ''
                  const when = wo.createdDate ? ` · ${new Date(wo.createdDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''
                  return (
                    <option key={wo.number} value={String(wo.number)}>
                      WO-{wo.number}{desc}{when}
                    </option>
                  )
                })}
              </select>
            ) : (
              <ReadOnlyValue
                value={woNumber ? `WO-${woNumber}` : ''}
                placeholder="— none (standalone invoice) —"
              />
            )}
          </Field>
        </div>
      </div>
      </div>{/* end right column */}
      </div>{/* end PDF + form side-by-side */}

      {/* Filename preview — what will be written to CINC + Drive on push.
          Live-updates as fields change in edit mode so Karen sees exactly
          what's about to be saved. */}
      {!isRejected && (
        <div style={{ marginTop: 14, padding: '8px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10, fontWeight: 600 }}>Will be saved as</span>
            {showAudit && <CheckToggle on={!!checked['filename']} present={!!filenamePreview} disabled={auditBusy} onToggle={() => toggleCheck('filename', !!filenamePreview)} />}
          </div>
          <div style={{ marginTop: 4, fontFamily: 'ui-monospace, monospace', color: '#111827', wordBreak: 'break-all' }}>
            {filenamePreview}
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: '#9ca3af' }}>
        Received {new Date(draft.created_at).toLocaleString()}
        {' · '}confidence {draft.extraction_confidence != null ? Math.round(draft.extraction_confidence * 100) + '%' : 'n/a'}
      </div>

      {msg && (
        <div style={{ marginTop: 8, padding: 6, background: '#f3f4f6', fontSize: 12, borderRadius: 4 }}>{msg}</div>
      )}

      {/* Funds check — the "do we have the money to pay this on the
          scheduled date?" big check. Runs once the team has confirmed the
          Amount + Scheduled date (and picked a pay-from account); projects
          to the scheduled month using all open invoices + account run-rate,
          and lets them move the date to an affordable month. */}
      {showAudit && mode === 'view' && assoc && (
        (checked['amount'] && checked['due_date'] && bankId && amount) ? (
          <FundsCheck
            assoc={assoc}
            bankAccountId={parseInt(bankId, 10)}
            pushAmount={parseFloat(amount) || 0}
            scheduledDate={dueDate}
            onChooseDate={updateScheduledDate}
          />
        ) : (
          <div style={{ marginTop: 12, padding: '10px 12px', background: '#f1f5f9', border: '1px dashed #cbd5e1', borderRadius: 6, fontSize: 12, color: '#475569' }}>
            💰 <strong>Funds check</strong> — confirm the <strong>Amount</strong> and <strong>Payment due date</strong> above{!bankId ? ', and pick a pay-from account,' : ''} to check whether the account will have the money on that date.
          </div>
        )
      )}

      {/* Audit footer — the per-field green-checks live inline beside each
          field above; this footer holds the system double-pay guard, the
          vendor's recent payments, and the "mark ready to push" approval. */}
      {showAudit && (
        <AuditFooter
          ctx={auditCtx}
          dupChecked={!!checked['duplicate']}
          hardDup={hardDup}
          onToggleDup={() => toggleCheck('duplicate', true)}
          allReady={allReady}
          requiredOk={requiredOk}
          isReady={isReady}
          readyBy={draft.audit_ready_by}
          busy={auditBusy}
          msg={auditMsg}
          onMarkReady={() => persistChecklist(checked, { statusChange: 'ready_to_push' })}
          onUnready={() => persistChecklist(checked, { statusChange: 'pending_review' })}
        />
      )}

      {holdOpen && (
        <HoldModal
          draftId={draft.id}
          vendorName={vendorNameForCtx || draft.matched_vendor_name || draft.extracted_vendor_name || ''}
          vendorId={vendorId || draft.matched_cinc_vendor_id || null}
          assoc={assoc || null}
          onClose={() => setHoldOpen(false)}
          onDone={() => { setHoldOpen(false); onMutate() }}
        />
      )}
    </div>
  )
}

// ── Put-on-hold modal ────────────────────────────────────────────────
// Staff check off which vendor documents they're requesting (COI / license /
// W-9 / ACH / Other), optionally create a follow-up work order, and email the
// vendor a tokenized upload link. Posts to /intake/[id]/hold.
type HoldItemKey = 'coi' | 'license' | 'w9' | 'ach' | null
const HOLD_ITEMS: { label: string; key: HoldItemKey }[] = [
  { label: 'Certificate of Insurance (COI)', key: 'coi' },
  { label: 'Business / contractor license', key: 'license' },
  { label: 'W-9',                            key: 'w9' },
  { label: 'ACH / banking info',             key: 'ach' },
  { label: 'Workers’ comp certificate',      key: null },
]
interface ComplianceItem { onFile: boolean; valid?: boolean | null; expiration?: string | null }
type ComplianceStatus = Record<'ach' | 'w9' | 'coi' | 'license', ComplianceItem>

function HoldModal({ draftId, vendorName, vendorId, assoc, onClose, onDone }: {
  draftId: number
  vendorName: string
  vendorId?: string | null
  assoc?: string | null
  onClose: () => void
  onDone: () => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [other, setOther]       = useState('')
  const [note, setNote]         = useState('')
  const [createTicket, setCreateTicket] = useState(true)
  const [emailVendor, setEmailVendor]   = useState(false)
  const [vendorEmail, setVendorEmail]   = useState('')
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState<string | null>(null)
  const [comp, setComp]         = useState<ComplianceStatus | null>(null)
  const [compLoading, setCompLoading] = useState(false)

  // Pre-check what's already on file in CINC so we only request what's
  // missing or expired (default-select those; leave on-file & valid ones off).
  useEffect(() => {
    if (!vendorId) { setSelected([]); return }
    let live = true
    setCompLoading(true)
    fetch(`/api/admin/vendors/${vendorId}/compliance${assoc ? `?assoc=${encodeURIComponent(assoc)}` : ''}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then((data: ComplianceStatus | null) => {
        if (!live) return
        setComp(data)
        if (data) {
          const needed = HOLD_ITEMS.filter(it => {
            if (!it.key) return false
            const s = data[it.key]
            return !s?.onFile || s.valid === false   // missing OR expired
          }).map(it => it.label)
          setSelected(needed)
        }
      })
      .catch(() => {})
      .finally(() => { if (live) setCompLoading(false) })
    return () => { live = false }
  }, [vendorId, assoc])

  function toggle(item: string) {
    setSelected(s => s.includes(item) ? s.filter(x => x !== item) : [...s, item])
  }
  function statusChip(key: HoldItemKey): React.ReactNode {
    if (!key || !comp) return null
    const s = comp[key]
    if (!s?.onFile) return <span style={{ fontSize: 11, color: '#b91c1c', fontWeight: 600 }}>❌ missing</span>
    if (s.valid === false) return <span style={{ fontSize: 11, color: '#b45309', fontWeight: 600 }}>⚠️ expired{s.expiration ? ` ${new Date(s.expiration).toLocaleDateString()}` : ''}</span>
    return <span style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>✅ on file{s.expiration ? ` · valid to ${new Date(s.expiration).toLocaleDateString()}` : ''}</span>
  }

  async function submit() {
    const items = [...selected, ...(other.trim() ? [other.trim()] : [])]
    if (items.length === 0) { setErr('Check at least one document to request.'); return }
    if (emailVendor && !vendorEmail.trim()) { setErr('Enter the vendor email, or turn off the email toggle.'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/admin/invoices/intake/${draftId}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, note: note.trim() || null, createTicket, emailVendor, vendorEmail: vendorEmail.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      if (data?.warning) { alert(data.warning) }
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 22, boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>⏸ Put invoice on hold</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
          Hold this invoice until {vendorName || 'the vendor'} provides the documents below. We&rsquo;ll move it to the <strong>On hold</strong> tab.
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
          Documents requested
          {compLoading && <span style={{ fontWeight: 400, color: '#9ca3af' }}> · checking CINC…</span>}
          {comp && <span style={{ fontWeight: 400, color: '#9ca3af' }}> · pre-checked what&rsquo;s missing/expired in CINC</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {HOLD_ITEMS.map(({ label, key }) => (
            <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.includes(label)} onChange={() => toggle(label)} />
              <span>{label}</span>
              <span style={{ marginLeft: 'auto' }}>{statusChip(key)}</span>
            </label>
          ))}
          <input
            type="text"
            value={other}
            onChange={e => setOther(e.target.value)}
            placeholder="Other (type a document)"
            style={{ marginTop: 2, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
          />
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Note (optional)</div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          placeholder="Anything to add for the vendor or the follow-up ticket"
          style={{ width: '100%', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, marginBottom: 14, resize: 'vertical' }}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={createTicket} onChange={e => setCreateTicket(e.target.checked)} />
          Create a follow-up work order ticket
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={emailVendor} onChange={e => setEmailVendor(e.target.checked)} />
          Email the vendor an upload link
        </label>
        {emailVendor && (
          <input
            type="email"
            value={vendorEmail}
            onChange={e => setVendorEmail(e.target.value)}
            placeholder="vendor@example.com"
            style={{ width: '100%', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, marginBottom: 6 }}
          />
        )}

        {err && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} disabled={busy} style={btnSecondary()}>Cancel</button>
          <button onClick={submit} disabled={busy} style={btnPrimary()}>{busy ? 'Saving…' : 'Put on hold'}</button>
        </div>
      </div>
    </div>
  )
}

function ReadOnlyValue({ value, placeholder }: { value: string | null | undefined; placeholder: string }) {
  const has = !!(value && String(value).trim())
  return (
    <div style={{
      padding:   '6px 8px',
      minHeight: 32,
      borderRadius: 4,
      background: '#f9fafb',
      color:      has ? '#111827' : '#9ca3af',
      fontSize:   13,
      display:    'flex',
      alignItems: 'center',
    }}>
      {has ? value : placeholder}
    </div>
  )
}

function Field({ label, children, right }: { label: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 22 }}>
        <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
        {right}
      </span>
      {children}
    </label>
  )
}

// Inline per-field audit toggle — rendered beside each field so the team
// fills the value and confirms it in the same place (no separate checklist
// section). Green when audited; greyed "—" until the field has a value.
function CheckToggle({ on, present, disabled, onToggle }: { on: boolean; present: boolean; disabled?: boolean; onToggle: () => void }) {
  // Three visual states, high-contrast so the un-confirmed pills are easy to
  // spot: solid GREEN once audited, solid AMBER "Confirm" call-to-action when
  // the field has a value, muted grey "Fill first" when it's still empty.
  const style: React.CSSProperties = on
    ? { background: '#16a34a', border: '2px solid #15803d', color: '#fff' }
    : present
      ? { background: '#f59e0b', border: '2px solid #d97706', color: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.12)' }
      : { background: '#f3f4f6', border: '2px dashed #d1d5db', color: '#9ca3af' }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={e => { e.preventDefault(); e.stopPropagation(); onToggle() }}
      title={on ? 'Audited — click to un-confirm' : present ? 'Confirm this field is correct' : 'Fill this field first'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', lineHeight: 1.3,
        ...style,
      }}
    >
      <span style={{ fontSize: 13 }}>{on ? '✓' : present ? '☐' : '○'}</span>
      {on ? 'Audited' : present ? 'Confirm' : 'Fill first'}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────
// CINC vendor payment hint — read-only display of the matched
// vendor's CINC profile defaults, shown under the Payment-method
// field. Mirrors what CINC's vendor page calls "Default Pmt Method":
// ACH when Routing+Account are configured in CINC, otherwise Check.
//
// Purpose: lets Karen verify her Pay By selection matches the CINC
// vendor profile BEFORE pushing. If the selected method conflicts
// with CINC's default (e.g. Karen picked "Check" but CINC has ACH
// banking on file), a yellow warning prompts her to double-check.
//
// READ-ONLY — payment-method changes require bank/ACH setup in CINC,
// which is outside MAIA's scope.
// ─────────────────────────────────────────────────────────────────────
function VendorPmtHint(props: {
  loading:         boolean
  vendor:          { VendorName: string; Dba?: string | null; NetTerm?: number | null; AutoAprvLimit?: number | null; Routing?: string | null; Account?: string | null; DefaultPmtMethod: 'ACH' | 'Check' } | null
  selectedPayBy:   string
  vendorMatched:   boolean
}) {
  const { loading, vendor, selectedPayBy, vendorMatched } = props
  if (!vendorMatched) return null

  if (loading && !vendor) {
    return (
      <div style={{ marginTop: 4, fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>
        Loading CINC vendor profile…
      </div>
    )
  }
  if (!vendor) return null

  // Selected method matches CINC's default? Treat "ACH", "Bank
  // Transfer", "Direct Deposit", "EFT" as ACH-equivalent for the
  // comparison — CINC tenants use different labels for the same idea.
  const sel = (selectedPayBy ?? '').toLowerCase()
  const selectedNorm: 'ACH' | 'Check' | null =
    !sel                                                  ? null    :
    /(ach|bank|eft|direct\s*deposit|wire|online)/i.test(sel) ? 'ACH'  :
    /check/i.test(sel)                                      ? 'Check' :
    null
  const mismatch = selectedNorm != null && selectedNorm !== vendor.DefaultPmtMethod

  // Mask the ACH account for display — show only last 4.
  const acctMask = vendor.Account && vendor.Account.length >= 4
    ? `••••${vendor.Account.slice(-4)}`
    : null

  return (
    <div
      style={{
        marginTop:    6,
        padding:      '6px 8px',
        borderRadius: 4,
        background:   mismatch ? '#fef3c7' : '#f3f4f6',
        border:       mismatch ? '1px solid #f59e0b' : '1px solid #e5e7eb',
        fontSize:     11,
        color:        '#374151',
        display:      'flex',
        flexDirection: 'column',
        gap:          2,
      }}
    >
      <div>
        <strong>CINC vendor default:</strong>{' '}
        <span style={{ fontWeight: 600 }}>{vendor.DefaultPmtMethod}</span>
        {vendor.DefaultPmtMethod === 'ACH' && acctMask && (
          <span style={{ color: '#6b7280' }}> ({acctMask})</span>
        )}
        {typeof vendor.NetTerm === 'number' && vendor.NetTerm > 0 && (
          <span style={{ color: '#6b7280' }}> · Net {vendor.NetTerm}</span>
        )}
        {typeof vendor.AutoAprvLimit === 'number' && vendor.AutoAprvLimit > 0 && (
          <span style={{ color: '#6b7280' }}>
            {' '}· Auto-approve ≤ ${vendor.AutoAprvLimit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
      </div>
      {mismatch && (
        <div style={{ color: '#92400e', fontWeight: 500 }}>
          ⚠ You picked “{selectedPayBy}” but CINC has{' '}
          <strong>{vendor.DefaultPmtMethod}</strong> as this vendor’s default.
          {vendor.DefaultPmtMethod === 'Check'
            ? ' No ACH banking is on file in CINC.'
            : ' Use the ACH option unless this vendor asked to switch.'}
        </div>
      )}
      <div style={{ color: '#9ca3af', fontSize: 10 }}>
        Read-only — payment-method changes require bank/ACH setup in CINC.
      </div>
    </div>
  )
}

function AuditDot({ on, ok = true }: { on: boolean; ok?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: 700, color: on ? '#fff' : '#9ca3af', background: on ? (ok ? '#16a34a' : '#dc2626') : '#e5e7eb' }}>
      {on ? '✓' : '○'}
    </span>
  )
}

function btnPrimary(): React.CSSProperties {
  return { padding: '8px 14px', background: '#f26a1b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 500 }
}
function btnSecondary(): React.CSSProperties {
  return { padding: '8px 14px', background: '#fff', color: '#111827', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: 13 }
}
function btnDanger(): React.CSSProperties {
  return { padding: '8px 14px', background: '#fff', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', fontSize: 13 }
}

// =====================================================================
// AuditFooter — the per-field green-checks live INLINE beside each field
// (see CheckToggle / fieldCheck in DraftCard). This footer carries only
// the non-per-field parts: the system double-pay guard, the vendor's
// recent payments, and the "mark ready to push" approval. Karen can only
// push a draft once every required field is checked + no hard duplicate.
// =====================================================================
interface DupHit { source: string; invoiceNumber: string | null; amount: number | null; date: string | null; status: string | null; paid: boolean }
interface VendorCtx {
  suggestedGl: { glAccount: string | null; accountNumber: string | null; source?: string } | null
  suggestedPayBy?: { method: string; source: string } | null
  recentPayments: Array<{ date: string | null; description: string | null; amount: number; matchedByName?: boolean }>
  duplicate: { exact: DupHit[]; sameAmount: DupHit[]; anyPaid: boolean; hasHardDuplicate: boolean; amountLabel: string | null }
  scanned?: { cincDuplicates: boolean; ledgerPayments: number; ourHistory: number }
}

function AuditFooter(props: {
  ctx:         VendorCtx | null
  dupChecked:  boolean
  hardDup:     boolean
  onToggleDup: () => void
  allReady:    boolean
  requiredOk:  boolean
  isReady:     boolean
  readyBy:     string | null
  busy:        boolean
  msg:         string | null
  onMarkReady: () => void
  onUnready:   () => void
}) {
  const { ctx, dupChecked, hardDup, onToggleDup, allReady, requiredOk, isReady, readyBy, busy, msg, onMarkReady, onUnready } = props
  const dup      = ctx?.duplicate
  const hasSame  = !!dup && dup.sameAmount.length > 0
  const dupClear = !!dup && !hardDup && !hasSame
  const sc       = ctx?.scanned
  // Human description of everything the guard inspected.
  const scannedLine = sc
    ? [
        sc.cincDuplicates ? 'CINC duplicate registry' : null,
        `${sc.ledgerPayments} payment${sc.ledgerPayments === 1 ? '' : 's'} (6-mo ledger)`,
        sc.ourHistory > 0 ? `${sc.ourHistory} prior MAIA invoice${sc.ourHistory === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · ')
    : null

  return (
    <div style={{ marginTop: 14, padding: 12, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#374151', marginBottom: 8 }}>
        ✅ Confirm each field above (auto-saves), then Transfer to Push for Karen
      </div>

      {/* System double-pay guard */}
      <div style={{ padding: '6px 8px', borderRadius: 4,
        background: hardDup ? '#fef2f2' : (hasSame ? '#fffbeb' : '#f0fdf4'),
        border: `1px solid ${hardDup ? '#fecaca' : (hasSame ? '#fde68a' : '#bbf7d0')}` }}>
        <button onClick={onToggleDup} disabled={busy || hardDup}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: hardDup ? 'not-allowed' : 'pointer', padding: 0 }}>
          <AuditDot on={hardDup ? true : dupChecked} ok={!hardDup} />
          <span style={{ fontSize: 13, fontWeight: 600, color: hardDup ? '#b91c1c' : (hasSame ? '#92400e' : '#166534') }}>
            Duplicate / double-pay check {!ctx ? '— checking…' : ''}
          </span>
        </button>
        {scannedLine && (
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3, marginLeft: 26 }}>
            Checked: {scannedLine}.
          </div>
        )}
        {hardDup && (
          <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 4 }}>
            ⛔ Already in CINC{dup?.anyPaid ? ' (PAID)' : ''} — do NOT push:
            {dup?.exact.map((h, i) => <div key={i}>• #{h.invoiceNumber ?? '?'} {h.amount != null ? '· $' + h.amount.toLocaleString() : ''} · {h.source}{h.status ? ' · ' + h.status : ''}</div>)}
          </div>
        )}
        {!hardDup && hasSame && (
          <div style={{ fontSize: 12, color: '#92400e', marginTop: 4 }}>
            ⚠ Found {dup!.sameAmount.length} payment{dup!.sameAmount.length === 1 ? '' : 's'} of the same amount {dup?.amountLabel} — verify this isn’t a double (recurring monthly vendors are normal):
            {dup!.sameAmount.slice(0, 6).map((h, i) => <div key={i}>• {h.date ?? '?'} · {h.amount != null ? '$' + h.amount.toLocaleString() : ''} · {h.source}</div>)}
          </div>
        )}
        {dupClear && <div style={{ fontSize: 12, color: '#166534', marginTop: 2 }}>✓ Checked all of the above — no duplicate or same-amount payment found. Tap to confirm.</div>}
      </div>

      {/* Recent payments context */}
      {ctx && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280' }}>
            Recent payments (this assoc, 6 mo){sc ? ` · scanned ${sc.ledgerPayments}` : ''}
          </div>
          {ctx.recentPayments.length > 0 ? (
            ctx.recentPayments.map((p, i) => (
              <div key={i} style={{ fontSize: 12, color: '#374151', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>
                  {p.date ?? '?'} · {p.description ?? ''}
                  {p.matchedByName
                    ? <span style={{ color: '#16a34a', fontSize: 10 }}> · name match</span>
                    : <span style={{ color: '#b45309', fontSize: 10 }}> · same amount</span>}
                </span>
                <span style={{ fontFamily: 'ui-monospace, monospace' }}>${p.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 12, color: '#9ca3af' }}>
              No payments by name or matching amount in the last 6 months{sc ? ` (scanned ${sc.ledgerPayments})` : ''}. CINC ledger lines often omit the vendor name.
            </div>
          )}
        </div>
      )}

      {/* Ready toggle */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        {isReady ? (
          <>
            <span style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>✓ Transferred to Push{readyBy ? ` · by ${readyBy}` : ''} — Karen pushes from the “Ready to push” tab</span>
            <button onClick={onUnready} disabled={busy} style={btnSecondary()}>↩ Return to team</button>
          </>
        ) : (
          <button onClick={onMarkReady} disabled={busy || !allReady} style={allReady ? btnPrimary() : btnSecondary()}>
            {allReady ? 'Transfer to Push →' : requiredOk ? 'Confirm the duplicate check to enable' : 'Confirm every field above to enable'}
          </button>
        )}
      </div>
      {msg && <div style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}>{msg}</div>}
    </div>
  )
}

// =====================================================================
// FundsCheck — the "do we have the money to pay this on the scheduled
// date?" check. Runs once Amount + Scheduled date are confirmed. Projects
// the pay-from account's balance to the END OF THE SCHEDULED MONTH using
// ALL open invoices + the account's average monthly net flow, shows a big
// affordable / short verdict, a 6-month horizon, and lets the reviewer
// move the scheduled date to the earliest affordable month.
// =====================================================================

interface FundsResult {
  bankAccountDescription: string
  currentBalance:         number
  openInvoicesTotal:      number
  openInvoicesCount:      number
  avgMonthlyNet:          number
  avgMonthlyIn:           number
  avgMonthlyOut:          number
  monthsSampled:          number
  pushAmount:             number
  scheduledMonth:         string
  monthsAhead:            number
  projectedAtScheduled:   number
  affordable:             boolean
  tight:                  boolean
  tightThreshold:         number
  openInvoiceScope:       'all' | 'due-by-scheduled'
  earliestAffordableMonth: string | null
  horizon:                Array<{ month: string; monthsAhead: number; projectedBalance: number; affordableAfterPush: boolean }>
  caveats:                string[]
}

const fmtUSD = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const monthLabel = (ym: string) => { const d = new Date(`${ym}-01T00:00:00Z`); return d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) }
const endOfMonthISO = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }

function FundsCheck({ assoc, bankAccountId, pushAmount, scheduledDate, onChooseDate }: {
  assoc: string; bankAccountId: number | null; pushAmount: number; scheduledDate: string; onChooseDate: (date: string) => void
}) {
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [res, setRes]       = useState<FundsResult | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  // Which open invoices count against the balance. 'all' is the conservative
  // default; 'due-by-scheduled' ignores invoices not yet due so a near-term
  // check isn't deflated by money that won't leave for months.
  const [scope, setScope]   = useState<'all' | 'due-by-scheduled'>('all')

  useEffect(() => {
    if (!assoc || !bankAccountId) { setRes(null); return }
    setBusy(true); setError(null)
    const p = new URLSearchParams({ assoc, account: String(bankAccountId), scheduled: scheduledDate || '', push: String(pushAmount || 0), scope })
    let live = true
    fetch(`/api/admin/cinc/funds-check?${p.toString()}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (!live) return; if (d?.error) throw new Error(d.error); setRes(d) })
      .catch(err => { if (live) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [assoc, bankAccountId, scheduledDate, pushAmount, scope])

  if (busy && !res) return <div style={{ marginTop: 12, padding: 10, fontSize: 12, color: '#6b7280', background: '#f9fafb', borderRadius: 6 }}>💰 Running funds check…</div>
  if (error)        return <div style={{ marginTop: 12, padding: 10, fontSize: 12, color: '#92400e', background: '#fef3c7', borderRadius: 6 }}>Funds check unavailable: {error}</div>
  if (!res) return null

  const ok       = res.affordable
  const tight    = res.tight
  const bg       = !ok ? '#fef2f2' : tight ? '#fffbeb' : '#ecfdf5'
  const border   = !ok ? '#fca5a5' : tight ? '#fcd34d' : '#86efac'
  const fg       = !ok ? '#991b1b' : tight ? '#92400e' : '#065f46'
  const icon     = !ok ? '🛑' : tight ? '⚠' : '✅'
  const schedLabel = scheduledDate ? new Date(`${scheduledDate}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : monthLabel(res.scheduledMonth)
  const earliest = res.earliestAffordableMonth

  return (
    <div style={{ marginTop: 12, padding: 12, background: bg, border: `2px solid ${border}`, borderRadius: 8, fontSize: 13, color: fg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div style={{ fontWeight: 700 }}>
          {ok ? 'Funds available' : 'Not enough funds'} to pay {fmtUSD(res.pushAmount)} on {schedLabel}
        </div>
        <button onClick={() => setShowDetail(s => !s)} style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 8px', border: `1px solid ${border}`, background: 'transparent', color: fg, borderRadius: 4, cursor: 'pointer' }}>
          {showDetail ? 'Hide math' : 'Show math'}
        </button>
      </div>
      <div style={{ marginTop: 4, marginLeft: 26 }}>
        Projected <strong>{res.bankAccountDescription}</strong> balance at end of {monthLabel(res.scheduledMonth)} (after this payment) = <strong>{fmtUSD(res.projectedAtScheduled)}</strong>.
      </div>

      {/* Move-the-date affordance */}
      <div style={{ marginTop: 10, marginLeft: 26, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: fg }}>
          Scheduled pay date:{' '}
          <input type="date" value={scheduledDate} onChange={e => onChooseDate(e.target.value)}
            style={{ padding: 4, border: `1px solid ${border}`, borderRadius: 4 }} />
        </label>
        <label style={{ fontSize: 12, color: fg }} title="Which open invoices to subtract from the balance">
          Count:{' '}
          <select value={scope} onChange={e => setScope(e.target.value as 'all' | 'due-by-scheduled')}
            style={{ padding: 4, border: `1px solid ${border}`, borderRadius: 4 }}>
            <option value="all">all open invoices</option>
            <option value="due-by-scheduled">only due by {monthLabel(res.scheduledMonth)}</option>
          </select>
        </label>
        {!ok && earliest && (
          <button onClick={() => onChooseDate(endOfMonthISO(earliest))}
            style={{ fontSize: 12, fontWeight: 600, padding: '5px 10px', background: '#fff', border: `1px solid ${border}`, borderRadius: 6, cursor: 'pointer', color: fg }}>
            ↪ Move to {monthLabel(earliest)} (first month with funds)
          </button>
        )}
        {!ok && !earliest && (
          <span style={{ fontSize: 12 }}>No month in the next 6 covers this — consider Reserve / Special Assessment funding.</span>
        )}
      </div>

      {/* 6-month horizon */}
      <div style={{ marginTop: 10, marginLeft: 26, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {res.horizon.map(h => {
          const sel = h.month === res.scheduledMonth
          return (
            <button key={h.month} onClick={() => onChooseDate(endOfMonthISO(h.month))} title={`Projected ${fmtUSD(h.projectedBalance)}`}
              style={{
                fontSize: 11, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                border: sel ? '2px solid #111827' : `1px solid ${h.affordableAfterPush ? '#86efac' : '#fca5a5'}`,
                background: h.affordableAfterPush ? '#dcfce7' : '#fee2e2',
                color: h.affordableAfterPush ? '#065f46' : '#991b1b', fontWeight: sel ? 700 : 500,
              }}>
              {monthLabel(h.month)} {h.affordableAfterPush ? '✓' : '✕'} {fmtUSD(h.projectedBalance)}
            </button>
          )
        })}
      </div>

      {showDetail && (
        <div style={{ marginTop: 10, marginLeft: 26, padding: 8, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, color: '#111827' }}>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <tbody>
              <tr><td>Current balance</td><td style={{ textAlign: 'right' }}>{fmtUSD(res.currentBalance)}</td></tr>
              <tr><td>− {res.openInvoiceScope === 'due-by-scheduled' ? `Open invoices due by ${monthLabel(res.scheduledMonth)}` : 'All open invoices in CINC'} ({res.openInvoicesCount})</td><td style={{ textAlign: 'right', color: '#991b1b' }}>−{fmtUSD(res.openInvoicesTotal)}</td></tr>
              <tr><td>− This payment</td><td style={{ textAlign: 'right', color: '#991b1b' }}>−{fmtUSD(res.pushAmount)}</td></tr>
              {res.monthsAhead > 0 && (
                <tr><td>{res.monthsAhead} month(s) of run-rate net flow (~{fmtUSD(res.avgMonthlyNet)}/mo)</td><td style={{ textAlign: 'right', color: res.avgMonthlyNet >= 0 ? '#065f46' : '#991b1b' }}>{fmtUSD(res.monthsAhead * res.avgMonthlyNet)}</td></tr>
              )}
              <tr style={{ borderTop: '1px solid #d1d5db' }}><td><strong>Projected at end of {monthLabel(res.scheduledMonth)}</strong></td><td style={{ textAlign: 'right' }}><strong style={{ color: ok ? '#065f46' : '#991b1b' }}>{fmtUSD(res.projectedAtScheduled)}</strong></td></tr>
            </tbody>
          </table>
          {res.monthsSampled > 0 && (
            <div style={{ marginTop: 6, fontSize: 10, color: '#6b7280' }}>
              Run-rate from last {res.monthsSampled} month(s): ~{fmtUSD(res.avgMonthlyIn)}/mo in, ~{fmtUSD(res.avgMonthlyOut)}/mo out.
            </div>
          )}
          {res.caveats.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 10, color: '#6b7280', borderTop: '1px dashed #e5e7eb', paddingTop: 6 }}>
              <strong>Assumptions:</strong>
              <ul style={{ paddingLeft: 14, margin: '4px 0 0' }}>{res.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// =====================================================================
// InvoiceHistory — collapsed-by-default audit-trail viewer for pushed
// invoices. Fetches CINC's /invoiceHistory + /invoicePayments on first
// open, interleaves them into a single timeline so Karen sees the full
// lifecycle in chronological order:
//   Created → Approved → Ready for Payment → Paid (with who/when on each)
// =====================================================================

interface HistoryEntry { Date?: string | null; Action?: string | null; Message?: string | null; User?: string | null }
interface PaymentEntry { TransDate?: string | null; Description?: string | null; CheckNo?: string | null; Amount?: number | null }

interface TimelineRow {
  date:     Date | null
  kind:     'history' | 'payment'
  primary:  string  // headline action / "Payment received"
  detail:   string  // CINC message / amount + check# + description
  user:     string | null
}

function InvoiceHistory({ invoiceId }: { invoiceId: number }) {
  const [open,    setOpen]    = useState(false)
  const [loaded,  setLoaded]  = useState(false)
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [payments, setPayments] = useState<PaymentEntry[]>([])

  async function loadHistory() {
    if (loaded || busy) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/admin/cinc/invoice-history?invoiceId=${encodeURIComponent(invoiceId)}`, { cache: 'no-store' })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`)
      setHistory(data.history ?? [])
      setPayments(data.payments ?? [])
      setLoaded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) void loadHistory()
  }

  // Merge + chronologically sort the two streams. CINC's history rows
  // and payment rows are independent — combining gives one canonical
  // lifecycle view.
  const timeline: TimelineRow[] = useMemo(() => {
    const rows: TimelineRow[] = []
    for (const h of history) {
      rows.push({
        date:     h.Date ? new Date(h.Date) : null,
        kind:     'history',
        primary:  h.Action ?? 'Audit event',
        detail:   h.Message ?? '',
        user:     h.User ?? null,
      })
    }
    for (const p of payments) {
      const amt = typeof p.Amount === 'number' ? `$${Math.abs(p.Amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''
      const checkBit = p.CheckNo ? ` · Check #${p.CheckNo}` : ''
      rows.push({
        date:     p.TransDate ? new Date(p.TransDate) : null,
        kind:     'payment',
        primary:  'Payment received',
        detail:   `${amt}${checkBit}${p.Description ? ` · ${p.Description}` : ''}`,
        user:     null,
      })
    }
    return rows.sort((a, b) => {
      const ta = a.date?.getTime() ?? 0
      const tb = b.date?.getTime() ?? 0
      return ta - tb
    })
  }, [history, payments])

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={toggle}
        style={{
          padding:  '4px 10px',
          fontSize: 12,
          border:   '1px solid #10b981',
          background: open ? '#10b981' : 'transparent',
          color:    open ? '#fff' : '#065f46',
          borderRadius: 3,
          cursor:   'pointer',
        }}
      >
        {open ? '▾ Hide CINC status & history' : '▸ Show CINC status & history'}
      </button>

      {open && (
        <div style={{ marginTop: 8, padding: 10, background: '#fff', border: '1px solid #d1fae5', borderRadius: 4 }}>
          {busy && <div style={{ color: '#6b7280', fontSize: 12 }}>Loading from CINC…</div>}
          {error && (
            <div style={{ color: '#991b1b', fontSize: 12, padding: 6, background: '#fee2e2', borderRadius: 3 }}>
              {error}
            </div>
          )}
          {loaded && !busy && timeline.length === 0 && (
            <div style={{ color: '#9ca3af', fontSize: 12 }}>
              No history rows yet. CINC may take a few minutes to log a newly-created invoice.
            </div>
          )}
          {loaded && timeline.length > 0 && (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {timeline.map((row, i) => (
                <li
                  key={i}
                  style={{
                    padding: '6px 0',
                    borderBottom: i < timeline.length - 1 ? '1px solid #f3f4f6' : 'none',
                    fontSize: 12,
                    display: 'grid',
                    gridTemplateColumns: '140px 1fr auto',
                    gap: 10,
                    alignItems: 'baseline',
                  }}
                >
                  <span style={{ color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>
                    {row.date ? row.date.toLocaleString() : '—'}
                  </span>
                  <span>
                    <strong style={{ color: row.kind === 'payment' ? '#065f46' : '#111827' }}>
                      {row.primary}
                    </strong>
                    {row.detail && <span style={{ color: '#4b5563' }}> · {row.detail}</span>}
                  </span>
                  <span style={{ color: '#9ca3af', fontSize: 11 }}>
                    {row.user ?? (row.kind === 'payment' ? 'CINC' : '')}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {loaded && (
            <div style={{ marginTop: 6, textAlign: 'right' }}>
              <button
                onClick={() => { setLoaded(false); void loadHistory() }}
                style={{ padding: '2px 8px', fontSize: 11, border: '1px solid #d1d5db', background: '#fff', borderRadius: 3, cursor: 'pointer', color: '#6b7280' }}
              >
                Refresh
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// VendorCombobox — type-to-search vendor picker.
//
// Replaces the native <select> (which listed every CINC vendor in import
// order — hundreds of rows, unsorted). Vendors are sorted alphabetically;
// typing filters by case-insensitive substring; the rendered list is
// capped so a big vendor book stays responsive. Keyboard: ↑/↓ to move,
// Enter to pick, Esc to close.
// ─────────────────────────────────────────────────────────────────────
const VENDOR_RESULT_CAP = 50

function VendorCombobox({
  vendors, value, onChange, disabled,
}: {
  vendors: Vendor[]
  value:   string                       // selected vendor id (stringified) or ''
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const sorted = useMemo(
    () => [...vendors].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
    [vendors],
  )
  const selected = useMemo(
    () => vendors.find(v => String(v.id) === value) ?? null,
    [vendors, value],
  )

  const [query, setQuery]     = useState(selected?.name ?? '')
  const [dirty, setDirty]     = useState(false)   // true once the user types
  const [open, setOpen]       = useState(false)
  const [highlight, setHighlight] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  // Keep the input text in sync when the selection changes from outside
  // (e.g. draft reset / re-match), but don't clobber what the user types.
  useEffect(() => {
    if (!open) { setQuery(selected?.name ?? ''); setDirty(false) }
  }, [selected, open])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const q = query.trim().toLowerCase()
  const matches = useMemo(
    // Search the legal name AND the DBA / short name — many vendors invoice
    // under a DBA while CINC carries the legal name (e.g. typing "Envera"
    // must find "Hidden Eyes LLC" whose DBA is "Envera Systems").
    () => ((dirty && q)
      ? sorted.filter(v =>
          v.name.toLowerCase().includes(q) ||
          (v.dba ?? '').toLowerCase().includes(q) ||
          (v.shortName ?? '').toLowerCase().includes(q))
      : sorted),
    [sorted, dirty, q],
  )
  const shown = matches.slice(0, VENDOR_RESULT_CAP)

  function pick(v: Vendor) {
    onChange(String(v.id))
    setQuery(v.name)
    setDirty(false)
    setOpen(false)
  }
  function clear() {
    onChange('')
    setQuery('')
    setDirty(true)
    setOpen(true)
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          disabled={disabled}
          placeholder="— pick vendor — type name or DBA"
          onChange={e => { setQuery(e.target.value); setDirty(true); setOpen(true); setHighlight(0) }}
          onFocus={() => { setOpen(true); setHighlight(0) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(h + 1, shown.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
            else if (e.key === 'Enter') { if (open && shown[highlight]) { e.preventDefault(); pick(shown[highlight]) } }
            else if (e.key === 'Escape') { setOpen(false) }
          }}
          style={{ width: '100%', padding: 6, paddingRight: 22, boxSizing: 'border-box' }}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={clear}
            title="Clear vendor"
            style={{
              position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
              border: 'none', background: 'transparent', cursor: 'pointer', color: '#9ca3af',
              fontSize: 14, lineHeight: 1, padding: '0 4px',
            }}
          >×</button>
        )}
      </div>

      {open && !disabled && (
        <div
          style={{
            position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, marginTop: 2,
            background: '#fff', border: '1px solid #d1d5db', borderRadius: 6,
            maxHeight: 260, overflowY: 'auto', boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
          }}
        >
          {shown.length === 0 ? (
            <div style={{ padding: '8px 10px', fontSize: 12, color: '#9ca3af' }}>
              No vendor matches &quot;{query}&quot;.
            </div>
          ) : (
            shown.map((v, i) => {
              const isSel = String(v.id) === value
              return (
                <div
                  key={v.id}
                  onMouseDown={e => { e.preventDefault(); pick(v) }}
                  onMouseEnter={() => setHighlight(i)}
                  style={{
                    padding: '6px 10px', fontSize: 13, cursor: 'pointer',
                    background: i === highlight ? '#fef3ec' : isSel ? '#f9fafb' : '#fff',
                    color: '#111',
                    display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline',
                  }}
                >
                  <span>
                    {v.name}
                    {v.dba && <span style={{ color: '#6b7280', fontSize: 11 }}> · DBA {v.dba}</span>}
                  </span>
                  {isSel && <span style={{ color: '#f26a1b', fontSize: 11 }}>✓</span>}
                </div>
              )
            })
          )}
          {matches.length > shown.length && (
            <div style={{ padding: '6px 10px', fontSize: 11, color: '#9ca3af', borderTop: '1px solid #f3f4f6' }}>
              +{matches.length - shown.length} more — keep typing to narrow.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
