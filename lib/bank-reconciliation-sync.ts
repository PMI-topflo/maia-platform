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
  CincApiError,
  type CincGlTransaction,
  type BankAccountOption,
} from '@/lib/integrations/cinc'

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
        vendor_payee:               matchedDraft?.matched_vendor_name
                                      ?? matchedDraft?.matched_vendor_short_name
                                      ?? (tx.Description ?? '').trim()
                                      ?? null,
        description:                matchedDraft?.gl_account_name
                                      ?? (tx.Description ?? '').trim()
                                      ?? null,
        invoice_number:             matchedDraft?.extracted_invoice_number ?? null,
        amount,
        paid_type:                  matchedDraft?.pay_by_type ?? null,
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

  return stats
}
