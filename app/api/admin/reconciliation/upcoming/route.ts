// =====================================================================
// /api/admin/reconciliation/upcoming?assoc=CODE&month=YYYY-MM
//
// The "Upcoming Payments" feed for the reconciliation page — three
// sources of money expected to leave (or arrive) but not yet on the
// ledger:
//   1. manual    — scheduled_payments rows (pending, due_month <= month;
//                  past-due unpaid carry forward into later months)
//   2. cinc       — CINC invoices approved but not yet paid (live)
//   3. recurring  — vendors MAIA expects to recur this month (live, from
//                   payment history), not yet seen this month
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

  // ── 2 + 3. CINC approved-unpaid + recurring, aggregated across the
  //          association's bank accounts (fault-tolerant). ────────────
  const cincByInvoice = new Map<string, { vendorName: string | null; invoiceNumber: string | null; amount: number; dueDate: string | null; account: string }>()
  const recurringByKey = new Map<string, { displayName: string; avgAmount: number; lastSeenMonth: string }>()

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
            amount: it.amount, dueDate: it.dueDate, account: f.bankAccountDescription,
          })
        }
      }
      for (const v of f.recurringVendors) {
        if (!v.pendingThisMonth) continue
        const existing = recurringByKey.get(v.key)
        if (!existing || v.avgAmount > existing.avgAmount) {
          recurringByKey.set(v.key, { displayName: v.displayName, avgAmount: v.avgAmount, lastSeenMonth: v.lastSeenMonth })
        }
      }
    }
  } catch { /* live CINC enrichment is best-effort */ }

  return NextResponse.json({
    assoc, month,
    manual:    manual ?? [],
    cinc:      [...cincByInvoice.values()],
    recurring: [...recurringByKey.values()],
  })
}
