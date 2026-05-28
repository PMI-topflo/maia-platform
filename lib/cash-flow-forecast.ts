// =====================================================================
// lib/cash-flow-forecast.ts
//
// Projects end-of-month balance for a (assoc, bank account) pair.
// Three components:
//
//   1. CURRENT BALANCE — from CINC bankBalances (Bank or CINC reconciled
//      value, depending on which we trust more for this assoc).
//   2. APPROVED UNPAID — sum of /openInvoices for the assoc whose
//      pay_from_bank_account_id we know (MAIA-pushed drafts). Non-MAIA
//      open invoices don't carry a bank account on the CINC side, so
//      they're documented as a known gap (not silently included).
//   3. RECURRING PROJECTED — moderate heuristic: vendor descriptions
//      that appeared in at least 2 of the last 3 calendar months with
//      similar amounts (±15%) and have NOT yet been paid this month
//      project forward as upcoming outflows.
//
// Returns a single number (EOM balance projection) plus the breakdown
// so the UI can show "current $X − approved $Y − projected $Z = EOM $W"
// with hover-detail for each line item.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  listGlTransactionsByDate,
  listOpenInvoices,
  listAssociationBankAccounts,
  type CincGlTransaction,
} from '@/lib/integrations/cinc'

// ── Tuning constants ────────────────────────────────────────────────
const LOOKBACK_MONTHS         = 3
const AMOUNT_TOLERANCE        = 0.15  // ±15% when matching recurring vendors
const MIN_MONTHS_FOR_RECURRING = 2     // moderate heuristic: 2 of last 3 months

// ── Public types ────────────────────────────────────────────────────

export interface RecurringVendor {
  /** Normalised fingerprint used for grouping (lowercased, dates +
   *  invoice numbers stripped). */
  key:               string
  /** Most-readable description we've seen for this group. */
  displayName:       string
  /** Mean of seen amounts. */
  avgAmount:         number
  /** Distinct calendar months in the lookback window this appeared in. */
  monthsSeen:        number
  /** YYYY-MM of the most recent occurrence. */
  lastSeenMonth:     string
  /** True if we haven't seen this group in the current calendar month
   *  yet — implies an upcoming projection. */
  pendingThisMonth:  boolean
}

export interface ApprovedUnpaidLineItem {
  invoiceNumber: string | null
  vendorName:    string | null
  amount:        number
  dueDate:       string | null
}

export interface ForecastResult {
  associationCode:        string
  bankAccountId:          number
  bankAccountDescription: string

  currentBalance:         number
  approvedUnpaid:         number
  recurringProjected:     number

  /** currentBalance − approvedUnpaid − recurringProjected. */
  projectedEomBalance:    number

  /** Convenience flag — true if EOM goes negative. */
  willOverdraw:           boolean

  /** Per-line breakdowns the UI uses to render hover-detail. */
  approvedUnpaidItems:    ApprovedUnpaidLineItem[]
  recurringVendors:       RecurringVendor[]

  /** Sources of inaccuracy — surfaced in the UI as a small footnote. */
  caveats:                string[]
}

// ── Internals ───────────────────────────────────────────────────────

/** Normalise a CINC transaction description into a fingerprint suitable
 *  for grouping. Strips dates (YYYY-MM-DD or MM/DD/YYYY), invoice
 *  numbers (Inv #..., RVP-..., 6+ digit runs), and check #s. Collapses
 *  whitespace + lowercases. */
function vendorKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/\binv\.?\s*#?\s*[\w-]+/gi, '')          // "Inv.#RVP-3954" / "Inv # 010226"
    .replace(/\bcheck\s*#?\s*\d+/gi,    '')           // "Check #4012"
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g,  '')           // 2026-04-01
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '')    // 4/1/26 or 04/01/2026
    .replace(/\b\d{6,}\b/g, '')                       // long numbers (invoice / account #s)
    .replace(/[—–-]+/g, ' ')                          // dashes
    .replace(/\s+/g, ' ')
    .trim()
}

interface VendorBucket {
  key:           string
  displayNames:  Map<string, number>   // Description → count, pick most common
  amountsByMonth: Map<string, number[]>  // YYYY-MM → amounts seen
}

function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7)
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function startOfMonthMinusN(months: number): string {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - months)
  return isoDate(d)
}

