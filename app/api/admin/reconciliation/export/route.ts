// =====================================================================
// app/api/admin/reconciliation/export/route.ts
//
// GET /api/admin/reconciliation/export?assoc=X&month=YYYY-MM
//   Streams a STYLED .xlsx (colorful, opens cleanly in Google Sheets /
//   Excel) reproducing the reconciliation page: a totals header block, the
//   full column set, per-bank running-balance columns, and reconciled rows
//   tinted green — Isabela's monthly backup per association.
//
// Dates render as M/D/YYYY (Karen's preferred format).
// =====================================================================

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listAssociationBankAccounts, type BankAccountOption } from '@/lib/integrations/cinc'

export const runtime = 'nodejs'
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
  reconciled_at:            string | null
  created_at:               string
}

function fmtMD(iso: string): string {
  const [y, m, d] = (iso ?? '').split('-')
  if (!y || !m || !d) return iso ?? ''
  return `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}`
}
const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Palette mirroring the page.
const C = {
  headerBg: 'FF1F2937', headerFg: 'FFFFFFFF',   // dark slate column header
  titleBg:  'FFEFF6FF', titleFg:  'FF1E3A8A',
  startBg:  'FFFEFCE8',                          // yellow starting-balance row
  reconBg:  'FFF0FDF4',                          // green reconciled row
  inflowFg: 'FF166534', outflowFg: 'FF991B1B',
  banner:   'FFDC2626',
}
const argbFill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url   = new URL(req.url)
  const assoc = (url.searchParams.get('assoc') ?? '').trim().toUpperCase()
  const month = url.searchParams.get('month')
  if (!assoc) return NextResponse.json({ error: 'assoc query param required' }, { status: 400 })

  let banks: BankAccountOption[] = []
  const assocName = assoc
  try {
    banks = await listAssociationBankAccounts(assoc)
  } catch { /* CINC down — still export the entries */ }

  // SSB operating first, then other SSB, then non-SSB (matches the page order).
  const isSsb = (b: BankAccountOption) => /\bSSB\b/i.test(b.description ?? '')
  const sortKey = (b: BankAccountOption) => (isSsb(b) ? (b.kind === 'operating' ? 0 : 10) : 100)
  banks = [...banks].sort((a, b) => (sortKey(a) - sortKey(b)) || (a.description ?? '').localeCompare(b.description ?? ''))

  let query = supabaseAdmin
    .from('bank_reconciliation_entries')
    .select('effective_date, customer, vendor_payee, description, invoice_number, amount, paid_type, additional_notes, invoice_attached_url, bank_account_id, bank_account_description, entered_by, reconciled_at, created_at')
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

  // Totals (mirror the page header) + per-account running balances.
  let inflow = 0, outflow = 0, reconciled = 0, pending = 0
  const sumByAccount = new Map<number, number>()
  for (const r of rows) {
    if (r.amount >= 0) inflow += r.amount; else outflow += r.amount
    if (r.reconciled_at) reconciled++; else pending++
    sumByAccount.set(r.bank_account_id, (sumByAccount.get(r.bank_account_id) ?? 0) + r.amount)
  }
  const startingByAccount = new Map<number, number>()
  for (const b of banks) startingByAccount.set(b.id, (b.cincBalance ?? b.bankBalance ?? 0) - (sumByAccount.get(b.id) ?? 0))

  const monthLabel = month ? new Date(`${month}-01`).toLocaleString('en-US', { month: 'long', year: 'numeric' }) : 'All'

  // ── Build the workbook ──────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  wb.creator = 'MAIA · PMI Top Florida'
  const ws = wb.addWorksheet(`${assoc} ${month ?? ''}`.trim(), { views: [{ state: 'frozen', ySplit: 7 }] })

  const fixedHeaders = ['Effective Date', 'Customer', 'Vendor/Payee', 'Description of invoice', 'Invoice #', 'Amount', 'Paid Type / Account', 'Additional Notes']
  const tailHeaders  = ['Entered by', 'Reconciled']
  const headers = [...fixedHeaders, ...banks.map(b => b.description ?? `Acct ${b.id}`), ...tailHeaders]
  const ncols = headers.length

  // Row 1: title.
  ws.mergeCells(1, 1, 1, Math.max(6, ncols))
  const title = ws.getCell(1, 1)
  title.value = `Reconciliation — ${assocName} · ${monthLabel}`
  title.font = { bold: true, size: 14, color: { argb: C.titleFg } }
  title.fill = argbFill(C.titleBg)
  ws.getRow(1).height = 24

  // Row 2: totals strip.
  const totals: Array<[string, string, string?]> = [
    ['Inflow', usd(inflow), C.inflowFg],
    ['Outflow', usd(outflow), C.outflowFg],
    ['Net', usd(inflow + outflow)],
    ['Reconciled', String(reconciled), C.inflowFg],
    ['Pending', String(pending), pending > 0 ? C.outflowFg : C.inflowFg],
  ]
  totals.forEach(([label, val, fg], i) => {
    const c = ws.getCell(2, i * 2 + 1)
    c.value = label
    c.font = { color: { argb: 'FF6B7280' }, size: 10 }
    const v = ws.getCell(2, i * 2 + 2)
    v.value = val
    v.font = { bold: true, color: { argb: fg ?? 'FF111827' } }
  })

  // Row 4: red advisory banner.
  ws.mergeCells(4, 1, 4, Math.max(6, ncols))
  const banner = ws.getCell(4, 1)
  banner.value = 'To be inputted at CINC and be paid / or not bounced in the bank'
  banner.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  banner.fill = argbFill(C.banner)

  // Row 6: column headers.
  const headerRowIdx = 6
  headers.forEach((h, i) => {
    const c = ws.getCell(headerRowIdx, i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: C.headerFg }, size: 10 }
    c.fill = argbFill(C.headerBg)
    c.alignment = { vertical: 'middle', wrapText: true }
  })
  ws.getRow(headerRowIdx).height = 22

  // Column widths.
  const widths = [12, 16, 22, 30, 12, 13, 16, 20, ...banks.map(() => 16), 14, 11]
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

  // Row 7: starting balance.
  let r = headerRowIdx + 1
  if (banks.length > 0) {
    const cells = ['', '', `Starting balance — ${monthLabel}`, '', '', '', '', '', ...banks.map(b => startingByAccount.get(b.id) ?? 0), '', '']
    const row = ws.getRow(r)
    cells.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1)
      cell.value = v as ExcelJS.CellValue
      cell.fill = argbFill(C.startBg)
      if (typeof v === 'number') { cell.numFmt = '$#,##0.00'; cell.alignment = { horizontal: 'right' } }
      if (i === 2) cell.font = { bold: true }
    })
    r++
  }

  // Data rows with running balances.
  const running = new Map(startingByAccount)
  const amountCol = 6
  for (const e of rows) {
    running.set(e.bank_account_id, (running.get(e.bank_account_id) ?? 0) + e.amount)
    const bankVals = banks.map(b => running.get(b.id) ?? 0)
    const vals: ExcelJS.CellValue[] = [
      fmtMD(e.effective_date), e.customer ?? '', e.vendor_payee ?? '', e.description ?? '',
      e.invoice_number ?? '', e.amount, e.paid_type ?? '', e.additional_notes ?? '',
      ...bankVals, e.entered_by ?? '', e.reconciled_at ? 'Yes' : '',
    ]
    const row = ws.getRow(r)
    vals.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1)
      cell.value = v
      if (e.reconciled_at) cell.fill = argbFill(C.reconBg)
      // numeric: amount + bank columns
      if (i === amountCol - 1 || (i >= fixedHeaders.length && i < fixedHeaders.length + banks.length)) {
        cell.numFmt = '$#,##0.00'; cell.alignment = { horizontal: 'right' }
        if (i === amountCol - 1) cell.font = { color: { argb: e.amount < 0 ? C.outflowFg : C.inflowFg } }
      }
    })
    r++
  }

  const buf = await wb.xlsx.writeBuffer()
  const filename = `reconciliation_${assoc}${month ? `_${month}` : ''}.xlsx`
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
