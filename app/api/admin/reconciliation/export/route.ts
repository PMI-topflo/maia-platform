// =====================================================================
// app/api/admin/reconciliation/export/route.ts
//
// GET /api/admin/reconciliation/export?assoc=LFA&account=48&month=2026-05
//   Streams a CSV download matching Isabela's existing Google-Sheet
//   column order so importing keeps her downstream workflow intact.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

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
  bank_account_description: string | null
  running_balance:          number | null
  entered_by:               string
  pmi_coordinator_notes:    string | null
  reconciled_at:            string | null
}

/** Escape a CSV cell — wrap in quotes if it contains comma/quote/newline,
 *  doubling any internal quotes. */
function csvCell(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url    = new URL(req.url)
  const assoc  = (url.searchParams.get('assoc') ?? '').trim().toUpperCase()
  const acct   = url.searchParams.get('account')
  const month  = url.searchParams.get('month')
  if (!assoc || !acct) {
    return NextResponse.json({ error: 'assoc + account query params required' }, { status: 400 })
  }

  let query = supabaseAdmin
    .from('bank_reconciliation_entries')
    .select('effective_date, customer, vendor_payee, description, invoice_number, amount, paid_type, additional_notes, invoice_attached_url, bank_account_description, running_balance, entered_by, pmi_coordinator_notes, reconciled_at')
    .eq('association_code', assoc)
    .eq('bank_account_id', parseInt(acct, 10))
    .order('effective_date', { ascending: true })

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

  // Header row matches Isabela's spreadsheet column order verbatim so
  // a CSV import into her existing Google Sheet template keeps the
  // headers aligned.
  const bankColLabel = rows[0]?.bank_account_description
    ? rows[0].bank_account_description.replace(/\s+/g, ' ')
    : 'Bank Account'
  const headers = [
    'Effective Date',
    'Customer',
    'Vendor/Payee',
    'Description of invoice',
    'Invoice #',
    'Amount',
    'Paid Type/Account Used',
    'Additional Notes',
    'Invoice Attached',
    bankColLabel,
    'Entered by/Date',
    'PMI Coordinator Notes',
    'Reconciled',
  ]

  const csvLines = [headers.map(csvCell).join(',')]
  for (const r of rows) {
    const enteredBy = `${r.entered_by ?? ''}`
    csvLines.push([
      r.effective_date,
      r.customer ?? '',
      r.vendor_payee ?? '',
      r.description ?? '',
      r.invoice_number ?? '',
      r.amount.toFixed(2),
      r.paid_type ?? '',
      r.additional_notes ?? '',
      r.invoice_attached_url ?? '',
      r.running_balance != null ? r.running_balance.toFixed(2) : '',
      enteredBy,
      r.pmi_coordinator_notes ?? '',
      r.reconciled_at ? 'Y' : '',
    ].map(csvCell).join(','))
  }

  const filename = `reconciliation_${assoc}_acc${acct}${month ? `_${month}` : ''}.csv`
  return new NextResponse(csvLines.join('\n') + '\n', {
    status:  200,
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
