// =====================================================================
// app/admin/invoices/components/InvoiceIntakeQueue.tsx
// Client component. Tabs across the top (pending review / needs vendor
// / duplicates / pushed / rejected), card per draft, inline edit +
// push/reject/rematch actions.
// =====================================================================

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface Vendor      { id: number;  name: string; shortName: string | null }
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
  extracted_amount:            number | null
  extracted_association_code:  string | null
  extracted_invoice_date:      string | null
  gl_account_id:               string | null
  gl_account_name:             string | null
  pay_by_type:                 string | null
  observation_note:            string | null
  work_order_number:           number | null
  pay_from_bank_account_id:    number | null
  extraction_confidence:       number | null
  status:                      string
  rejected_reason:             string | null
  cinc_invoice_id:             string | null
  cinc_dup_invoice_id:         string | null
  pushed_at:                   string | null
  pushed_by:                   string | null
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

const TABS: Array<{ key: string; label: string }> = [
  { key: 'pending_review',    label: 'Pending review' },
  { key: 'needs_vendor',      label: 'Needs vendor' },
  { key: 'duplicate_in_cinc', label: 'Duplicates' },
  { key: 'pushed_to_cinc',    label: 'Pushed' },
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
  const [counts, setCounts] = useState<Record<string, number>>(props.initialCounts)
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const fetchTab = useCallback(async (s: string) => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/admin/invoices/intake?status=${encodeURIComponent(s)}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setDrafts(data.drafts ?? [])
      setCounts(data.counts ?? {})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  function switchTab(s: string) {
    setStatus(s)
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

  return (
    <div style={{ maxWidth: 1100, margin: '24px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Invoice intake</h1>
        <button
          onClick={refreshVendorCache}
          disabled={busy}
          style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }}
        >
          Refresh CINC vendor cache
        </button>
      </header>

      <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
        {TABS.map(t => {
          const active = t.key === status
          const count  = counts[t.key] ?? 0
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {drafts.map(d => (
          <DraftCard
            key={d.id}
            draft={d}
            vendors={props.vendors}
            associations={props.associations}
            onMutate={() => void fetchTab(status)}
          />
        ))}
      </div>
    </div>
  )
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
  const [amount, setAmount]       = useState<string>(draft.extracted_amount != null ? String(draft.extracted_amount) : '')
  const [invDate, setInvDate]     = useState<string>(draft.extracted_invoice_date ?? '')
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
  const [payByOptions, setPayByOptions] = useState<PayByOption[]>([])
  const [payByLoading, setPayByLoading] = useState(false)
  const [payByLoadedFor, setPayByLoadedFor] = useState<string>('')

  // Open CINC work orders for the (assoc, vendor) pair — Karen links
  // a maintenance invoice to an existing WO so it shows up under that
  // WO instead of standalone. Lazy-loaded when both keys are set.
  const [woOptions, setWoOptions] = useState<WorkOrderOption[]>([])
  const [woLoading, setWoLoading] = useState(false)
  const [woLoadedKey, setWoLoadedKey] = useState<string>('')

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
    if (mode !== 'edit' || !assoc || bankLoadedFor === assoc || bankLoading) return
    setBankLoading(true); setBankError(null)
    fetch(`/api/admin/cinc/bank-accounts?assoc=${encodeURIComponent(assoc)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (data?.error) throw new Error(data.error)
        const accounts: BankAccountOption[] = data.accounts ?? []
        setBankOptions(accounts)
        setBankLoadedFor(assoc)
        // Auto-select operating if nothing chosen yet. listAssociation
        // BankAccounts sorts operating first, so we can just pick the
        // first 'operating' kind we see.
        if (!bankId) {
          const operating = accounts.find(a => a.kind === 'operating')
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

  // Lazy-load payByTypes for the assoc, same pattern.
  useEffect(() => {
    if (mode !== 'edit' || !assoc || payByLoadedFor === assoc || payByLoading) return
    setPayByLoading(true)
    fetch(`/api/admin/cinc/pay-by-types?assoc=${encodeURIComponent(assoc)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (!data?.error) setPayByOptions(data.types ?? [])
        setPayByLoadedFor(assoc)
      })
      .catch(() => { /* swallow — fall back to the manual text input */ })
      .finally(() => setPayByLoading(false))
  }, [mode, assoc, payByLoadedFor, payByLoading])

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
    setAmount   (draft.extracted_amount != null ? String(draft.extracted_amount) : '')
    setInvDate  (draft.extracted_invoice_date     ?? '')
    setGlId     (draft.gl_account_id   ?? '')
    setGlName   (draft.gl_account_name ?? '')
    setPayBy    (draft.pay_by_type     ?? '')
    setNote     (draft.observation_note ?? '')
    setWoNumber (draft.work_order_number != null ? String(draft.work_order_number) : '')
    setBankId   (draft.pay_from_bank_account_id != null ? String(draft.pay_from_bank_account_id) : '')
    setMode('view')
    setMsg(null)
  }

  async function save() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/invoices/intake', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          id:                          draft.id,
          matched_cinc_vendor_id:      vendorId || null,
          matched_vendor_name:         matchedVendor?.name ?? null,
          matched_vendor_short_name:   shortName || null,
          extracted_invoice_number:    invNo || null,
          extracted_amount:            amount ? parseFloat(amount) : null,
          extracted_association_code:  assoc || null,
          extracted_invoice_date:      invDate || null,
          gl_account_id:               glId   || null,
          gl_account_name:             glName || null,
          pay_by_type:                 payBy  || null,
          observation_note:            note   || null,
          work_order_number:           woNumber ? parseInt(woNumber, 10) : null,
          pay_from_bank_account_id:    bankId ? parseInt(bankId, 10) : null,
        }),
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
      if (!res.ok && res.status !== 207) throw new Error(data?.error ?? `HTTP ${res.status}`)
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

  const isPushed   = draft.status === 'pushed_to_cinc'
  const isRejected = draft.status === 'rejected'
  const readOnly   = isPushed || isRejected

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 16, background: '#fff' }}>
      {draft.status === 'needs_vendor' && (
        <div style={{ padding: 8, marginBottom: 12, background: '#fef3c7', borderLeft: '3px solid #f59e0b', fontSize: 13 }}>
          No CINC vendor matched <strong>{draft.extracted_vendor_name ?? '(unknown vendor)'}</strong>.
          Create the vendor in CINC, then click <em>Re-match</em>.
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
          {draft.cinc_invoice_id && (
            <InvoiceHistory invoiceId={parseInt(draft.cinc_invoice_id, 10)} />
          )}
        </div>
      )}
      {isRejected && (
        <div style={{ padding: 8, marginBottom: 12, background: '#f3f4f6', borderLeft: '3px solid #6b7280', fontSize: 13 }}>
          Rejected. {draft.rejected_reason && <em>"{draft.rejected_reason}"</em>}
        </div>
      )}

      {/* PDF preview — inline so Karen can visually verify the invoice
          before reviewing extracted fields. Iframe is the simplest
          embed that handles every browser's PDF viewer; fixed height
          keeps the card scannable. Falls back to a download link if
          the signed URL is missing (storage upload failed at intake). */}
      {draft.pdf_signed_url ? (
        <div style={{ marginBottom: 14 }}>
          <iframe
            src={draft.pdf_signed_url}
            title={`Invoice ${draft.id}`}
            style={{ width: '100%', height: 480, border: '1px solid #e5e7eb', borderRadius: 4, background: '#f9fafb' }}
          />
          <div style={{ marginTop: 4, textAlign: 'right' }}>
            <a href={draft.pdf_signed_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#6b7280', textDecoration: 'none' }}>
              Open in new tab ↗
            </a>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 14, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, fontSize: 12, color: '#991b1b' }}>
          PDF preview not available — the original upload to storage failed at intake.
          The data below was extracted from the email body, not the PDF.
        </div>
      )}

      {/* Form / display grid — same fields in both modes. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
        <Field label="Vendor (CINC)">
          {mode === 'edit' ? (
            <>
              <select
                value={vendorId}
                onChange={e => setVendorId(e.target.value)}
                disabled={readOnly}
                style={{ width: '100%', padding: 6 }}
              >
                <option value="">— pick vendor —</option>
                {vendors.map(v => (
                  <option key={v.id} value={String(v.id)}>{v.name}</option>
                ))}
              </select>
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

        <Field label="Short name (saved to CINC UserDefined1)">
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

        <Field label="Association">
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

        <Field label="Invoice #">
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

        <Field label="Amount ($)">
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
            <ReadOnlyValue
              value={invDate ? new Date(invDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
              placeholder="—"
            />
          )}
        </Field>

        {/* Payment method — CINC's PayByType values per association.
            Falls back to a free-text input if CINC returns no options
            (mis-configured assoc — Karen can still type something the
            CINC team will accept). */}
        <Field label="Payment method">
          {mode === 'edit' ? (
            payByOptions.length > 0 ? (
              <select
                value={payBy}
                onChange={e => setPayBy(e.target.value)}
                disabled={readOnly}
                style={{ width: '100%', padding: 6 }}
              >
                <option value="">
                  {payByLoading ? 'Loading payment methods…' : '— pick payment method —'}
                </option>
                {payByOptions.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={payBy}
                onChange={e => setPayBy(e.target.value)}
                disabled={readOnly}
                placeholder={payByLoading ? 'Loading…' : 'e.g. Check / ACH'}
                style={{ width: '100%', padding: 6 }}
              />
            )
          ) : (
            <ReadOnlyValue value={payBy} placeholder="— not set —" />
          )}
        </Field>

        {/* Observation — free text Karen edits. Maps to CINC's
            NoteDescription so the CINC processor sees it when viewing
            the invoice. Auto-suggested from the payment method. */}
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

        {/* Work-order link (optional) — Karen ties a maintenance invoice
            to an existing CINC work order so the WO history shows the
            spend. Loaded from CINC when vendor + assoc are both set;
            otherwise the dropdown is disabled. Spans both columns
            because WO descriptions can be long. */}
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Link to work order (optional)">
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

        {/* GL — spans both columns so long account names fit. Source is
            the association's CINC budget, fetched lazily on first edit. */}
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="GL line (from association budget)">
            {mode === 'edit' ? (
              <>
                <select
                  value={glId}
                  onChange={e => {
                    const id = e.target.value
                    setGlId(id)
                    const hit = glOptions.find(o => o.id === id)
                    setGlName(hit?.name ?? '')
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
          <Field label="Pay from bank account">
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
                    const kindLabel =
                      b.kind === 'operating' ? 'Operating'
                      : b.kind === 'reserve' ? 'Reserve'
                      : b.kind === 'special' ? 'Special Assessment'
                      : 'Other'
                    const last4 = b.last4 ? ` …${b.last4}` : ''
                    const bal   = b.bankBalance != null
                      ? `  ·  $${b.bankBalance.toLocaleString('en-US', { maximumFractionDigits: 0 })} available`
                      : ''
                    return (
                      <option key={b.id} value={String(b.id)}>
                        {kindLabel}{last4}{bal}
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
                    ?? (draft.pay_from_bank_account_id != null ? { description: `BankAccountID ${draft.pay_from_bank_account_id}` } as Partial<BankAccountOption> : null)
                  return sel?.description ?? ''
                })()}
                placeholder={assoc ? '— not set (CINC default: Operating) —' : '— pick association first —'}
              />
            )}
          </Field>
        </div>
      </div>

      {/* Filename preview — what will be written to CINC + Drive on push.
          Live-updates as fields change in edit mode so Karen sees exactly
          what's about to be saved. */}
      {!isRejected && (
        <div style={{ marginTop: 14, padding: '8px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 12 }}>
          <span style={{ color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10, fontWeight: 600 }}>Will be saved as</span>
          <div style={{ marginTop: 4, fontFamily: 'ui-monospace, monospace', color: '#111827', wordBreak: 'break-all' }}>
            {buildFilenamePreview({ assoc, short: shortName, invNo, amount })}
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

      {!readOnly && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {mode === 'view' ? (
            <>
              <button onClick={() => setMode('edit')} disabled={busy} style={btnSecondary()}>Edit</button>
              {draft.status === 'needs_vendor' && (
                <button onClick={rematch} disabled={busy} style={btnSecondary()}>Re-match vendor</button>
              )}
              {draft.status === 'duplicate_in_cinc' ? (
                <button onClick={() => push(true)} disabled={busy} style={btnPrimary()}>Push anyway</button>
              ) : (
                <button onClick={() => push(false)} disabled={busy} style={btnPrimary()}>Push to CINC</button>
              )}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      {children}
    </label>
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
