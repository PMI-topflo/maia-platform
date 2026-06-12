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
  /** Every YYYY-MM in the lookback window this group was seen (paid) in.
   *  Lets the Upcoming feed decide, for ANY viewed month, whether this
   *  recurring payment has already happened that month. */
  seenMonths:        string[]
  /** Typical day-of-month the payment lands on (median of observed days,
   *  1–28 clamped). Used to place the estimate on a real date in the month
   *  it's projected into, instead of a vague "~ this month". */
  typicalDay:        number
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
  days:          number[]                // day-of-month of each occurrence
}

function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7)
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Add `n` days to a YYYY-MM-DD. */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return isoDate(d)
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
      bucket = { key, displayNames: new Map(), amountsByMonth: new Map(), days: [] }
      buckets.set(key, bucket)
    }

    // Track display name candidates.
    bucket.displayNames.set(desc, (bucket.displayNames.get(desc) ?? 0) + 1)

    const month = monthOf(tx.TransactionDate)
    if (!bucket.amountsByMonth.has(month)) bucket.amountsByMonth.set(month, [])
    bucket.amountsByMonth.get(month)!.push(credit)
    const day = parseInt(tx.TransactionDate.slice(8, 10), 10)
    if (Number.isFinite(day)) bucket.days.push(day)
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

    // Median day-of-month, clamped to 1–28 so projecting into any month
    // (incl. February) always lands on a real date.
    const sortedDays = [...bucket.days].sort((a, b) => a - b)
    const medDay     = sortedDays.length ? sortedDays[Math.floor(sortedDays.length / 2)] : 1
    const typicalDay = Math.min(28, Math.max(1, medDay))

    result.push({
      key:               bucket.key,
      displayName:       bestName,
      avgAmount,
      monthsSeen,
      lastSeenMonth,
      pendingThisMonth,
      seenMonths:        sortedMonths,
      typicalDay,
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

  const currentBalance = bank.bankBalance ?? bank.cincBalance ?? 0
  if (bank.bankBalance == null && bank.cincBalance != null) {
    caveats.push('Using CINC book balance — bank-reported balance unavailable from CINC.')
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
  /** Learned assessment-collection behaviour (monthly vs quarterly + amount). */
  incomeProfile:          IncomeProfile
  /** Lowest projected balance over the horizon + the date it occurs — the
   *  end-of-month / end-of-quarter cash crunch. */
  lowPoint:               { date: string; balance: number }
  /** Weekly end-of-week balance series (~3 months) for the cash-flow strip,
   *  each with what's due / what lands that week. */
  weekly:                 Array<{ weekStart: string; balance: number; due: number; income: number }>
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

// ── Income behaviour (assessment receivables) ───────────────────────
// The end-of-month / end-of-quarter cash crunch comes from TIMING: bills are
// due before the assessment deposit lands. To model it we learn each
// association's collection BEHAVIOUR from the last `lookback` months of cash
// deposits — how much comes in, how often (monthly vs quarterly), and around
// which day — then project those inflows onto the forecast timeline.

export interface IncomeProfile {
  cadence:          'monthly' | 'quarterly' | 'irregular'
  /** Typical $ collected per assessment landing. */
  avgPeriodIncome:  number
  /** Day-of-month the deposit typically lands (median, 1–28). */
  typicalDay:       number
  monthsSampled:    number
  incomeMonthsSeen: number
  lastIncomeMonth:  string | null
  note:             string
}

/** Add `n` months to a YYYY-MM. */
function addMonthsYm(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  return ymKey(new Date(Date.UTC(y, m - 1 + n, 1)))
}

/** A YYYY-MM-DD on `ym` at `day`, clamped to the month's last day. */
function dayInMonth(ym: string, day: number): string {
  const target = `${ym}-${String(Math.max(1, day)).padStart(2, '0')}`
  const eom = endOfMonthISO(ym)
  return target > eom ? eom : target
}

/** Learn the assessment-income behaviour from cash-GL deposits. Deposits post
 *  as NEGATIVE DebitAmount (CINC convention, verified live). */
async function detectIncomeProfile(assocCode: string, cashGl: string | null | undefined, lookback = 6): Promise<IncomeProfile> {
  const empty: IncomeProfile = { cadence: 'irregular', avgPeriodIncome: 0, typicalDay: 1, monthsSampled: 0, incomeMonthsSeen: 0, lastIncomeMonth: null, note: 'Income behaviour unknown.' }
  if (!cashGl) return { ...empty, note: 'No cash GL — income behaviour unknown.' }

  const now  = new Date()
  const to   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 86400000)        // last day of prev month
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - (lookback - 1), 1))
  let txs: CincGlTransaction[] = []
  try { txs = await listGlTransactionsByDate({ assocCode, fromDate: isoDate(from), toDate: isoDate(to), accountNumber: cashGl }) } catch { return empty }

  const incomeByMonth = new Map<string, number>()
  const days: number[] = []
  const monthsTouched = new Set<string>()
  for (const tx of txs) {
    if (!tx.TransactionDate) continue
    monthsTouched.add(monthOf(tx.TransactionDate))
    const d = typeof tx.DebitAmount === 'number' ? tx.DebitAmount : 0
    if (d >= 0) continue                                   // only deposits (money IN)
    const m = monthOf(tx.TransactionDate)
    incomeByMonth.set(m, (incomeByMonth.get(m) ?? 0) + Math.abs(d))
    const day = parseInt(tx.TransactionDate.slice(8, 10), 10)
    if (Number.isFinite(day)) days.push(day)
  }
  const monthsSampled = monthsTouched.size
  if (incomeByMonth.size === 0) return { ...empty, monthsSampled, note: 'No deposits seen in the last 6 months.' }

  // "Income months" = months whose deposits are a meaningful share of the
  // biggest month (filters out tiny incidental credits). The COUNT of these
  // tells monthly vs quarterly apart.
  const maxIncome    = Math.max(...incomeByMonth.values())
  const incomeMonths = [...incomeByMonth.entries()].filter(([, v]) => v >= maxIncome * 0.25).map(([m]) => m).sort()
  const incomeMonthsSeen = incomeMonths.length
  const avgPeriodIncome  = incomeMonths.reduce((s, m) => s + incomeByMonth.get(m)!, 0) / incomeMonthsSeen
  const sortedDays = [...days].sort((a, b) => a - b)
  const typicalDay = Math.min(28, Math.max(1, sortedDays[Math.floor(sortedDays.length / 2)] || 1))
  const lastIncomeMonth = incomeMonths[incomeMonths.length - 1]

  let cadence: IncomeProfile['cadence']
  if (incomeMonthsSeen >= lookback - 1)                       cadence = 'monthly'
  else if (incomeMonthsSeen >= 1 && incomeMonthsSeen <= Math.ceil(lookback / 3) + 1) cadence = 'quarterly'
  else                                                        cadence = 'irregular'

  const note = cadence === 'monthly'
    ? `Monthly assessments ≈ $${Math.round(avgPeriodIncome).toLocaleString()} around day ${typicalDay}.`
    : cadence === 'quarterly'
      ? `Quarterly assessments ≈ $${Math.round(avgPeriodIncome).toLocaleString()} (last landed ${lastIncomeMonth}).`
      : `Irregular deposits — income timing uncertain; using average net flow instead.`
  return { cadence, avgPeriodIncome, typicalDay, monthsSampled, incomeMonthsSeen, lastIncomeMonth, note }
}

