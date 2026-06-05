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

// Internal money movements that post as cash-GL credits (outflows) but
// are NOT vendor bills, so they must not appear as "recurring vendor"
// estimates in Upcoming Payments. CINC books inter-account transfers with
// the COUNTERPART bank account's name as the description (e.g. GK7's
// operating ledger shows "CSB - Cash Operating - 1950", which is another
// association's cash account) — that leaked a foreign account into GK7's
// estimates. "Funds Transfer", sweeps, and wire/ACH transfers are the
// same class. Real vendor lines here are "Inv.#…" / "Acct.#… - <utility>",
// none of which contain these phrases, so this is a safe exclusion.
const INTERNAL_MOVEMENT_RE =
  /\b(funds?\s+transfer|cash\s+(operating|reserve|special)|transfer\s+(to|from|between|of)|inter[-\s]?account|wire\s+transfer|ach\s+transfer|sweep|opening\s+balance|beginning\s+balance)\b/i

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

/** Last calendar day of a YYYY-MM month, as YYYY-MM-DD. (Day 0 of the next
 *  month rolls back to the last day of this one.) */
function endOfMonthISO(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return isoDate(new Date(Date.UTC(y, m, 0)))
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

/** Is this GL account a cash/asset account (not an expense)? CINC numbers
 *  cash + assets in the 1x range (10- operating, 12- reserve, 13- special,
 *  etc.); expenses + liabilities are 5x/6x/7x/8x/9x. Used to tell a real
 *  expense debit apart from the other leg of an inter-account transfer. */
function isAssetAccount(accountNumber: string | null | undefined): boolean {
  return /^1\d?-/.test((accountNumber ?? '').trim())
}

/** Analyse the last `LOOKBACK_MONTHS` of glTransactions for one bank
 *  account and return the vendors meeting the recurring threshold.
 *
 *  Keyed off the EXPENSE-side description, not the cash-credit line's.
 *  CINC sometimes stamps a cash disbursement's credit line with the
 *  funding bank account's NAME instead of the payee — e.g. GK7's utility
 *  and insurance payments post a credit described "CSB - Cash Operating -
 *  1950" (that's Crystal Hills' bank account, the counterpart name), while
 *  the real payee lives on the paired expense debit ("Pol.#… Insurance",
 *  "Acct.#… Electricity"). Bucketing by the cash-credit description both
 *  leaked a foreign account into the estimates AND fragmented genuine
 *  recurring expenses. So: for each cash outflow whose own description is a
 *  bank-account/transfer label, recover the payee from the matching expense
 *  debit (same date, same amount, on a non-asset account). Genuine
 *  transfers (e.g. "Funds Transfer" — cash-to-cash, no expense leg) find no
 *  match and are dropped. */
async function detectRecurring(
  assocCode:        string,
  cashGl:           string,
  excludeGlTransIds: Set<number>,
): Promise<RecurringVendor[]> {
  const fromDate = startOfMonthMinusN(LOOKBACK_MONTHS)
  const toDate   = isoDate(new Date())
  // ALL accounts (no accountNumber) so we can see each cash credit's paired
  // expense debit, not just the cash line in isolation.
  const txs      = await listGlTransactionsByDate({ assocCode, fromDate, toDate })

  // Index expense debits by "YYYY-MM-DD|amount" so a mislabeled cash credit
  // can recover its real payee from the offsetting expense line. Amount is
  // rounded to cents to avoid float-equality misses.
  const amtKey = (date: string, amount: number) => `${date.slice(0, 10)}|${Math.round(Math.abs(amount) * 100)}`
  const expenseByAmtDate = new Map<string, string>()  // amtKey → expense description
  for (const tx of txs) {
    const debit = typeof tx.DebitAmount === 'number' ? Math.abs(tx.DebitAmount) : 0
    if (debit <= 0 || !tx.TransactionDate || !tx.Description) continue
    if (isAssetAccount(tx.AccountNumber)) continue   // skip the other leg of a transfer
    const k = amtKey(tx.TransactionDate, debit)
    if (!expenseByAmtDate.has(k)) expenseByAmtDate.set(k, tx.Description.trim().replace(/\s+/g, ' '))
  }

  // Bucket outflows by vendor key. Outflow = a credit on THIS bank's cash GL
  // (CINC sign convention: payments post as positive CreditAmount).
  const buckets = new Map<string, VendorBucket>()
  for (const tx of txs) {
    if (tx.AccountNumber !== cashGl) continue
    if (tx.GLTransID != null && excludeGlTransIds.has(tx.GLTransID)) continue
    const credit = typeof tx.CreditAmount === 'number' ? tx.CreditAmount : 0
    if (credit <= 0) continue
    if (!tx.TransactionDate || !tx.Description) continue

    // Resolve the real payee description. If the cash-credit line is a
    // bank-account/transfer label, look through to the paired expense debit.
    let desc = tx.Description.trim().replace(/\s+/g, ' ')
    if (INTERNAL_MOVEMENT_RE.test(desc)) {
      const recovered = expenseByAmtDate.get(amtKey(tx.TransactionDate, credit))
      if (!recovered) continue           // genuine transfer (no expense leg) — not a vendor
      desc = recovered
    }

    const key = vendorKey(desc)
    if (!key) continue

    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { key, displayNames: new Map(), amountsByMonth: new Map() }
      buckets.set(key, bucket)
    }

    // Track display name candidates.
    bucket.displayNames.set(desc, (bucket.displayNames.get(desc) ?? 0) + 1)

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

// =====================================================================
// Funds check for a SCHEDULED PAYMENT DATE.
//
// Answers "will <account> have enough on the day we plan to pay this
// invoice?" — projecting to the END OF THE SCHEDULED MONTH and counting
// ALL open invoices in CINC (not just MAIA-pushed ones). For months
// beyond the current one it applies the account's average monthly net
// flow (typical income minus typical outflow), so deferring to a later
// month is modelled realistically. Also returns a month-by-month
// horizon so the UI can suggest the earliest affordable month.
// =====================================================================

export interface MonthProjection { month: string; monthsAhead: number; projectedBalance: number; affordableAfterPush: boolean }

export type OpenInvoiceScope = 'all' | 'due-by-scheduled'

// Tunable funds-check knobs, centralised so the magic numbers live in one
// place instead of being scattered across the engine and the UI. Each is also
// overridable per call via forecastFundsForDate opts — a future per-assoc
// settings table can feed those overrides without touching this file.
export const FUNDS_CHECK_DEFAULTS = {
  /** Projected balance below which the check shows an amber "tight" warning
   *  even though the payment is technically affordable. */
  tightThreshold:   1000,
  /** Complete prior months that feed the run-rate (average net flow). */
  runRateMonths:    3,
  /** Months the affordability horizon spans. */
  horizonMonths:    6,
  /** Which open invoices count against the balance:
   *   'all'              – every open invoice for the assoc (most conservative)
   *   'due-by-scheduled' – only those due on/before the scheduled month. */
  openInvoiceScope: 'all' as OpenInvoiceScope,
}

export interface FundsCheckResult {
  associationCode:        string
  bankAccountId:          number
  bankAccountDescription: string
  currentBalance:         number
  /** Sum of Balance across ALL open invoices in CINC for this assoc. */
  openInvoicesTotal:      number
  openInvoicesCount:      number
  /** Average monthly net (income − outflow) from the last few complete
   *  months on this account's cash ledger. */
  avgMonthlyNet:          number
  avgMonthlyIn:           number
  avgMonthlyOut:          number
  monthsSampled:          number
  pushAmount:             number
  scheduledMonth:         string          // YYYY-MM the payment is scheduled in
  monthsAhead:            number
  projectedAtScheduled:   number          // balance after this push, end of scheduled month
  affordable:             boolean
  /** Affordable but the projected balance is under `tightThreshold`. */
  tight:                  boolean
  tightThreshold:         number
  /** Which open invoices were counted against the balance. */
  openInvoiceScope:       OpenInvoiceScope
  /** Earliest month (YYYY-MM) whose projection covers this push, or null
   *  if none within the horizon. */
  earliestAffordableMonth: string | null
  horizon:                MonthProjection[]
  caveats:                string[]
}

function ymKey(d: Date): string { return d.toISOString().slice(0, 7) }
function monthsBetween(fromYm: string, toYm: string): number {
  const [fy, fm] = fromYm.split('-').map(Number)
  const [ty, tm] = toYm.split('-').map(Number)
  return (ty * 12 + (tm - 1)) - (fy * 12 + (fm - 1))
}

/** Average monthly net cash flow over the last `months` COMPLETE calendar
 *  months on a cash account (excludes the current partial month). Net =
 *  deposits (DebitAmount) − payments (CreditAmount). */
async function averageMonthlyNetFlow(assocCode: string, cashGl: string, months = 3): Promise<{ avgNet: number; avgIn: number; avgOut: number; sampled: number }> {
  const now   = new Date()
  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const to    = new Date(firstOfThisMonth.getTime() - 86400000)               // last day of previous month
  const from  = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - (months - 1), 1))
  let txs: CincGlTransaction[] = []
  try {
    txs = await listGlTransactionsByDate({ assocCode, fromDate: isoDate(from), toDate: isoDate(to), accountNumber: cashGl })
  } catch { return { avgNet: 0, avgIn: 0, avgOut: 0, sampled: 0 } }

  // CINC sign convention on a cash account (verified live): deposits (money
  // IN) post as NEGATIVE DebitAmount (e.g. "Deposit from batch" D=−29,586);
  // payments (money OUT) post as POSITIVE CreditAmount. So inflow = |Debit|
  // and outflow = positive Credit.
  const byMonth = new Map<string, { in: number; out: number }>()
  for (const tx of txs) {
    if (!tx.TransactionDate) continue
    const m = monthOf(tx.TransactionDate)
    const b = byMonth.get(m) ?? { in: 0, out: 0 }
    b.in  += typeof tx.DebitAmount  === 'number' ? Math.abs(tx.DebitAmount)  : 0
    b.out += typeof tx.CreditAmount === 'number' ? Math.max(0, tx.CreditAmount) : 0
    byMonth.set(m, b)
  }
  const sampled = byMonth.size
  if (sampled === 0) return { avgNet: 0, avgIn: 0, avgOut: 0, sampled: 0 }
  let totIn = 0, totOut = 0
  for (const b of byMonth.values()) { totIn += b.in; totOut += b.out }
  const avgIn = totIn / sampled, avgOut = totOut / sampled
  return { avgNet: avgIn - avgOut, avgIn, avgOut, sampled }
}