function endOfCurrentMonth(): string {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)  // last day of previous (current) month
  return isoDate(d)
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

/** Analyse the last `LOOKBACK_MONTHS` of glTransactions for one bank
 *  account and return the vendors meeting the recurring threshold. */
async function detectRecurring(
  assocCode:        string,
  cashGl:           string,
  excludeGlTransIds: Set<number>,
): Promise<RecurringVendor[]> {
  const fromDate = startOfMonthMinusN(LOOKBACK_MONTHS)
  const toDate   = isoDate(new Date())
  const txs      = await listGlTransactionsByDate({
    assocCode,
    fromDate,
    toDate,
    accountNumber: cashGl,
  })

  // Bucket outflows by vendor key. Outflow = CreditAmount > 0
  // (see CINC sign convention notes in bank-reconciliation-sync.ts).
  const buckets = new Map<string, VendorBucket>()
  for (const tx of txs) {
    if (tx.GLTransID != null && excludeGlTransIds.has(tx.GLTransID)) continue
    const credit = typeof tx.CreditAmount === 'number' ? tx.CreditAmount : 0
    if (credit <= 0) continue
    if (!tx.TransactionDate || !tx.Description) continue

    const key  = vendorKey(tx.Description)
    if (!key) continue

    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { key, displayNames: new Map(), amountsByMonth: new Map() }
      buckets.set(key, bucket)
    }

    // Track display name candidates.
    const cleaned = tx.Description.trim().replace(/\s+/g, ' ')
    bucket.displayNames.set(cleaned, (bucket.displayNames.get(cleaned) ?? 0) + 1)

    const month = monthOf(tx.TransactionDate)
    if (!bucket.amountsByMonth.has(month)) bucket.amountsByMonth.set(month, [])
    bucket.amountsByMonth.get(month)!.push(credit)
  }

  // Filter to recurring vendors and compute summary stats.
  const thisMonth   = currentMonth()
  const result: RecurringVendor[] = []
  for (const bucket of buckets.values()) {
    const monthsSeen = bucket.amountsByMonth.size
    if (monthsSeen < MIN_MONTHS_FOR_RECURRING) continue

    // Average amount across all occurrences; only count those within
    // tolerance of the median, to suppress one-off spikes.
    const allAmounts = Array.from(bucket.amountsByMonth.values()).flat().sort((a, b) => a - b)
    const median     = allAmounts[Math.floor(allAmounts.length / 2)]
    const inRange    = allAmounts.filter(a => Math.abs(a - median) / median <= AMOUNT_TOLERANCE)
    const avgAmount  = inRange.reduce((s, x) => s + x, 0) / inRange.length

    // Pick the most-frequent display name; ties broken by first seen.
    let bestName = ''
    let bestCount = 0
    for (const [name, count] of bucket.displayNames) {
      if (count > bestCount) { bestName = name; bestCount = count }
    }

    const sortedMonths   = Array.from(bucket.amountsByMonth.keys()).sort()
    const lastSeenMonth  = sortedMonths[sortedMonths.length - 1]
    const pendingThisMonth = !bucket.amountsByMonth.has(thisMonth)

    result.push({
      key:               bucket.key,
      displayName:       bestName,
      avgAmount,
      monthsSeen,
      lastSeenMonth,
      pendingThisMonth,
    })
  }

  // Sort descending by avgAmount so the biggest projected hits are
  // surfaced first in the UI.
  result.sort((a, b) => b.avgAmount - a.avgAmount)
  return result
}

// ── Public API ──────────────────────────────────────────────────────

/** Forecast EOM balance for one (assoc, bank account) pair. Combines
 *  current balance, MAIA-known approved-unpaid invoices, and recurring
 *  outflow projections. Caveats document the known gaps. */
