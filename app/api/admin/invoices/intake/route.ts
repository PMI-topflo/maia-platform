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
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { resolveStaffByLoginEmail, trustedDomainVariants } from '@/lib/staff-lookup'

export const dynamic = 'force-dynamic'

// NOTE: the renamed-PDF Drive mirror used to run HERE at the Transfer-to-Push
// (ready_to_push) step. It now runs ONLY when Karen presses "Push to CINC"
// (app/api/admin/invoices/intake/[id]/push), so a file lands in INVOICE TO
// INPUT only for invoices that were actually pushed — not the moment Isabela
// marks one ready. (Manual re-mirror still available via the remirror route.)

const APP_URL        = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const KAREN_ALERT_TO = process.env.MAIA_BILLING_ALERT_TO ?? 'billing@topfloridaproperties.com'

/** When someone OTHER than Karen marks a draft ready, email Karen that it's
 *  ready for her approval + a link to the audit screen. Best-effort. */
async function notifyKarenReady(row: Record<string, unknown>, markerEmail: string | null): Promise<void> {
  if (!markerEmail) return
  // Karen (billing@) marking her own — no email needed.
  const karen = new Set(trustedDomainVariants(KAREN_ALERT_TO).map(e => e.toLowerCase()))
  if (karen.has(markerEmail.toLowerCase())) return

  let who = markerEmail
  try { const st = await resolveStaffByLoginEmail(markerEmail); if (st?.name) who = st.name } catch { /* fall back to email */ }

  const vendor = String(row.matched_vendor_name ?? row.matched_vendor_short_name ?? 'vendor')
  const inv    = String(row.extracted_invoice_number ?? '(no #)')
  const amt    = row.extracted_amount != null ? '$' + Number(row.extracted_amount).toLocaleString('en-US', { minimumFractionDigits: 2 }) : ''
  const assoc  = String(row.extracted_association_code ?? '')
  const link   = `${APP_URL}/admin/invoices?status=ready_to_push`
  const subject = `Invoice ready for your approval — ${vendor} #${inv}${amt ? ' · ' + amt : ''}`
  const html = `<p><strong>${who}</strong> finished auditing this invoice — it's <strong>ready for your approval</strong>.</p>
    <p>${vendor} · #${inv}${amt ? ' · ' + amt : ''}${assoc ? ' · ' + assoc : ''}</p>
    <p style="margin:18px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600">Open the audit &amp; push to CINC →</a></p>
    <p style="color:#6b7280;font-size:12px">${link}</p>`
  await sendEmail({ to: KAREN_ALERT_TO, subject, html })
}

const PDF_BUCKET           = 'invoice-intake-pdfs'
const PDF_SIGNED_URL_TTL_S = 60 * 60   // 1 hour — matches the server page load

/** Sign one preview URL per storage key. The PDF preview in the queue is
 *  driven by `pdf_signed_url`; the server page builds these on first load,
 *  but client refetches (tab switch, edit, push) hit THIS route — without
 *  signing here the preview would blank out and falsely report "upload
 *  failed at intake" until a hard refresh. Best-effort: a failure leaves
 *  the URL null (the genuine no-PDF fallback). */
async function buildSignedUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (paths.length === 0) return out
  const { data, error } = await supabaseAdmin.storage
    .from(PDF_BUCKET)
    .createSignedUrls(paths, PDF_SIGNED_URL_TTL_S)
  if (error) return out
  for (let i = 0; i < paths.length; i++) {
    const url = data?.[i]?.signedUrl
    if (url) out.set(paths[i], url)
  }
  return out
}

const VALID_STATUSES = new Set([
  'pending_review', 'ready_to_push', 'needs_vendor', 'duplicate_in_cinc', 'pushed_to_cinc', 'rejected', 'on_hold',
])

const SELECT_COLUMNS = `
  id, gmail_message_id, pdf_storage_key, ticket_id,
  extracted_vendor_name, matched_cinc_vendor_id, matched_vendor_name, matched_vendor_short_name,
  extracted_invoice_number, extracted_amount, extracted_association_code, extracted_invoice_date,
  extracted_account_number, extracted_description,
  due_date, scheduled_pay_date,
  gl_account_id, gl_account_name,
  pay_by_type, observation_note, work_order_number, wo_partial_payment,
  pay_from_bank_account_id,
  extraction_confidence, status, rejected_reason,
  audit_checklist, audit_ready_by, audit_ready_at,
  cinc_invoice_id, cinc_dup_invoice_id, pushed_at, pushed_by, drive_file_id,
  hold_requested_items, hold_ticket_id, hold_requested_at, hold_note,
  created_at, updated_at
`.replace(/\s+/g, ' ').trim()

