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

  // GL options for the selected association — fetched on demand the
  // first time edit mode + assoc are both set, then memoised. Refresh
  // bypasses the server cache for cases where Karen just added a
  // budget line in CINC.
  const [glOptions, setGlOptions] = useState<BudgetGlOption[]>([])
  const [glLoading, setGlLoading] = useState(false)
  const [glError, setGlError]     = useState<string | null>(null)
  const [glLoadedFor, setGlLoadedFor] = useState<string>('')

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