export async function forecastFundsForDate(opts: {
  assocCode:        string
  bankAccountId:    number
  scheduledDate:    string   // YYYY-MM-DD
  pushAmount:       number
  runRateMonths?:   number
  horizonMonths?:   number
  openInvoiceScope?: OpenInvoiceScope
  tightThreshold?:  number
}): Promise<FundsCheckResult> {
  const runRateMonths    = opts.runRateMonths   ?? FUNDS_CHECK_DEFAULTS.runRateMonths
  const horizonMonths    = opts.horizonMonths   ?? FUNDS_CHECK_DEFAULTS.horizonMonths
  const openInvoiceScope = opts.openInvoiceScope ?? FUNDS_CHECK_DEFAULTS.openInvoiceScope
  const tightThreshold   = opts.tightThreshold  ?? FUNDS_CHECK_DEFAULTS.tightThreshold

  const caveats: string[] = []
  const banks = await listAssociationBankAccounts(opts.assocCode)
  const bank  = banks.find(b => b.id === opts.bankAccountId) ?? banks.find(b => b.kind === 'operating') ?? banks[0]

  const currentBalance = bank ? (bank.cincBalance ?? bank.bankBalance ?? 0) : 0
  if (bank && bank.cincBalance == null && bank.bankBalance != null) {
    caveats.push('Using bank-reported balance — CINC reconciled balance unavailable.')
  }

  const nowYm          = ymKey(new Date())
  const scheduledMonth = (opts.scheduledDate || nowYm).slice(0, 7)
  const push           = Math.abs(opts.pushAmount || 0)

  // Open invoices counted as committed near-term outflows. Scope decides
  // which ones: 'all' (every open invoice — most conservative) or
  // 'due-by-scheduled' (only those due on/before the end of the scheduled
  // month, so invoices not yet due don't deflate a near-term check).
  const allOpen = await listOpenInvoices({ assocCode: opts.assocCode }).catch(() => [])
  const schedCutoff = endOfMonthISO(scheduledMonth)   // YYYY-MM-DD, last day of scheduled month
  const open = openInvoiceScope === 'due-by-scheduled'
    ? allOpen.filter(o => !o.DueDate || o.DueDate.slice(0, 10) <= schedCutoff)
    : allOpen
  const openInvoicesTotal = open.reduce((s, o) => s + (typeof o.Balance === 'number' ? o.Balance : (typeof o.InvoiceAmount === 'number' ? o.InvoiceAmount : 0)), 0)
  if (open.length > 0) {
    caveats.push(openInvoiceScope === 'due-by-scheduled'
      ? `Counts the ${open.length} open invoice(s) due by ${monthOf(schedCutoff)} (of ${allOpen.length} total open) as near-term outflows.`
      : `Counts all ${open.length} open invoice(s) in CINC for this association as near-term outflows (some may draw from a different account).`)
  }

  const flow = bank?.cashGl
    ? await averageMonthlyNetFlow(opts.assocCode, bank.cashGl, runRateMonths)
    : { avgNet: 0, avgIn: 0, avgOut: 0, sampled: 0 }
  if (!bank?.cashGl) caveats.push('No Cash GL on this account — future-month run-rate skipped.')
  else if (flow.sampled === 0) caveats.push('No recent ledger history — future-month run-rate unavailable (showing current balance only).')
  else caveats.push(`Future months use this account's average net flow over ${flow.sampled} month(s): ${flow.avgNet >= 0 ? '+' : ''}${Math.round(flow.avgNet).toLocaleString()} / month.`)

  // Project the balance at end of a given month: current balance, less the
  // counted open invoices (this-month commitments) and this push, plus the
  // run-rate net flow for each FULL month beyond the current one.
  const project = (ym: string): number => {
    const ahead = Math.max(0, monthsBetween(nowYm, ym))
    return currentBalance - openInvoicesTotal - push + ahead * flow.avgNet
  }

  // Affordability horizon starting this month.
  const horizon: MonthProjection[] = []
  const base = new Date()
  for (let i = 0; i < horizonMonths; i++) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i, 1))
    const ym = ymKey(d)
    const projectedBalance = project(ym)
    horizon.push({ month: ym, monthsAhead: i, projectedBalance, affordableAfterPush: projectedBalance >= 0 })
  }

  const monthsAhead    = Math.max(0, monthsBetween(nowYm, scheduledMonth))
  const projectedAtScheduled = project(scheduledMonth)
  const earliest = horizon.find(h => h.affordableAfterPush)?.month ?? null

  return {
    associationCode:        opts.assocCode.toUpperCase(),
    bankAccountId:          opts.bankAccountId,
    bankAccountDescription: bank?.description ?? `Account ${opts.bankAccountId}`,
    currentBalance,
    openInvoicesTotal,
    openInvoicesCount:      open.length,
    avgMonthlyNet:          flow.avgNet,
    avgMonthlyIn:           flow.avgIn,
    avgMonthlyOut:          flow.avgOut,
    monthsSampled:          flow.sampled,
    pushAmount:             push,
    scheduledMonth,
    monthsAhead,
    projectedAtScheduled,
    affordable:             projectedAtScheduled >= 0,
    tight:                  projectedAtScheduled >= 0 && projectedAtScheduled < tightThreshold,
    tightThreshold,
    openInvoiceScope,
    earliestAffordableMonth: earliest,
    horizon,
    caveats,
  }
}