// The select string is built at runtime, so the Supabase client can't infer a
// row type and widens each row to its GenericStringError union. We only touch
// pdf_storage_key here (after the query error is already handled), so a narrow
// row shape is enough to keep the rest typed as a plain object.
type IntakeDraftRow = { pdf_storage_key: string | null } & Record<string, unknown>

export async function GET(req: Request) {
  const url       = new URL(req.url)
  const status    = url.searchParams.get('status') ?? 'pending_review'
  const search    = (url.searchParams.get('search') ?? '').trim()
  const limitRaw  = parseInt(url.searchParams.get('limit') ?? '50', 10)
  const limit     = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50

  if (!search && status !== 'all' && !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: `invalid status "${status}"` }, { status: 400 })
  }

  let query = supabaseAdmin
    .from('invoice_intake_drafts')
    .select(SELECT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(search ? 100 : limit)

  if (search) {
    // Cross-status search (any tab): invoice #, vendor, association, account #,
    // description — plus exact amount when the term is numeric. PostgREST .or()
    // uses '*' as the ilike wildcard; sanitize commas/wildcards out of the term.
    const term = search.replace(/[,%*()]/g, ' ').trim()
    const pat  = `*${term}*`
    const ors  = [
      `extracted_invoice_number.ilike.${pat}`,
      `matched_vendor_name.ilike.${pat}`,
      `matched_vendor_short_name.ilike.${pat}`,
      `extracted_association_code.ilike.${pat}`,
      `extracted_account_number.ilike.${pat}`,
      `extracted_description.ilike.${pat}`,
    ]
    const num = parseFloat(term.replace(/[^0-9.]/g, ''))
    if (Number.isFinite(num) && num > 0) ors.push(`extracted_amount.eq.${num}`)
    query = query.or(ors.join(','))
  }
  // 'Pending review' folds in no-vendor + CINC-duplicate drafts (no separate
  // tabs); the audit checklist handles vendor assignment + the duplicate guard.
  else if (status === 'pending_review') query = query.in('status', ['pending_review', 'needs_vendor', 'duplicate_in_cinc'])
  else if (status !== 'all')            query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach a signed preview URL per draft (same as the server page load),
  // so the PDF preview survives client refetches instead of blanking out.
  const rows = (data ?? []) as unknown as IntakeDraftRow[]
  const signed = await buildSignedUrls(
    rows.map(d => d.pdf_storage_key).filter(Boolean) as string[],
  )
  const draftsWithUrls = rows.map(d => ({
    ...d,
    pdf_signed_url: d.pdf_storage_key ? (signed.get(d.pdf_storage_key) ?? null) : null,
  }))

  // Side counts per status so the dashboard tabs can show pill numbers.
  const { data: counts } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('status')
  const countsByStatus: Record<string, number> = {}
  for (const row of (counts ?? [])) {
    countsByStatus[row.status as string] = (countsByStatus[row.status as string] ?? 0) + 1
  }

  return NextResponse.json({ drafts: draftsWithUrls, counts: countsByStatus })
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
  extracted_account_number?:   string | null
  extracted_description?:      string | null
  due_date?:                   string | null
  scheduled_pay_date?:         string | null
  gl_account_id?:              string | null
  gl_account_name?:            string | null
  pay_by_type?:                string | null
  observation_note?:           string | null
  work_order_number?:          number | null
  wo_partial_payment?:         boolean | null
  pay_from_bank_account_id?:   number | null
  audit_checklist?:            Record<string, boolean> | null
  status?:                     string   // 'ready_to_push' | 'pending_review'
}

async function staffEmail(): Promise<string | null> {
  const t = (await cookies()).get(SESSION_COOKIE)?.value
  const s = t ? await verifySession(t) : null
  if (s?.persona !== 'staff') return null
  return typeof s.userId === 'string' && s.userId.includes('@') ? s.userId.toLowerCase() : 'staff'
}

