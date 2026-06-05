// =====================================================================
// app/api/admin/reconciliation/mark-paid/route.ts
//
// POST — Jonathan marks an EFT invoice Paid from the "To Pay in CINC" box.
// Per the locked decision (CINC has no "mark Paid" API; Paid is set by
// CINC's payment run):
//   1. Reconcile in MAIA: find the matching ledger entry (by invoice # +
//      association) and stamp reconciled_at/by + paid_at/by = this staffer;
//      create a manual ledger row if none exists yet.
//   2. If the item is a MAIA scheduled draft not yet in CINC, post it to
//      CINC's "Ready for Payment" via approvedInvoices so CINC will pay it.
//   3. Roll the paid count into the staffer's daily reconciliation ticket.
//
// The literal CINC "Paid" status is NOT written here — it flips when CINC
// runs the payment batch, and the hourly bank-sync then shows it cleared.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listAssociationBankAccounts, postApprovedInvoice } from '@/lib/integrations/cinc'
import { refreshReconTicketSummary, easternDateStr } from '@/lib/reconciliation-tickets'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function staffEmail(): Promise<string | null> {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return null
  return typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null
}

interface Body {
  assoc:          string
  kind:           'cinc' | 'scheduled'
  invoiceNumber?: string | null
  draftId?:       number | null
  amount:         number
  vendorName?:    string | null
  bankAccountId?: number | null
}

export async function POST(req: Request) {
  const email = await staffEmail()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Body
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const assoc = (body.assoc ?? '').trim().toUpperCase()
  if (!assoc || (body.kind !== 'cinc' && body.kind !== 'scheduled')) {
    return NextResponse.json({ error: 'assoc and kind (cinc|scheduled) are required' }, { status: 400 })
  }
  const nowIso  = new Date().toISOString()
  const invNorm = (body.invoiceNumber ?? '').trim()

  // ── 1. Reconcile in MAIA ─────────────────────────────────────────────
  let reconciledEntryId: string | null = null
  try {
    let existing: { id: string } | null = null
    if (invNorm) {
      const { data } = await supabaseAdmin
        .from('bank_reconciliation_entries')
        .select('id')
        .eq('association_code', assoc)
        .ilike('invoice_number', invNorm)
        .limit(1)
        .maybeSingle()
      existing = (data as { id: string } | null) ?? null
    }

    if (existing) {
      await supabaseAdmin.from('bank_reconciliation_entries').update({
        reconciled_at: nowIso, reconciled_by: email, paid_at: nowIso, paid_by: email, updated_at: nowIso,
      }).eq('id', existing.id)
      reconciledEntryId = existing.id
    } else {
      // No ledger row yet — create a manual one so the payment is on the
      // books and reconciled. Hits the association's operating account.
      let bankAccountId = body.bankAccountId ?? null
      let bankDesc: string | null = null
      try {
        const banks = await listAssociationBankAccounts(assoc)
        const op    = banks.find(b => b.id === bankAccountId) ?? banks.find(b => b.kind === 'operating') ?? banks[0]
        if (op) { bankAccountId = op.id; bankDesc = op.description }
      } catch { /* operating lookup is best-effort */ }
      if (bankAccountId == null) {
        return NextResponse.json({ error: 'Could not resolve a bank account for this association' }, { status: 400 })
      }
      const { data, error } = await supabaseAdmin.from('bank_reconciliation_entries').insert({
        association_code:         assoc,
        bank_account_id:          bankAccountId,
        bank_account_description: bankDesc,
        source:                   'manual',
        effective_date:           easternDateStr(),
        customer:                 assoc,
        vendor_payee:             body.vendorName ?? null,
        description:              'EFT payment (marked paid in MAIA)',
        invoice_number:           invNorm || null,
        amount:                   -Math.abs(Number(body.amount) || 0),
        paid_type:                'EFT',
        reconciled_at:            nowIso,
        reconciled_by:            email,
        paid_at:                  nowIso,
        paid_by:                  email,
        entered_by:               email,
      }).select('id').single()
      if (error) return NextResponse.json({ error: `ledger write failed: ${error.message}` }, { status: 500 })
      reconciledEntryId = (data as { id: string }).id
    }
  } catch (err) {
    return NextResponse.json({ error: `reconcile failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }

  // ── 2. Post unsent MAIA drafts into CINC "Ready for Payment" ─────────
  let cincResult: { posted: boolean; invoiceId?: number; error?: string } = { posted: false }
  if (body.kind === 'scheduled' && body.draftId) {
    try {
      const { data: draft } = await supabaseAdmin
        .from('invoice_intake_drafts')
        .select('matched_cinc_vendor_id, extracted_invoice_number, extracted_amount, extracted_invoice_date, gl_account_id, gl_account_name, pay_from_bank_account_id, pay_by_type, status, cinc_invoice_id')
        .eq('id', body.draftId)
        .maybeSingle()
      if (draft && !draft.cinc_invoice_id && draft.matched_cinc_vendor_id && draft.extracted_invoice_number) {
        const amount = Number(draft.extracted_amount) || Math.abs(Number(body.amount) || 0)
        const { invoiceId } = await postApprovedInvoice({
          associationCode:      assoc,
          vendorId:             Number(draft.matched_cinc_vendor_id),
          invoiceNumber:        String(draft.extracted_invoice_number),
          invoiceDate:          (draft.extracted_invoice_date as string) ?? easternDateStr(),
          amount,
          payFromBankAccountId: draft.pay_from_bank_account_id as number | null,
          payByType:            (draft.pay_by_type as string | null) ?? 'ACH',
          expenseItems:         draft.gl_account_id
            ? [{ glNumber: String(draft.gl_account_id), description: String(draft.gl_account_name ?? 'Expense').slice(0, 100), amount: -Math.abs(amount) }]
            : [],
        })
        await supabaseAdmin.from('invoice_intake_drafts').update({
          status: 'pushed_to_cinc', cinc_invoice_id: String(invoiceId), pushed_at: nowIso, pushed_by: email, updated_at: nowIso,
        }).eq('id', body.draftId)
        cincResult = { posted: true, invoiceId }
      }
    } catch (err) {
      // Reconciliation already succeeded; surface the CINC failure without failing the whole call.
      cincResult = { posted: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ── 3. Roll into the staffer's daily reconciliation ticket ───────────
  let ticket: { ticketNumber: string; totalPaid: number } | null = null
  try {
    const r = await refreshReconTicketSummary({ staffEmail: email })
    if (r) ticket = { ticketNumber: r.ticketNumber, totalPaid: r.totalPaid }
  } catch { /* ticket rollup is best-effort */ }

  return NextResponse.json({ ok: true, reconciledEntryId, cinc: cincResult, ticket })
}
