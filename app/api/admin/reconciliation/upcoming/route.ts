// =====================================================================
// /api/admin/reconciliation/upcoming?assoc=CODE&month=YYYY-MM
//
// The "Upcoming Payments" feed for the reconciliation page — three
// sources of money expected to leave (or arrive) but not yet on the
// ledger:
//   1. manual    — scheduled_payments rows (pending, due_month <= month;
//                  past-due unpaid carry forward into later months)
//   2. cinc       — CINC invoices approved but not yet paid (live), each
//                   tagged with OUR scheduled_pay_date when the invoice was
//                   pushed from MAIA (so the list reflects when we plan to
//                   pay, not just CINC's due date)
//   3. recurring  — vendors MAIA expects to recur this month (live, from
//                   payment history), not yet seen this month
//   4. scheduled  — MAIA drafts marked ready_to_push with a scheduled pay
//                   date that haven't been pushed to CINC yet (so they're a
//                   real upcoming outflow CINC doesn't know about). Past-due
//                   unpaid carry forward, same as manual entries.
//
// Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listAssociationBankAccounts } from '@/lib/integrations/cinc'
import { forecastEndOfMonthBalance } from '@/lib/cash-flow-forecast'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const assoc = (url.searchParams.get('assoc') ?? '').trim().toUpperCase()
  const month = (url.searchParams.get('month') ?? '').trim()
  if (!assoc || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'assoc and month=YYYY-MM are required' }, { status: 400 })
  }

  // ── 1. Manual scheduled payments (pending, due this month or carried) ──
  const { data: manual, error: manualErr } = await supabaseAdmin
    .from('scheduled_payments')
    .select('*')
    .eq('association_code', assoc)
    .eq('status', 'pending')
    .lte('due_month', month)
    .order('due_month', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
  if (manualErr) return NextResponse.json({ error: manualErr.message }, { status: 500 })

  // MAIA estimates staff have dismissed (judged wrong/unwanted) — hidden.
  const { data: dismissals } = await supabaseAdmin
    .from('recurring_estimate_dismissals')
    .select('vendor_key')
    .eq('association_code', assoc)
  const dismissedKeys = new Set((dismissals ?? []).map(d => d.vendor_key))

  // ── MAIA invoice drafts with an explicit scheduled pay date ─────────
  // Two uses below:
  //   • pushed drafts → look up their scheduled_pay_date by invoice # so the
  //     CINC stream can show when WE plan to pay, not just CINC's due date.
  //   • ready_to_push drafts → a 4th "scheduled" stream (not in CINC yet).
  const normInvNo = (s: string | null | undefined) => (s ?? '').trim().toUpperCase().replace(/\s+/g, '')
  // First day of the month AFTER the query month — the upper bound for
  // "scheduled on or before this month" (string compare works for ISO dates).
  const [qy, qm] = month.split('-').map(Number)
  const nextMonthFirst = `${qm === 12 ? qy + 1 : qy}-${String(qm === 12 ? 1 : qm + 1).padStart(2, '0')}-01`

  const { data: schedDrafts } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('id, extracted_invoice_number, matched_vendor_name, matched_vendor_short_name, extracted_amount, scheduled_pay_date, status')
    .eq('extracted_association_code', assoc)
    .in('status', ['ready_to_push', 'pushed_to_cinc'])
    .not('scheduled_pay_date', 'is', null)
    .order('scheduled_pay_date', { ascending: true })

  const schedByInvoiceNo = new Map<string, string>()
  for (const d of schedDrafts ?? []) {
    if (d.status === 'pushed_to_cinc' && d.extracted_invoice_number && d.scheduled_pay_date) {
      schedByInvoiceNo.set(normInvNo(d.extracted_invoice_number), d.scheduled_pay_date as string)
    }
  }

  // ── 2 + 3. CINC approved-unpaid + recurring, aggregated across the
  //          association's bank accounts (fault-tolerant). ────────────
  const cincByInvoice = new Map<string, { vendorName: string | null; invoiceNumber: string | null; amount: number; dueDate: string | null; scheduledPayDate: string | null; account: string }>()
  const recurringByKey = new Map<string, { key: string; displayName: string; avgAmount: number; lastSeenMonth: string; projectedDate: string }>()
  // The current calendar month — recurring estimates are only projected for
  // the current or a future month (past months show real ledger activity).
  const thisMonth = new Date().toISOString().slice(0, 7)

  try {
    const banks = await listAssociationBankAccounts(assoc)
    const forecasts = await Promise.all(
      banks.map(b => forecastEndOfMonthBalance({ assocCode: assoc, bankAccountId: b.id })
        .catch(() => null)),
    )
    for (const f of forecasts) {
      if (!f) continue
      for (const it of f.approvedUnpaidItems) {
        const key = `${it.invoiceNumber ?? ''}|${it.vendorName ?? ''}|${it.amount}`
        if (!cincByInvoice.has(key)) {
          cincByInvoice.set(key, {
            vendorName: it.vendorName, invoiceNumber: it.invoiceNumber,
            amount: it.amount, dueDate: it.dueDate,
            scheduledPayDate: it.invoiceNumber ? (schedByInvoiceNo.get(normInvNo(it.invoiceNumber)) ?? null) : null,
            account: f.bankAccountDescription,
          })
        }
      }
      // Project each recurring (EFT/auto-draft) estimate into the month it's
      // actually expected to be paid, on its typical day. Show it for the
      // viewed month only when (a) we're looking at the current or a future
      // month and (b) it hasn't already been paid that month. This is what
      // makes auto-draft utilities/insurance land in the right month instead
      // of always piling onto "this month".
      if (month >= thisMonth) {
        for (const v of f.recurringVendors) {
          if (dismissedKeys.has(v.key)) continue          // staff dismissed this estimate
          if (v.seenMonths.includes(month)) continue       // already paid in the viewed month
          const projectedDate = `${month}-${String(v.typicalDay).padStart(2, '0')}`
          const existing = recurringByKey.get(v.key)
          if (!existing || v.avgAmount > existing.avgAmount) {
            recurringByKey.set(v.key, { key: v.key, displayName: v.displayName, avgAmount: v.avgAmount, lastSeenMonth: v.lastSeenMonth, projectedDate })
          }
        }
      }
    }
  } catch { /* live CINC enrichment is best-effort */ }

  // ── 4. MAIA scheduled (ready_to_push, not yet in CINC) ──────────────
  // These are audited invoices with a pay date that we haven't pushed yet,
  // so they don't appear in the CINC stream. Show those scheduled on or
  // before the query month (past-due unpaid carry forward, like manual).
  const scheduled = (schedDrafts ?? [])
    .filter(d => d.status === 'ready_to_push' && typeof d.scheduled_pay_date === 'string' && d.scheduled_pay_date < nextMonthFirst)
    .map(d => ({
      draftId:          d.id as number,
      vendorName:       d.matched_vendor_name ?? d.matched_vendor_short_name ?? null,
      invoiceNumber:    d.extracted_invoice_number ?? null,
      amount:           typeof d.extracted_amount === 'number' ? d.extracted_amount : 0,
      scheduledPayDate: d.scheduled_pay_date as string,
    }))

  // ── Dedup recurring estimates against REAL upcoming payments ────────
  // Once an actual EFT payment for this period exists — a CINC approved-
  // unpaid invoice, a MAIA-pushed/scheduled draft, or a manual entry that
  // falls in the viewed month — MAIA's recurring *estimate* for the same
  // spend is a duplicate and must drop out (the user's "the pushed EFT
  // invoice deletes the projected one for that month"). We match on amount
  // within the same ±15% tolerance the detector uses, since the estimate's
  // description (a GL line) rarely matches the invoice's vendor name.
  const cincList = [...cincByInvoice.values()]
  const realAmountsThisMonth: number[] = []
  for (const c of cincList) {
    const m = (c.scheduledPayDate ?? c.dueDate ?? '').slice(0, 7)
    if (!m || m === month) realAmountsThisMonth.push(c.amount)   // undated approved-unpaid counts as near-term
  }
  for (const s of scheduled)        if (s.scheduledPayDate.slice(0, 7) === month) realAmountsThisMonth.push(s.amount)
  for (const m of (manual ?? []))   if (m.due_month === month)                    realAmountsThisMonth.push(Number(m.amount))

  const recurring = [...recurringByKey.values()].filter(r =>
    !realAmountsThisMonth.some(a => a > 0 && Math.abs(a - r.avgAmount) / r.avgAmount <= 0.15),
  )

  return NextResponse.json({
    assoc, month,
    manual:    manual ?? [],
    cinc:      cincList,
    recurring,
    scheduled,
  })
}