export async function forecastEndOfMonthBalance(opts: {
  assocCode:      string
  bankAccountId:  number
  /** Optional: amount Karen is about to push. The UI computes a
   *  "before/after this push" comparison by calling the forecast
   *  twice and adding/subtracting the amount client-side. We don't
   *  apply it here so the function stays pure. */
  excludeGlTransIds?: number[]
}): Promise<ForecastResult> {
  const caveats: string[] = []

  // ── Bank account ─────────────────────────────────────────────────
  const banks = await listAssociationBankAccounts(opts.assocCode)
  const bank  = banks.find(b => b.id === opts.bankAccountId)
  if (!bank) {
    return {
      associationCode:        opts.assocCode.toUpperCase(),
      bankAccountId:          opts.bankAccountId,
      bankAccountDescription: `Unknown account ${opts.bankAccountId}`,
      currentBalance:         0,
      approvedUnpaid:         0,
      recurringProjected:     0,
      projectedEomBalance:    0,
      willOverdraw:           false,
      approvedUnpaidItems:    [],
      recurringVendors:       [],
      caveats:                ['Bank account not found for this association.'],
    }
  }

  const currentBalance = bank.cincBalance ?? bank.bankBalance ?? 0
  if (bank.cincBalance == null && bank.bankBalance != null) {
    caveats.push('Using bank-reported balance — CINC reconciled balance unavailable.')
  }

  // ── Approved unpaid (MAIA-pushed invoices only) ─────────────────
  // /openInvoices doesn't expose bank account, so we filter to invoices
  // we ourselves pushed (where we know pay_from_bank_account_id).
  const { data: pendingDrafts } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('cinc_invoice_id, extracted_invoice_number, matched_vendor_name, extracted_amount, extracted_invoice_date')
    .eq('extracted_association_code', opts.assocCode.toUpperCase())
    .eq('status', 'pushed_to_cinc')
    .eq('pay_from_bank_account_id', opts.bankAccountId)

  const openInvoiceList = await listOpenInvoices({ assocCode: opts.assocCode }).catch(() => [])
  const openByNumber    = new Map<string, number>()
  for (const oi of openInvoiceList) {
    if (oi.InvoiceNumber && typeof oi.Balance === 'number') {
      openByNumber.set(oi.InvoiceNumber.trim().toLowerCase(), oi.Balance)
    }
  }

  const approvedUnpaidItems: ApprovedUnpaidLineItem[] = []
  for (const d of (pendingDrafts ?? [])) {
    const draft = d as { extracted_invoice_number: string | null; matched_vendor_name: string | null; extracted_amount: number | null; extracted_invoice_date: string | null }
    const invNumKey = (draft.extracted_invoice_number ?? '').trim().toLowerCase()
    const remaining = openByNumber.get(invNumKey) ?? draft.extracted_amount ?? 0
    if (remaining > 0) {
      approvedUnpaidItems.push({
        invoiceNumber: draft.extracted_invoice_number,
        vendorName:    draft.matched_vendor_name,
        amount:        remaining,
        dueDate:       draft.extracted_invoice_date,
      })
    }
  }
  const approvedUnpaid = approvedUnpaidItems.reduce((s, x) => s + x.amount, 0)

  if (openInvoiceList.length > approvedUnpaidItems.length) {
    caveats.push(`${openInvoiceList.length - approvedUnpaidItems.length} other open invoice(s) in CINC don't have a known bank account (entered outside MAIA) — they may also draw from this account but are not in this forecast.`)
  }

  // ── Recurring projection ────────────────────────────────────────
  let recurringVendors: RecurringVendor[] = []
  if (bank.cashGl) {
    const excludeIds = new Set(opts.excludeGlTransIds ?? [])
    try {
      recurringVendors = await detectRecurring(opts.assocCode, bank.cashGl, excludeIds)
    } catch (err) {
      caveats.push(`Recurring-vendor analysis failed: ${(err as Error).message}.`)
    }
  } else {
    caveats.push('No Cash GL on this bank account in CINC — recurring projection skipped.')
  }

  // Only project vendors that haven't been paid yet this month. Past
  // months and already-paid this month don't contribute.
  const recurringProjected = recurringVendors
    .filter(v => v.pendingThisMonth)
    .reduce((s, v) => s + v.avgAmount, 0)

  const projectedEomBalance = currentBalance - approvedUnpaid - recurringProjected

  return {
    associationCode:        opts.assocCode.toUpperCase(),
    bankAccountId:          opts.bankAccountId,
    bankAccountDescription: bank.description,
    currentBalance,
    approvedUnpaid,
    recurringProjected,
    projectedEomBalance,
    willOverdraw:           projectedEomBalance < 0,
    approvedUnpaidItems,
    recurringVendors,
    caveats,
  }
}