/** Project expected assessment deposits as dated events between `afterISO`
 *  (exclusive) and the end of `toYm` (inclusive), from a learned profile. */
function projectIncomeEvents(profile: IncomeProfile, afterISO: string, toYm: string): Array<{ date: string; amount: number }> {
  if (profile.avgPeriodIncome <= 0 || profile.cadence === 'irregular') return []
  const out: Array<{ date: string; amount: number }> = []
  const fromYm = afterISO.slice(0, 7)
  const step   = profile.cadence === 'monthly' ? 1 : 3
  // For quarterly, walk the 3-month cadence from the last landing; for monthly,
  // start at the current month.
  let ym = profile.cadence === 'quarterly' && profile.lastIncomeMonth
    ? addMonthsYm(profile.lastIncomeMonth, step)
    : fromYm
  // Fast-forward to the horizon window.
  while (monthsBetween(ym, fromYm) > 0) ym = addMonthsYm(ym, step)
  let guard = 0
  while (monthsBetween(ym, toYm) >= 0 && guard++ < 60) {
    const date = dayInMonth(ym, profile.typicalDay)
    if (date > afterISO) out.push({ date, amount: profile.avgPeriodIncome })
    ym = addMonthsYm(ym, step)
  }
  return out
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

  const currentBalance = bank ? (bank.bankBalance ?? bank.cincBalance ?? 0) : 0
  if (bank && bank.bankBalance == null && bank.cincBalance != null) {
    caveats.push('Using CINC book balance — bank-reported balance unavailable from CINC.')
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
  const balanceOf = (o: typeof allOpen[number]) => typeof o.Balance === 'number' ? o.Balance : (typeof o.InvoiceAmount === 'number' ? o.InvoiceAmount : 0)
  const open = openInvoiceScope === 'due-by-scheduled'
    ? allOpen.filter(o => !o.DueDate || o.DueDate.slice(0, 10) <= schedCutoff)
    : allOpen

  // Typical monthly spend (outflow run-rate) + learned assessment behaviour.
  const flow = bank?.cashGl
    ? await averageMonthlyNetFlow(opts.assocCode, bank.cashGl, runRateMonths)
    : { avgNet: 0, avgIn: 0, avgOut: 0, sampled: 0 }
  const income = await detectIncomeProfile(opts.assocCode, bank?.cashGl)

  // ── Dated timeline ───────────────────────────────────────────────
  // Bills hit on their DUE date; assessments land on the learned cadence.
  // Walking this (vs a flat monthly net) surfaces the end-of-month / end-of-
  // quarter DIP — the balance falls as bills clear, then recovers when the
  // assessment deposit lands.
  const todayISO = isoDate(new Date())
  const lastYm   = addMonthsYm(nowYm, horizonMonths - 1)
  type Ev = { date: string; delta: number; kind: 'bill' | 'income' | 'push' | 'recurring' }
  const events: Ev[] = []

  // Known open invoices, on their due date (past-due / undated → today).
  for (const o of open) {
    const dd = o.DueDate ? o.DueDate.slice(0, 10) : todayISO
    events.push({ date: dd < todayISO ? todayISO : dd, delta: -balanceOf(o), kind: 'bill' })
  }
  // This push.
  events.push({ date: (opts.scheduledDate || todayISO).slice(0, 10), delta: -push, kind: 'push' })
  // Expected assessment income on the learned cadence (receivables behaviour).
  for (const inc of projectIncomeEvents(income, todayISO, lastYm)) events.push({ date: inc.date, delta: +inc.amount, kind: 'income' })
  // Recurring spend NOT yet invoiced: top each future month's KNOWN bills up to
  // the typical monthly spend (so far months aren't under-counted), placed
  // mid-month. max() avoids double-counting bills already entered.
  if (flow.avgOut > 0) {
    for (let i = 0; i <= horizonMonths; i++) {
      const ym = addMonthsYm(nowYm, i)
      const lo = i === 0 ? todayISO : dayInMonth(ym, 1)
      const hi = endOfMonthISO(ym)
      const billed = open
        .filter(o => { const dd = o.DueDate ? o.DueDate.slice(0, 10) : todayISO; return dd >= lo && dd <= hi })
        .reduce((s, o) => s + balanceOf(o), 0)
      const shortfall = Math.max(0, flow.avgOut - billed)
      if (shortfall > 0) events.push({ date: dayInMonth(ym, 15), delta: -shortfall, kind: 'recurring' })
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date))

  // Weekly series for the cash-flow strip (~3 months). End-of-week balance plus
  // what's due / what lands that week, so each box can show its detail on hover.
  const STRIP_WEEKS = 14
  const weekly: Array<{ weekStart: string; balance: number; due: number; income: number }> = []
  {
    let wbal = currentBalance, wi = 0
    for (let w = 0; w < STRIP_WEEKS; w++) {
      const weekStart = addDays(todayISO, w * 7)
      const weekEnd   = addDays(weekStart, 6)
      let due = 0, income = 0
      while (wi < events.length && events[wi].date <= weekEnd) {
        wbal += events[wi].delta
        if (events[wi].delta < 0) due += -events[wi].delta; else income += events[wi].delta
        wi++
      }
      weekly.push({ weekStart, balance: Math.round(wbal), due: Math.round(due), income: Math.round(income) })
    }
  }

  // Walk it: snapshot each month-end balance, track the low point (the crunch).
  let bal = currentBalance
  let lowPoint = { date: todayISO, balance: currentBalance }
  const horizon: MonthProjection[] = []
  let ei = 0
  for (let i = 0; i < horizonMonths; i++) {
    const ym  = addMonthsYm(nowYm, i)
    const eom = endOfMonthISO(ym)
    while (ei < events.length && events[ei].date <= eom) {
      bal += events[ei].delta
      if (bal < lowPoint.balance) lowPoint = { date: events[ei].date, balance: bal }
      ei++
    }
    horizon.push({ month: ym, monthsAhead: i, projectedBalance: bal, affordableAfterPush: bal >= 0 })
  }

  const monthsAhead    = Math.max(0, monthsBetween(nowYm, scheduledMonth))
  const projectedAtScheduled = horizon.find(h => h.month === scheduledMonth)?.projectedBalance ?? bal
  const earliest = horizon.find(h => h.affordableAfterPush)?.month ?? null

  // Display totals (what's committed by the scheduled month) + caveats.
  const dueByScheduled    = open.filter(o => !o.DueDate || o.DueDate.slice(0, 10) <= schedCutoff)
  const openInvoicesTotal = dueByScheduled.reduce((s, o) => s + balanceOf(o), 0)
  caveats.push(income.note)
  if (flow.avgOut > 0) caveats.push(`Future months also assume ≈ $${Math.round(flow.avgOut).toLocaleString()}/mo typical recurring spend where bills aren't entered yet.`)
  if (Math.round(lowPoint.balance) < Math.round(projectedAtScheduled)) {
    caveats.push(`Cash dips to ${lowPoint.balance < 0 ? '−' : ''}$${Math.abs(Math.round(lowPoint.balance)).toLocaleString()} around ${lowPoint.date} before the next assessment lands.`)
  }

  return {
    associationCode:        opts.assocCode.toUpperCase(),
    bankAccountId:          opts.bankAccountId,
    bankAccountDescription: bank?.description ?? `Account ${opts.bankAccountId}`,
    currentBalance,
    openInvoicesTotal,
    openInvoicesCount:      dueByScheduled.length,
    avgMonthlyNet:          flow.avgNet,
    avgMonthlyIn:           flow.avgIn,
    avgMonthlyOut:          flow.avgOut,
    monthsSampled:          flow.sampled,
    incomeProfile:          income,
    lowPoint,
    weekly,
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
