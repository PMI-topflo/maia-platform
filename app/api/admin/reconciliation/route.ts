// =====================================================================
// app/api/admin/reconciliation/route.ts
//
// GET    — fetch reconciliation entries for (assoc, bank_account, month)
// POST   — add a manual entry (Isabela's "add row" button)
// PATCH  — update editable fields on an existing row (notes, reconciled,
//          plus structural fields IF source='manual')
// DELETE — remove a manual entry (CINC-sourced rows are not deletable;
//          rerunning the sync would re-create them anyway)
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

export const dynamic = 'force-dynamic'

async function getStaffEmail(): Promise<string | null> {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return null
  return typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : null
}

const SELECT_COLS = `
  id, association_code, bank_account_id, bank_account_description,
  source, cinc_invoice_id, cinc_payment_id,
  effective_date, customer, vendor_payee, description, invoice_number,
  amount, paid_type, additional_notes, invoice_attached_url,
  running_balance, pmi_coordinator_notes,
  reconciled_at, reconciled_by, entered_by, created_at, updated_at
`.replace(/\s+/g, ' ').trim()

// ── GET ──────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const email = await getStaffEmail()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url    = new URL(req.url)
  const assoc  = (url.searchParams.get('assoc') ?? '').trim().toUpperCase()
  const acct   = url.searchParams.get('account')  // optional — when omitted, return all bank accounts for the assoc (multi-account ledger view)
  const month  = url.searchParams.get('month')    // 'YYYY-MM' (optional; default = all months)
  if (!assoc) {
    return NextResponse.json({ error: 'assoc query param required' }, { status: 400 })
  }

  let query = supabaseAdmin
    .from('bank_reconciliation_entries')
    .select(SELECT_COLS)
    .eq('association_code', assoc)
    .order('effective_date', { ascending: true })
    .order('created_at',     { ascending: true })

  if (acct) {
    query = query.eq('bank_account_id', parseInt(acct, 10))
  }

  if (month) {
    // 'YYYY-MM' → date range covering that calendar month.
    const [y, m] = month.split('-').map(s => parseInt(s, 10))
    if (Number.isFinite(y) && Number.isFinite(m)) {
      const first = `${y}-${String(m).padStart(2, '0')}-01`
      const next  = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
      query = query.gte('effective_date', first).lt('effective_date', next)
    }
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ entries: data ?? [] })
}

// ── POST (manual entry) ──────────────────────────────────────────────
interface ManualEntryBody {
  association_code:           string
  bank_account_id:            number
  bank_account_description?:  string | null
  effective_date:             string  // YYYY-MM-DD
  customer?:                  string | null
  vendor_payee?:              string | null
  description?:               string | null
  invoice_number?:            string | null
  amount:                     number   // signed; positive=inflow, negative=outflow
  paid_type?:                 string | null
  additional_notes?:          string | null
  invoice_attached_url?:      string | null
  pmi_coordinator_notes?:     string | null
}

export async function POST(req: Request) {
  const email = await getStaffEmail()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: ManualEntryBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  if (!body.association_code || !body.bank_account_id || !body.effective_date || body.amount == null) {
    return NextResponse.json({ error: 'association_code, bank_account_id, effective_date, amount all required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('bank_reconciliation_entries')
    .insert({
      association_code:           body.association_code.toUpperCase(),
      bank_account_id:            body.bank_account_id,
      bank_account_description:   body.bank_account_description ?? null,
      source:                     'manual',
      effective_date:             body.effective_date,
      customer:                   body.customer ?? body.association_code.toUpperCase(),
      vendor_payee:               body.vendor_payee ?? null,
      description:                body.description ?? null,
      invoice_number:             body.invoice_number ?? null,
      amount:                     body.amount,
      paid_type:                  body.paid_type ?? null,
      additional_notes:           body.additional_notes ?? null,
      invoice_attached_url:       body.invoice_attached_url ?? null,
      pmi_coordinator_notes:      body.pmi_coordinator_notes ?? null,
      entered_by:                 email,
    })
    .select(SELECT_COLS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entry: data })
}

// ── PATCH (edit) ─────────────────────────────────────────────────────
interface PatchBody {
  id:                          string
  // Always editable (any source).
  additional_notes?:           string | null
  pmi_coordinator_notes?:      string | null
  invoice_attached_url?:       string | null
  reconciled?:                 boolean  // toggle; sets reconciled_at + reconciled_by
  // Manual-only structural edits.
  effective_date?:             string
  vendor_payee?:               string | null
  description?:                string | null
  invoice_number?:             string | null
  amount?:                     number
  paid_type?:                  string | null
}

export async function PATCH(req: Request) {
  const email = await getStaffEmail()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: PatchBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Load existing to gate manual-only fields.
  const { data: existing, error: loadErr } = await supabaseAdmin
    .from('bank_reconciliation_entries')
    .select('id, source')
    .eq('id', body.id)
    .single()
  if (loadErr || !existing) return NextResponse.json({ error: loadErr?.message ?? 'not found' }, { status: 404 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  // Always-editable.
  if ('additional_notes'      in body) patch.additional_notes      = body.additional_notes      ?? null
  if ('pmi_coordinator_notes' in body) patch.pmi_coordinator_notes = body.pmi_coordinator_notes ?? null
  if ('invoice_attached_url'  in body) patch.invoice_attached_url  = body.invoice_attached_url  ?? null
  if ('reconciled' in body) {
    if (body.reconciled) {
      patch.reconciled_at = new Date().toISOString()
      patch.reconciled_by = email
    } else {
      patch.reconciled_at = null
      patch.reconciled_by = null
    }
  }

  // Manual-only structural edits.
  if (existing.source === 'manual') {
    if ('effective_date' in body && body.effective_date) patch.effective_date = body.effective_date
    if ('vendor_payee'   in body) patch.vendor_payee   = body.vendor_payee   ?? null
    if ('description'    in body) patch.description    = body.description    ?? null
    if ('invoice_number' in body) patch.invoice_number = body.invoice_number ?? null
    if ('amount'         in body && body.amount != null) patch.amount        = body.amount
    if ('paid_type'      in body) patch.paid_type      = body.paid_type      ?? null
  }

  const { data, error } = await supabaseAdmin
    .from('bank_reconciliation_entries')
    .update(patch)
    .eq('id', body.id)
    .select(SELECT_COLS)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entry: data })
}

// ── DELETE ───────────────────────────────────────────────────────────
export async function DELETE(req: Request) {
  const email = await getStaffEmail()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const id  = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 })

  const { data: existing, error: loadErr } = await supabaseAdmin
    .from('bank_reconciliation_entries')
    .select('id, source')
    .eq('id', id)
    .single()
  if (loadErr || !existing) return NextResponse.json({ error: loadErr?.message ?? 'not found' }, { status: 404 })

  if (existing.source !== 'manual') {
    return NextResponse.json({ error: 'cannot delete CINC-sourced rows; re-running the sync would re-create them. Delete the underlying invoice in CINC instead.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('bank_reconciliation_entries')
    .delete()
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
