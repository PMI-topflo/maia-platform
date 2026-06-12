// =====================================================================
// lib/bank-reconciliation-sync.ts
//
// Pulls CINC GL transactions for every bank account on an association
// and upserts rows into bank_reconciliation_entries. Replaces the
// earlier MAIA-only sync (which used /invoicePayments and missed all
// non-MAIA bank activity).
//
// HOW IT WORKS
//
//   1. For each bank account on the assoc (listAssociationBankAccounts),
//      we have its Cash GL number (e.g. "10-1000-00" for the operating
//      account). That's the GL that gets debited / credited every time
//      money moves in or out of the bank.
//   2. We call /accounting/glTransactionsByDateAndAssocCode filtered to
//      that Cash GL for the requested date range — gives us every bank
//      entry CINC has on file (assessments in, vendor payments out,
//      transfers, fees) regardless of who entered the invoice.
//   3. For each transaction, we look for a MAIA-pushed invoice whose
//      pay_from_bank_account_id + amount + date roughly match — when
//      found, we enrich the row with vendor / invoice# / GL line from
//      the draft. Otherwise we save the raw bank entry (Description
//      from CINC tells Isabela what it was).
//   4. Idempotent upsert keyed on cinc_gl_trans_id — repeated runs
//      update in place; notes & reconciled state are preserved.
//
// MATCHING WINDOW
//
// We accept a ±7 day window between the gl trans date and the MAIA
// draft's invoice date when matching. CINC's payment date is often
// the close-of-batch date, not the invoice's nominal due date, so
// a small window is necessary. Amount match is exact (to 2dp).
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  listAssociationBankAccounts,
  listGlTransactionsByDate,
  listOpenInvoices,
  listAssociationInvoices,
  CincApiError,
  type CincGlTransaction,
  type BankAccountOption,
} from '@/lib/integrations/cinc'

/** Pull the "Inv.#NNN" invoice number out of a CINC gl Description.
 *  CINC posts vendor payments as "Inv.#207814 - Roof Maintenance/Repairs"
 *  — the number lets us populate the Invoice # column and look the payee
 *  up against open invoices. Returns null when no invoice token present. */
