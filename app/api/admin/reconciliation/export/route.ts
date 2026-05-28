// =====================================================================
// app/api/admin/reconciliation/export/route.ts
//
// GET /api/admin/reconciliation/export?assoc=X&month=YYYY-MM
//   Streams a multi-account ledger CSV matching Isabela's existing
//   Google-Sheet format. Each row is one transaction; the running
//   balance per bank account is in its own column, with the touched
//   account's balance updating and the others carrying forward.
//
// Dates render as M/D/YYYY (Karen's preferred format).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listAssociationBankAccounts, type BankAccountOption } from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

interface ReconRow {
  effective_date:           string
  customer:                 string | null
  vendor_payee:             string | null
  description:              string | null
  invoice_number:           string | null
  amount:                   number
  paid_type:                string | null
  additional_notes:         string | null
  invoice_attached_url:     string | null
  bank_account_id:          number
  bank_account_description: string | null
  entered_by:               string
  pmi_coordinator_notes:    string | null
  reconciled_at:            string | null
  created_at:               string
}

function csvCell(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function fmtMD(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}`
}

function fmt2(n: number): string {
  return n.toFixed(2)
}

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url    = new URL(req.url)
  const assoc  = (url.searchParams.get('assoc') ?? '').trim().toUpperCase()
  const month  = url.searchParams.get('month')
  if (!assoc) {
    return NextResponse.json({ error: 'assoc query param required' }, { status: 400 })
  }

  // Pull both: the bank account list (for column headers + starting
  // balances) and the entries themselves.
  let banks: BankAccountOption[] = []
  try { banks = await listAssociationBankAccounts(assoc) }
  catch { /* if CINC is down, fall back to empty list — entries still export */ }

  let query = supabaseAdmin
    .from('bank_reconciliation_entries')
    .select('effective_date, customer, vendor_payee, description, invoice_number, amount, paid_type, additional_notes, invoice_attached_url, bank_account_id, bank_account_description, entered_by, pmi_coordinator_notes, reconciled_at, created_at')
    .eq('association_code', assoc)
    .order('effective_date', { ascending: true })
    .order('created_at',     { ascending: true })

  if (month) {
    const [y, m] = month.split('-').map(s => parseInt(s, 10))
    if (Number.isFinite(y) && Number.isFinite(m)) {
      const first = `${y}-${String(m).padStart(2, '0')}-01`
      const next  = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
      query = query.gte('effective_date', first).lt('effective_date', next)
    }
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = (data ?? []) as ReconRow[]

  // ── Running balance per account ─────────────────────────────────
  // Starting balance for each account = current balance (from CINC) −
  // sum of entries in the displayed window for that account. This makes
  // the LAST row's balance ≈ today's CINC balance (assuming the window
  // contains every transaction through today).
  const sumByAccount = new Map<number, number>()
  for (const r of rows) {
    sumByAccount.set(r.bank_account_id, (sumByAccount.get(r.bank_account_id) ?? 0) + r.amount)
  }
  const startingByAccount = new Map<number, number>()
  for (const b of banks) {
    const current = b.cincBalance ?? b.bankBalance ?? 0
    startingByAccount.set(b.id, current - (sumByAccount.get(b.id) ?? 0))
  }

  // Headers — fixed columns first, then one column per bank account,
  // ending with notes / reconciled.
  const fixedHeaders = [
    'Effective Date',
    'Customer',
    'Vendor/Payee',
    'Description of invoice',
    'Invoice #',
    'Amount',
    'Paid Type/Account Used',
    'Additional Notes',
    'Invoice Attached',
  ]
  const bankHeaders = banks.map(b => b.description)
  const tailHeaders = [
    'Entered by',
    'PMI Coordinator Notes',
    'Reconciled',
  ]
  const headers = [...fixedHeaders, ...bankHeaders, ...tailHeaders]

  const csvLines = [headers.map(csvCell).join(',')]

  // Optional starting-balance row matches the spreadsheet layout — first
  // row of the month shows the opening balance per account.
  if (banks.length > 0) {
    const monthLabel = month
      ? new Date(month + '-01').toLocaleString('en-US', { month: 'long', year: 'numeric' })
      : 'Opening'
    const startRow = [
      '',  // date
      '',  // customer
      `Starting balance — ${monthLabel}`,
      '', '', '', '', '', '',
      ...banks.map(b => fmt2(startingByAccount.get(b.id) ?? 0)),
      '', '', '',
    ]
    csvLines.push(startRow.map(csvCell).join(','))
  }

  // Walk entries, updating the running balance for whichever account
  // each row affects.
  const running = new Map(startingByAccount)
  for (const r of rows) {
    const prior = running.get(r.bank_account_id) ?? 0
    running.set(r.bank_account_id, prior + r.amount)

    const bankCols = banks.map(b => fmt2(running.get(b.id) ?? 0))

    csvLines.push([
      fmtMD(r.effective_date),
      r.customer ?? '',
      r.vendor_payee ?? '',
      r.description ?? '',
      r.invoice_number ?? '',
      fmt2(r.amount),
      r.paid_type ?? '',
      r.additional_notes ?? '',
      r.invoice_attached_url ?? '',
      ...bankCols,
      r.entered_by ?? '',
      r.pmi_coordinator_notes ?? '',
      r.reconciled_at ? 'Y' : '',
    ].map(csvCell).join(','))
  }

  const filename = `reconciliation_${assoc}${month ? `_${month}` : ''}.csv`
  return new NextResponse(csvLines.join('\n') + '\n', {
    status:  200,
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