export async function PATCH(req: Request) {
  let body: PatchBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (!body.id || !Number.isFinite(body.id)) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  // Terminal-state guard. An invoice that's already in CINC is the source of
  // truth — editing it here (or reverting its status) would desync MAIA from
  // CINC and, worse, drop it back into the review queue where it could be
  // PUSHED A SECOND TIME. That's exactly the bug that let a pushed invoice
  // reappear under "pending review". A rejected draft is likewise terminal.
  const { data: current, error: curErr } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('status, cinc_invoice_id')
    .eq('id', body.id)
    .single()
  if (curErr || !current) return NextResponse.json({ error: curErr?.message ?? 'not found' }, { status: 404 })
  if (current.status === 'pushed_to_cinc' || current.cinc_invoice_id) {
    return NextResponse.json({ error: 'Already pushed to CINC (invoice ' + (current.cinc_invoice_id ?? '?') + ') — it can no longer be edited here.' }, { status: 409 })
  }
  if (current.status === 'rejected') {
    return NextResponse.json({ error: 'This draft was rejected and can no longer be edited.' }, { status: 409 })
  }

  // Only write keys that were actually included in the request body.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const writable: Array<keyof PatchBody> = [
    'matched_cinc_vendor_id', 'matched_vendor_name', 'matched_vendor_short_name',
    'extracted_invoice_number', 'extracted_amount',
    'extracted_association_code', 'extracted_invoice_date',
    'extracted_account_number', 'extracted_description',
    'due_date', 'scheduled_pay_date',
    'gl_account_id', 'gl_account_name',
    'pay_by_type', 'observation_note', 'work_order_number', 'wo_partial_payment',
    'pay_from_bank_account_id', 'audit_checklist',
  ]
  for (const k of writable) {
    if (k in body) patch[k as string] = body[k] ?? null
  }
  // Explicit audit-status transitions (sent by the "mark ready" / "un-ready"
  // buttons): ready_to_push stamps who/when; pending_review clears the stamp.
  if (body.status === 'ready_to_push') {
    patch.status = 'ready_to_push'
    patch.audit_ready_by = await staffEmail()
    patch.audit_ready_at = new Date().toISOString()
  } else if (body.status === 'pending_review') {
    patch.status = 'pending_review'
    patch.audit_ready_by = null
    patch.audit_ready_at = null
  } else {
    // No explicit status in the body — this is a field edit / checklist tweak.
    //   • Assigning a vendor to a no-vendor draft promotes it to review.
    //   • Editing any field on an already-"ready" draft INVALIDATES the audit:
    //     send it back to pending_review and clear the ready stamp so it must
    //     be re-confirmed (previously it reverted but kept a stale stamp).
    if (current.status === 'needs_vendor' && body.matched_cinc_vendor_id) {
      patch.status = 'pending_review'
    } else if (current.status === 'ready_to_push') {
      patch.status = 'pending_review'
      patch.audit_ready_by = null
      patch.audit_ready_at = null
    }
  }

  const { data, error } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .update(patch)
    .eq('id', body.id)
    .select(SELECT_COLUMNS)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Re-attach the preview URL so the card keeps showing the PDF after an edit.
  const row = (data ?? null) as unknown as IntakeDraftRow | null
  // On Transfer-to-Push (ready_to_push): just email Karen it's ready for her
  // approval. The Drive mirror is NO LONGER done here — it happens only when
  // Karen presses "Push to CINC", so the renamed PDF lands in INVOICE TO INPUT
  // exactly for invoices that were actually pushed.
  const driveWarning: string | null = null
  const driveFileId:  string | null = (row?.drive_file_id as string | null) ?? null
  if (patch.status === 'ready_to_push' && row) {
    void notifyKarenReady(row, (patch.audit_ready_by as string | null) ?? null).catch(() => null)
  }
  const signed = row?.pdf_storage_key ? await buildSignedUrls([row.pdf_storage_key]) : null
  const draft = { ...row, drive_file_id: driveFileId, pdf_signed_url: row?.pdf_storage_key ? (signed?.get(row.pdf_storage_key) ?? null) : null }
  return NextResponse.json({ draft, driveWarning })
}
