// =====================================================================
// app/api/admin/invoices/intake/route.ts
//
// GET   — list invoice intake drafts, filterable by status. Used by
//          the /admin/invoices dashboard tabs.
// PATCH — edit a draft's extracted fields (Karen correcting MAIA's
//          extraction before pushing to CINC). Body shape:
//            { id, matched_cinc_vendor_id?, matched_vendor_name?,
//              matched_vendor_short_name?, extracted_invoice_number?,
//              extracted_amount?, extracted_association_code?,
//              extracted_invoice_date? }
//          Only fields that appear in the body are written.
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = new Set([
  'pending_review', 'needs_vendor', 'duplicate_in_cinc', 'pushed_to_cinc', 'rejected',
])

const SELECT_COLUMNS = `
  id, gmail_message_id, pdf_storage_key, ticket_id,
  extracted_vendor_name, matched_cinc_vendor_id, matched_vendor_name, matched_vendor_short_name,
  extracted_invoice_number, extracted_amount, extracted_association_code, extracted_invoice_date,
  gl_account_id, gl_account_name,
  extraction_confidence, status, rejected_reason,
  cinc_invoice_id, cinc_dup_invoice_id, pushed_at, pushed_by,
  created_at, updated_at
`.replace(/\s+/g, ' ').trim()

export async function GET(req: Request) {
  const url       = new URL(req.url)
  const status    = url.searchParams.get('status') ?? 'pending_review'
  const limitRaw  = parseInt(url.searchParams.get('limit') ?? '50', 10)
  const limit     = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50

  if (status !== 'all' && !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: `invalid status "${status}"` }, { status: 400 })
  }

  let query = supabaseAdmin
    .from('invoice_intake_drafts')
    .select(SELECT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Side counts per status so the dashboard tabs can show pill numbers.
  const { data: counts } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('status')
  const countsByStatus: Record<string, number> = {}
  for (const row of (counts ?? [])) {
    countsByStatus[row.status as string] = (countsByStatus[row.status as string] ?? 0) + 1
  }

  return NextResponse.json({ drafts: data ?? [], counts: countsByStatus })
}

interface PatchBody {
  id:                          number
  matched_cinc_vendor_id?:     string | null
  matched_vendor_name?:        string | null
  matched_vendor_short_name?:  string | null
  extracted_invoice_number?:   string | null
  extracted_amount?:           number | null
  extracted_association_code?: string | null
  extracted_invoice_date?:     string | null
  gl_account_id?:              string | null
  gl_account_name?:            string | null
}

export async function PATCH(req: Request) {
  let body: PatchBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (!body.id || !Number.isFinite(body.id)) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  // Only write keys that were actually included in the request body.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const writable: Array<keyof PatchBody> = [
    'matched_cinc_vendor_id', 'matched_vendor_name', 'matched_vendor_short_name',
    'extracted_invoice_number', 'extracted_amount',
    'extracted_association_code', 'extracted_invoice_date',
    'gl_account_id', 'gl_account_name',
  ]
  for (const k of writable) {
    if (k in body) patch[k as string] = body[k] ?? null
  }
  // If Karen assigned a vendor, drop the needs_vendor status.
  if ('matched_cinc_vendor_id' in body && body.matched_cinc_vendor_id) {
    patch.status = 'pending_review'
  }

  const { data, error } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .update(patch)
    .eq('id', body.id)
    .select(SELECT_COLUMNS)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ draft: data })
}