function parseInvoiceNumber(description: string | null): string | null {
  if (!description) return null
  // CINC posts invoice references in two formats, both seen in the live
  // ledger: "Inv.#0823 - Plumbing" and "Invoice: 135". Accept both
  // (optional "oice", optional "." / "#" / ":" separators). Require the
  // captured token to contain a digit so plain words ("Invoice payment")
  // don't get mistaken for an invoice number.
  const m = description.match(/\bInv(?:oice)?\b\.?\s*[#:]?\s*([\w-]*\d[\w-]*)/i)
  return m ? m[1].trim() : null
}

export interface ReconSyncStats {
  associationCode:    string
  bankAccountsTried:  number
  transactionsSeen:   number
  entriesCreated:     number
  entriesUpdated:     number
  draftMatches:       number
  errors:             Array<{
    bankAccountId?:          number
    bankAccountDescription?: string   // human label so the UI can show "Popular - Loan Proceeds - 2908" instead of "id=184"
    cashGl?:                 string
    message:                 string
  }>
}

interface DraftRow {
  id:                          number
  cinc_invoice_id:             string | null
  matched_vendor_name:         string | null
  matched_vendor_short_name:   string | null
  extracted_invoice_number:    string | null
  extracted_amount:            number | null
  extracted_invoice_date:      string | null
  pay_from_bank_account_id:    number | null
  pay_by_type:                 string | null
  gl_account_name:             string | null
  drive_file_id:               string | null
}

/** Default lookback for the cron sweep — 60 days covers the current
 *  month plus the previous so both Isabela's "current month" and "last
 *  month close" views stay fresh. Manual Sync calls can override. */
const DEFAULT_LOOKBACK_DAYS = 60

function daysAgoISO(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Infer a paid_type from the CINC Description field. CINC doesn't
 *  expose payment method on glTransactions, but the description usually
 *  carries enough of a hint that we can pre-fill Karen's spreadsheet
 *  with a reasonable guess. She can override inline on the page.
 *
 *  Common real-world descriptions observed against LFA / KGA / DELA:
 *    Inflows :  "Deposit from batch 17700", "Interest", "Funds Transfer",
 *               "Laundry Income Truist Checking - 7932"
 *    Outflows:  "Misc. Check", "Inv.#RVP-3954 - April Management Fees",
 *               "CSB - Cash Operating - 1956 Inv # 010226-032426",
 *               "AUTO DEBIT", "ACH"
 */
function inferPaidType(description: string | null, isOutflow: boolean): string | null {
  if (!description) return null
  const d = description.toLowerCase()
  if (isOutflow) {
    if (/\bcheck\b/.test(d))            return 'Check'
    if (/\bauto[\s-]*debit\b/.test(d))  return 'Auto-debit'
    if (/\bach\b/.test(d))              return 'ACH'
    if (/\bonline\b/.test(d))           return 'Online'
    if (/\bfunds?\s+transfer/.test(d))  return 'Funds Transfer'
    if (/^inv\.?\s*#/.test(d))          return 'ACH'  // invoice payments default to ACH
    return null
  }
  // Inflows
  if (/\binterest\b/.test(d))           return 'Bank Interest'
  if (/^deposit\s+from\s+batch/.test(d)) return 'Bank Deposit'
  if (/\bfunds?\s+transfer/.test(d))    return 'Funds Transfer'
  if (/income/.test(d))                 return 'Bank Deposit'
  return null
}

/** Infer a vendor/payee label from CINC's Description field.
 *
 *  CINC's glTransactions endpoint exposes Description but NOT a
 *  separate Vendor field. Earlier versions copied Description into
 *  both the vendor_payee and description columns — Karen saw the
 *  same text twice (e.g. "Deposit from batch 17945" / "Deposit from
 *  batch 17945"). The Description column already shows the full text;
 *  vendor_payee should be the actor: who paid us, who we paid, or
 *  what kind of bank-side event this is.
 *
 *  Rules — first match wins:
 *    "Deposit from batch NNN"        → "Bank deposit"
 *    "Funds Transfer"                → "Funds transfer"
 *    "Interest"                      → "Bank interest"
 *    "<text> (<VendorName> Inv.#X)"  → "<VendorName>"    (vendor in parens)
 *    "Misc. Check"                   → null              (Karen will fill)
 *    "<BANK> - Cash Operating - NNN" → null              (bank-internal)
 *    anything else                   → null              (let Karen fill)
 *
 *  When this returns null, vendor_payee stays empty and the operator
 *  has the full Description visible in its own column to fill in by
 *  hand. That's strictly better than the duplicate-text bug.
 */
function inferVendorPayee(description: string | null, isOutflow: boolean): string | null {
  if (!description) return null
  const d = description.trim()
  if (!d) return null
  const lower = d.toLowerCase()

  // Inflows — bank-side events first.
  if (!isOutflow) {
    if (/^deposit\s+from\s+batch/i.test(d)) return 'Bank deposit'
    if (/\binterest\b/i.test(lower))        return 'Bank interest'
    if (/^funds?\s+transfer/i.test(d))      return 'Funds transfer'
    if (/laundry|coin|vending/i.test(lower)) return 'Onsite income'
    return null
  }

  // Outflows.
  // "Funds Transfer" — bank-internal sweep, not a vendor.
  if (/^funds?\s+transfer/i.test(d)) return 'Funds transfer'

  // Bank-account name as the entire description ("SSB - Cash
  // Operating - 1019") — this is a bank-internal posting like a
  // sweep or fee, not a vendor payment.
  if (/^[A-Z]{2,6}\s*-\s*Cash\s+(Operating|Reserve|Special)/i.test(d)) return null

  // Vendor name embedded in parens, with or without a trailing
  // "Inv.#NNN". Example seen on DELA 5/5:
  //   "Inv.#RVP-4031 - Alternative Pymt. Method (Waste Connections Inv.#3696218W440)"
  // → vendor_payee = "Waste Connections"
  const paren = d.match(/\(([^)]+?)(?:\s+Inv\.?\s*#[\w-]+)?\)/)
  if (paren) {
    const inside = paren[1].trim()
    // Reject parenthetical fragments that are clearly NOT a vendor name —
    // otherwise the column just echoes a slice of the description. Seen in
    // the wild: "(Unit 3549)", "(April Truist Bank Statements)",
    // "(May 2026 Service)". Keep real company names like "(Waste Connections)".
    if (
      inside.length >= 3
      && !/^\d/.test(inside)
      && !/^\$/.test(inside)
      && /[A-Z]/.test(inside)
      && !/^\d+%\s*pymt/i.test(inside)
      && !/\bunit\b/i.test(inside)            // "Unit 3549" → a unit, not a vendor
      && !/statement/i.test(inside)           // "...Bank Statements" → a fee descriptor
      && !/\bmaintenance\b|\brepairs?\b/i.test(inside)  // service descriptors, not names
    ) {
      return inside
    }
  }

  // Generic check / ACH payments where CINC didn't name the payee.
  if (/^misc\.?\s*check\b/i.test(d)) return null
  if (/^auto[\s-]*debit\b/i.test(d)) return null

  // Account-based descriptions ("Acct.#6440084222 - June 2026 Waste
  // Service (37.313% Pymt.)") — extract the service name as a hint
  // when the parenthetical didn't yield a vendor.
  const acctService = d.match(/^acct\.?#\S+\s*[-–]\s*(?:[A-Z][a-z]+\s+\d{4}\s+)?([A-Z][A-Za-z &]+?(?:\s+Service)?)\s*(?:\(|$)/)
  if (acctService && acctService[1].length >= 4) {
    return acctService[1].trim()
  }

  // Nothing reliable to extract — leave vendor_payee blank.
  return null
}

/** Sync ALL bank activity for an association from CINC. Optionally
 *  narrow to a (fromDate, toDate) window — defaults to the past 60
 *  days, which covers Isabela's typical month-end + current-month
 *  reconciliation window. Idempotent. */
export async function syncReconciliationForAssoc(
  associationCode: string,
  opts?: { fromDate?: string; toDate?: string },
): Promise<ReconSyncStats> {
  const stats: ReconSyncStats = {
    associationCode:    associationCode.toUpperCase(),
    bankAccountsTried:  0,
    transactionsSeen:   0,
    entriesCreated:     0,
    entriesUpdated:     0,
    draftMatches:       0,
    errors:             [],
  }

  const fromDate = opts?.fromDate ?? daysAgoISO(DEFAULT_LOOKBACK_DAYS)
  const toDate   = opts?.toDate   ?? todayISO()

  // ── Bank accounts ──────────────────────────────────────────────────
  let banks: BankAccountOption[] = []
  try {
    banks = await listAssociationBankAccounts(associationCode)
  } catch (err) {
    stats.errors.push({ message: `bank-accounts fetch failed: ${(err as Error).message}` })
    return stats
  }

  // Only banks whose Cash GL is populated are syncable — without it we
  // can't tell glTransactions which account to filter on.
  const syncable = banks.filter(b => b.cashGl)
  if (syncable.length === 0) {
    return stats
  }

  // ── MAIA drafts (for enrichment) ───────────────────────────────────
  // Pull every pushed-to-CINC draft for this assoc upfront — we'll
  // match against them in-memory. Faster than per-transaction round
  // trips to Supabase.
  const { data: draftsRaw } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('id, cinc_invoice_id, matched_vendor_name, matched_vendor_short_name, extracted_invoice_number, extracted_amount, extracted_invoice_date, pay_from_bank_account_id, pay_by_type, gl_account_name, drive_file_id')
    .eq('extracted_association_code', associationCode.toUpperCase())
    .eq('status', 'pushed_to_cinc')
  const drafts = (draftsRaw ?? []) as DraftRow[]

  // ── Open-invoice payee map (for vendor_payee enrichment) ───────────
  // CINC's bank transactions carry no vendor — only a free-text
  // Description with an "Inv.#NNN" token. listOpenInvoices DOES expose
  // InvoicePayTo (the vendor) alongside InvoiceNumber, so for any ledger
  // row whose invoice is still open/ready-for-payment we can show the
  // real vendor name. (Fully-paid-and-closed invoices aren't in this
  // list, so those rows fall back to the description heuristic — the
  // vendor isn't reachable from the bank transaction alone.) One call
  // per assoc per sync.
  const payeeByInvoiceNum = new Map<string, string>()
  try {
    for (const oi of await listOpenInvoices({ assocCode: associationCode })) {
      const num = (oi.InvoiceNumber ?? '').trim()
      const payTo = (oi.InvoicePayTo ?? '').trim()
      if (num && payTo) payeeByInvoiceNum.set(num.toLowerCase(), payTo)
    }
  } catch { /* non-fatal — enrichment only */ }

  // PAID/closed invoices aren't in listOpenInvoices, so their vendor was lost
  // (e.g. "Inv.#15101 - Meeting Expense" showed no vendor). listAssociationInvoices
  // enumerates ALL invoices in the window — paid too — each carrying the Vendor
  // name, so we can fill the gap. One call per assoc per sync.
  const vendorByInvoiceNum = new Map<string, string>()
  try {
    for (const inv of await listAssociationInvoices({ assocCode: associationCode, fromDate, toDate })) {
      const num = (inv.InvoiceNumber ?? '').trim()
      const ven = (inv.Vendor ?? '').trim()
      if (num && ven && !vendorByInvoiceNum.has(num.toLowerCase())) vendorByInvoiceNum.set(num.toLowerCase(), ven)
    }
  } catch { /* non-fatal — enrichment only */ }

  // ── Per-bank sync ──────────────────────────────────────────────────
  for (const bank of syncable) {
    stats.bankAccountsTried++
    let txs: CincGlTransaction[] = []
    try {
      txs = await listGlTransactionsByDate({
        assocCode:     associationCode,
        fromDate,
        toDate,
        accountNumber: bank.cashGl as string,
      })
    } catch (err) {
      const message = err instanceof CincApiError ? err.message : (err as Error).message
      stats.errors.push({
        bankAccountId:          bank.id,
        bankAccountDescription: bank.description,
        cashGl:                 bank.cashGl ?? undefined,
        message,
      })
      continue
    }
    stats.transactionsSeen += txs.length

    for (const tx of txs) {
      if (tx.GLTransID == null || tx.TransactionDate == null) continue
      // CINC sign convention (verified empirically against LFA + KGA):
      //   CreditAmount > 0  → outflow (vendor payment, fee, transfer out)
      //   DebitAmount  < 0  → inflow  (deposit / assessment income, interest, transfer in)
      // The "0.00 if account is being …" claim from Swagger is correct.
      // So a signed bank-statement amount (positive=in, negative=out)
      // is just -(credit + debit) — one of the two is 0, the surviving
      // term inverts to the desired sign.
      const credit = typeof tx.CreditAmount === 'number' ? tx.CreditAmount : 0
      const debit  = typeof tx.DebitAmount  === 'number' ? tx.DebitAmount  : 0
      if (credit === 0 && debit === 0) continue

      const amount         = -(credit + debit)
      const effectiveDate  = tx.TransactionDate.slice(0, 10)
      const isOutflow      = credit > 0

      // Try to match an outflow to a MAIA-pushed draft for richer data.
      // Requirements: same bank account, exact amount match (against
      // the draft's amount, sign-flipped), and invoice date within ±7
      // days of the transaction date.
      let matchedDraft: DraftRow | null = null
      if (isOutflow) {
        const txTime = new Date(effectiveDate).getTime()
        for (const d of drafts) {
          if (d.pay_from_bank_account_id !== bank.id) continue
          if (d.extracted_amount == null) continue
          if (Math.abs(d.extracted_amount - credit) > 0.005) continue  // exact to 2dp
          const draftDateStr = d.extracted_invoice_date
          if (!draftDateStr) continue
          const dayGap = Math.abs((new Date(draftDateStr).getTime() - txTime) / 86_400_000)
          if (dayGap <= 7) {
            matchedDraft = d
            break
          }
        }
      }
      if (matchedDraft) stats.draftMatches++

      const parsedInvNum = parseInvoiceNumber(tx.Description ?? null)

      // Build the row. Structural fields are sourced from CINC + the
      // matched draft (if any). Notes/reconciled state are not touched
      // on update — only ever set on initial insert.
      const baseRow = {
        association_code:           associationCode.toUpperCase(),
        bank_account_id:            bank.id,
        bank_account_description:   bank.description,
        source:                     'cinc' as const,
        cinc_gl_trans_id:           tx.GLTransID,
        cinc_invoice_id:            matchedDraft?.cinc_invoice_id ? parseInt(matchedDraft.cinc_invoice_id, 10) : null,
        cinc_payment_id:            null as string | null,
        effective_date:             effectiveDate,
        customer:                   associationCode.toUpperCase(),
        // When a MAIA draft matched, we already KNOW the vendor —
        // use the matched vendor name (or its short alias). Otherwise
        // try to derive a meaningful vendor label from the CINC
        // Description, falling back to null when nothing reliable is
        // there.
        //
        // Description column is the raw CINC text (matched OR not).
        // We used to prefer the matched draft's gl_account_name here,
        // but it made the column lose the CINC posting text (Inv.#,
        // batch ID, etc.) that Karen also needs for reconciliation.
        // Keeping the raw description means the vendor_payee column
        // now shows the WHO and the description column shows the
        // WHAT — two distinct signals instead of duplicates.
        // Vendor priority: MAIA-matched draft (we KNOW it) → open-invoice
        // payee map (real CINC vendor for still-open invoices) → the
        // description heuristic → null. Never echoes the description.
        vendor_payee:               matchedDraft?.matched_vendor_name
                                      ?? matchedDraft?.matched_vendor_short_name
                                      ?? (parsedInvNum ? (payeeByInvoiceNum.get(parsedInvNum.toLowerCase()) ?? vendorByInvoiceNum.get(parsedInvNum.toLowerCase()) ?? null) : null)
                                      ?? inferVendorPayee(tx.Description ?? null, isOutflow),
        description:                ((tx.Description ?? '').trim() || matchedDraft?.gl_account_name || null),
        // Populate the Invoice # column for CINC-native rows too, parsed
        // from the "Inv.#NNN" token in the description.
        invoice_number:             matchedDraft?.extracted_invoice_number ?? parsedInvNum ?? null,
        amount,
        paid_type:                  matchedDraft?.pay_by_type ?? inferPaidType(tx.Description ?? null, isOutflow),
        invoice_attached_url:       matchedDraft?.drive_file_id
                                      ? `https://drive.google.com/file/d/${matchedDraft.drive_file_id}/view`
                                      : null,
        updated_at:                 new Date().toISOString(),
      }

      // Dedupe / upsert on cinc_gl_trans_id.
      const { data: existing } = await supabaseAdmin
        .from('bank_reconciliation_entries')
        .select('id')
        .eq('cinc_gl_trans_id', tx.GLTransID)
        .maybeSingle()

      if (existing) {
        await supabaseAdmin
          .from('bank_reconciliation_entries')
          .update(baseRow)
          .eq('id', existing.id)
        stats.entriesUpdated++
      } else {
        await supabaseAdmin
          .from('bank_reconciliation_entries')
          .insert({ ...baseRow, entered_by: 'maia-cron' })
        stats.entriesCreated++
      }
    }
  }

  // ── Auto-clear manual future payments whose real payment has posted ──
  // When a CINC outflow lands that matches a pending scheduled_payment
  // (same assoc, exact amount, on/after its due month), mark it paid and
  // link the transaction — so manual entries drop off the Upcoming list
  // on their own instead of staff deleting them by hand. Conservative:
  // exact-amount match, one transaction per payment.
  try {
    const { data: pendings } = await supabaseAdmin
      .from('scheduled_payments')
      .select('id, amount, due_month')
      .eq('association_code', associationCode.toUpperCase())
      .eq('status', 'pending')
      .is('matched_gl_trans_id', null)
    if (pendings && pendings.length) {
      const { data: outflows } = await supabaseAdmin
        .from('bank_reconciliation_entries')
        .select('cinc_gl_trans_id, amount, effective_date')
        .eq('association_code', associationCode.toUpperCase())
        .lt('amount', 0)
        .not('cinc_gl_trans_id', 'is', null)
      const used = new Set<number>()
      for (const p of pendings) {
        const match = (outflows ?? []).find(o =>
          o.cinc_gl_trans_id != null && !used.has(o.cinc_gl_trans_id)
          && Math.abs(Math.abs(o.amount) - Number(p.amount)) < 0.005
          && String(o.effective_date).slice(0, 7) >= p.due_month)
        if (match) {
          used.add(match.cinc_gl_trans_id)
          await supabaseAdmin.from('scheduled_payments')
            .update({ status: 'paid', paid_date: match.effective_date, matched_gl_trans_id: match.cinc_gl_trans_id })
            .eq('id', p.id)
        }
      }
    }
  } catch { /* auto-clear is best-effort */ }

  return stats
}
