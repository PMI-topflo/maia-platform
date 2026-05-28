// =====================================================================
// lib/bank-reconciliation-sync.ts
//
// Pulls CINC payments for every MAIA-pushed invoice in a given
// association and upserts rows into bank_reconciliation_entries.
// Runs from /api/admin/reconciliation/sync (manual button on the
// page) and from a Vercel cron (hourly per association).
//
// Why this only covers MAIA-pushed invoices for now:
// CINC's /accounting/openInvoices does NOT expose the InvoiceID, and
// /invoicePayments requires it. So we can only pull payment data for
// invoices we already know the InvoiceID of — i.e. ones MAIA pushed
// (cinc_invoice_id stored on invoice_intake_drafts). Non-MAIA invoices
// (manually entered in CINC by someone else, or pre-MAIA history)
// remain Isabela's manual-entry territory until we wire glTransactions.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  listInvoicePayments,
  listAssociationBankAccounts,
  CincApiError,
  type CincInvoicePayment,
  type BankAccountOption,
} from '@/lib/integrations/cinc'

export interface ReconSyncStats {
  associationCode:    string
  invoicesChecked:    number
  paymentsFetched:    number
  entriesCreated:     number
  entriesUpdated:     number
  errors:             Array<{ invoiceId: number; message: string }>
}

interface DraftRow {
  id:                          number
  cinc_invoice_id:             string | null   // stored as text in CINC's column for historical reasons
  matched_vendor_name:         string | null
  matched_vendor_short_name:   string | null
  extracted_invoice_number:    string | null
  extracted_amount:            number | null
  extracted_association_code:  string | null
  pay_from_bank_account_id:    number | null
  pay_by_type:                 string | null
  gl_account_name:             string | null
  drive_file_id:               string | null
}

/** Sync CINC payments for every pushed-to-CINC draft in an association.
 *  Idempotent — re-runs don't duplicate rows because the upsert keys on
 *  (cinc_invoice_id, amount, effective_date). */
export async function syncReconciliationForAssoc(
  associationCode: string,
): Promise<ReconSyncStats> {
  const stats: ReconSyncStats = {
    associationCode:  associationCode.toUpperCase(),
    invoicesChecked:  0,
    paymentsFetched:  0,
    entriesCreated:   0,
    entriesUpdated:   0,
    errors:           [],
  }

  // Pull every MAIA-pushed draft for this assoc — these are the only
  // ones we know the cinc_invoice_id for.
  const { data: drafts, error } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('id, cinc_invoice_id, matched_vendor_name, matched_vendor_short_name, extracted_invoice_number, extracted_amount, extracted_association_code, pay_from_bank_account_id, pay_by_type, gl_account_name, drive_file_id')
    .eq('extracted_association_code', associationCode.toUpperCase())
    .eq('status', 'pushed_to_cinc')
    .not('cinc_invoice_id', 'is', null)
  if (error) throw new Error(`Could not load drafts: ${error.message}`)

  if (!drafts || drafts.length === 0) return stats

  // One bank-accounts fetch per assoc — used to denormalise the bank
  // account description into the reconciliation row for CSV export.
  let banks: BankAccountOption[] = []
  try {
    banks = await listAssociationBankAccounts(associationCode)
  } catch (err) {
    console.warn(`[recon-sync] bank-accounts fetch failed for ${associationCode}: ${(err as Error).message}`)
  }
  const bankById = new Map(banks.map(b => [b.id, b]))

  for (const draftRaw of drafts) {
    const draft = draftRaw as DraftRow
    stats.invoicesChecked++
    const invoiceId = draft.cinc_invoice_id ? parseInt(draft.cinc_invoice_id, 10) : NaN
    if (!Number.isFinite(invoiceId)) continue

    let payments: CincInvoicePayment[] = []
    try {
      payments = await listInvoicePayments(invoiceId)
    } catch (err) {
      const message = err instanceof CincApiError ? err.message : (err as Error).message
      stats.errors.push({ invoiceId, message })
      continue
    }
    stats.paymentsFetched += payments.length

    for (const p of payments) {
      if (p.TransDate == null || p.Amount == null) continue

      const effectiveDate  = p.TransDate.slice(0, 10)  // ISO date only
      const amount         = -Math.abs(p.Amount)        // outflow = negative
      const bankAccountId  = draft.pay_from_bank_account_id ?? 0
      const bank           = bankById.get(bankAccountId)

      // Dedupe on (cinc_invoice_id, amount, effective_date). If a row
      // with that combo exists already we update notes/reconciled state
      // but never overwrite manual edits to the descriptive columns.
      const { data: existing } = await supabaseAdmin
        .from('bank_reconciliation_entries')
        .select('id, additional_notes, pmi_coordinator_notes, reconciled_at, reconciled_by')
        .eq('source', 'cinc')
        .eq('cinc_invoice_id', invoiceId)
        .eq('amount', amount)
        .eq('effective_date', effectiveDate)
        .maybeSingle()

      const row = {
        association_code:           associationCode.toUpperCase(),
        bank_account_id:            bankAccountId,
        bank_account_description:   bank?.description ?? null,
        source:                     'cinc' as const,
        cinc_invoice_id:            invoiceId,
        cinc_payment_id:            null as string | null,  // CINC doesn't expose a payment ID
        effective_date:             effectiveDate,
        customer:                   associationCode.toUpperCase(),
        vendor_payee:               draft.matched_vendor_name ?? draft.matched_vendor_short_name ?? null,
        description:                draft.gl_account_name ?? null,
        invoice_number:             draft.extracted_invoice_number ?? null,
        amount,
        paid_type:                  draft.pay_by_type ?? (p.CheckNo ? `Check #${p.CheckNo}` : null),
        invoice_attached_url:       draft.drive_file_id ? `https://drive.google.com/file/d/${draft.drive_file_id}/view` : null,
        entered_by:                 'maia-cron',
        updated_at:                 new Date().toISOString(),
      }

      if (existing) {
        await supabaseAdmin
          .from('bank_reconciliation_entries')
          .update(row)  // structural fields refresh; notes & reconciled state are preserved (not in the patch)
          .eq('id', existing.id)
        stats.entriesUpdated++
      } else {
        await supabaseAdmin
          .from('bank_reconciliation_entries')
          .insert(row)
        stats.entriesCreated++
      }
    }
  }

  return stats
}
