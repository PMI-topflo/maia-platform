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
  'pending_review', 'ready_to_push', 'needs_vendor', 'duplicate_in_cinc', 'pushed_to_cinc', 'rejected',
])

const SELECT_COLUMNS = `
  id, gmail_message_id, pdf_storage_key, ticket_id,
  extracted_vendor_name, matched_cinc_vendor_id, matched_vendor_name, matched_vendor_short_name,
  extracted_invoice_number, extracted_amount, extracted_association_code, extracted_invoice_date,
  due_date, scheduled_pay_date,
  gl_account_id, gl_account_name,
  pay_by_type, observation_note, work_order_number,
  pay_from_bank_account_id,
  extraction_confidence, status, rejected_reason,
  audit_checklist, audit_ready_by, audit_ready_at,
  cinc_invoice_id, cinc_dup_invoice_id, pushed_at, pushed_by,
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

  // 'Pending review' folds in no-vendor + CINC-duplicate drafts (no separate
  // tabs); the audit checklist handles vendor assignment + the duplicate guard.
  if (status === 'pending_review')      query = query.in('status', ['pending_review', 'needs_vendor', 'duplicate_in_cinc'])
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
  due_date?:                   string | null
  scheduled_pay_date?:         string | null
  gl_account_id?:              string | null
  gl_account_name?:            string | null
  pay_by_type?:                string | null
  observation_note?:           string | null
  work_order_number?:          number | null
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

  // Only write keys that were actually included in the request body.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const writable: Array<keyof PatchBody> = [
    'matched_cinc_vendor_id', 'matched_vendor_name', 'matched_vendor_short_name',
    'extracted_invoice_number', 'extracted_amount',
    'extracted_association_code', 'extracted_invoice_date',
    'due_date', 'scheduled_pay_date',
    'gl_account_id', 'gl_account_name',
    'pay_by_type', 'observation_note', 'work_order_number',
    'pay_from_bank_account_id', 'audit_checklist',
  ]
  for (const k of writable) {
    if (k in body) patch[k as string] = body[k] ?? null
  }
  // If Karen assigned a vendor, drop the needs_vendor status.
  if ('matched_cinc_vendor_id' in body && body.matched_cinc_vendor_id) {
    patch.status = 'pending_review'
  }
  // Audit-status transitions: ready_to_push stamps who/when; reverting to
  // pending_review (un-readying for more edits) clears the stamp.
  if (body.status === 'ready_to_push') {
    patch.status = 'ready_to_push'
    patch.audit_ready_by = await staffEmail()
    patch.audit_ready_at = new Date().toISOString()
  } else if (body.status === 'pending_review') {
    patch.status = 'pending_review'
    patch.audit_ready_by = null
    patch.audit_ready_at = null
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
  // Notify Karen when a non-Karen staffer just marked this ready (best-effort).
  if (patch.status === 'ready_to_push' && row) {
    void notifyKarenReady(row, (patch.audit_ready_by as string | null) ?? null).catch(() => null)
  }
  const signed = row?.pdf_storage_key ? await buildSignedUrls([row.pdf_storage_key]) : null
  const draft = { ...row, pdf_signed_url: row?.pdf_storage_key ? (signed?.get(row.pdf_storage_key) ?? null) : null }
  return NextResponse.json({ draft })
}
