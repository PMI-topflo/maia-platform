// =====================================================================
// /api/admin/reports/monthly/financials
//
// POST   — staff upload a financial-statement PDF for an (association,
//          month). MAIA reads the PDF and extracts the headline figures.
// DELETE — remove the statement (figures + stored PDF) for an
//          (association, month).
//
// Staff-only. The PDF is stored in the private `report-financials`
// bucket; figures land in `report_financials`.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import {
  saveFinancialPdf,
  deleteFinancials,
  FINANCIALS_FILE_SIZE_LIMIT_BYTES,
} from '@/lib/report-financials'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function staffEmail(): Promise<string | null | false> {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return false
  return typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : null
}

export async function POST(req: Request) {
  const email = await staffEmail()
  if (email === false) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Expected a multipart form upload' }, { status: 400 }) }

  const assoc = String(form.get('assoc') ?? '').trim().toUpperCase()
  const month = String(form.get('month') ?? '').trim()
  const file  = form.get('file')

  if (!assoc) {
    return NextResponse.json({ error: 'Pick a single association before uploading a statement.' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Invalid month' }, { status: 400 })
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'No PDF file was provided' }, { status: 400 })
  }
  if (file.size > FINANCIALS_FILE_SIZE_LIMIT_BYTES) {
    return NextResponse.json(
      { error: `The PDF exceeds the ${Math.round(FINANCIALS_FILE_SIZE_LIMIT_BYTES / 1024 / 1024)} MB limit` },
      { status: 400 },
    )
  }

  const bytes  = Buffer.from(await file.arrayBuffer())
  const result = await saveFinancialPdf({
    assoc,
    month,
    bytes,
    filename:        file.name || 'financial-statement.pdf',
    uploadedByEmail: email,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  const { row } = result
  return NextResponse.json({
    ok:             true,
    pdf_filename:   row.pdf_filename,
    extract_status: row.extract_status,
    extract_error:  row.extract_error,
    figures:        row.figures,
  })
}

export async function DELETE(req: Request) {
  const email = await staffEmail()
  if (email === false) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const assoc = (searchParams.get('assoc') ?? '').trim().toUpperCase()
  const month = (searchParams.get('month') ?? '').trim()
  if (!assoc || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'assoc and month are required' }, { status: 400 })
  }

  const result = await deleteFinancials(assoc, month)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
