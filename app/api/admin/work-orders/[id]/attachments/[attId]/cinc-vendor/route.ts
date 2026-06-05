// =====================================================================
// GET  /api/admin/work-orders/[id]/attachments/[attId]/cinc-vendor
//        → preview: re-read the stored vendor doc (full, server-side),
//          diff against the current CINC vendor record, return MASKED
//          values for staff to confirm.
// POST   → apply: re-read full values server-side and PATCH the CINC
//          vendor record with the field keys staff approved.
//
// Security: full Routing/Account/EIN are NEVER returned to the browser
// or persisted — the client sends only which field KEYS to apply; the
// server re-extracts the full values transiently to write CINC.
//
// Scope (this version): ACH banking + W-9/1099 via PATCH /vendors/vendor.
// COI + license push are a fast follow.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { STORAGE_BUCKET } from '@/lib/work-order-attachments'
import { extractVendorDocument } from '@/lib/vendor-doc-extraction'
import { getCincVendorDetail, updateVendorRecord, type VendorRecordWrite } from '@/lib/integrations/cinc'
import { appendMessage } from '@/lib/tickets'

export const runtime = 'nodejs'

async function staff() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return null
  return typeof session.userId === 'string' ? session.userId : 'staff'
}

function mask4(v?: string | null): string | null {
  if (!v) return null
  const digits = String(v).replace(/\D/g, '')
  return digits.length >= 4 ? `••${digits.slice(-4)}` : '••••'
}

/** Map extracted fields → the CINC vendor write shape, per doc type.
 *  Returns the writable fields (full values) + a display label per field. */
function buildWrite(docType: string, f: Record<string, string>): {
  write: VendorRecordWrite
  labels: Record<string, string>
  display: Record<string, string | null>   // human text for non-secret fields (e.g. account type)
} {
  const write: VendorRecordWrite = {}
  const labels: Record<string, string> = {}
  const display: Record<string, string | null> = {}

  if (docType === 'ach') {
    const routing = f.routing_last4 ?? f.routing ?? f.routing_number
    const account = f.account_last4 ?? f.account ?? f.account_number
    const typeText = (f.account_type ?? '').toLowerCase()
    if (routing) { write.Routing = routing.replace(/\D/g, ''); labels.Routing = 'Routing #' }
    if (account) { write.Account = account.replace(/\D/g, ''); labels.Account = 'Account #' }
    if (typeText) {
      write.AccountType = typeText.includes('sav') ? 1 : 0
      labels.AccountType = 'Account type'
      display.AccountType = typeText.includes('sav') ? 'Savings' : 'Checking'
    }
  } else if (docType === 'w9') {
    const ein = f.ein_last4 ?? f.ssn_last4 ?? f.tax_id ?? f.taxid
    const name = f.legal_name ?? f.business_name
    if (ein)  { write.TaxID = ein.replace(/[^0-9-]/g, ''); labels.TaxID = 'Tax ID (EIN)' }
    if (name) { write.CheckName = name; labels.CheckName = 'Check name'; display.CheckName = name }
  }
  return { write, labels, display }
}

/** Load attachment + resolve the CINC VendorId from the work order. */
async function context(ticketId: number, attId: string) {
  const { data: att } = await supabaseAdmin
    .from('work_order_attachments')
    .select('id, ticket_id, storage_path, filename, mime_type, extracted_doc_type')
    .eq('id', attId).eq('ticket_id', ticketId).maybeSingle()
  if (!att) return { error: 'attachment not found', status: 404 as const }

  const { data: wod } = await supabaseAdmin
    .from('work_order_details').select('cinc_vendor_id, vendor_name').eq('ticket_id', ticketId).maybeSingle()
  return { att, vendorId: wod?.cinc_vendor_id ?? null, vendorName: wod?.vendor_name ?? null }
}

async function reextract(storagePath: string, filename: string, mime: string | null) {
  const { data: blob, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(storagePath)
  if (error || !blob) throw new Error(error?.message ?? 'could not download stored file')
  const buf = Buffer.from(await blob.arrayBuffer())
  return extractVendorDocument(buf, filename, mime, { mask: false })   // FULL values, transient
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; attId: string }> }) {
  if (!await staff()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, attId } = await ctx.params
  const ticketId = Number(id)
  if (!Number.isFinite(ticketId)) return NextResponse.json({ error: 'bad id' }, { status: 400 })

  const cx = await context(ticketId, attId)
  if ('error' in cx) return NextResponse.json({ error: cx.error }, { status: cx.status })
  const docType = cx.att.extracted_doc_type ?? 'other'
  if (docType !== 'ach' && docType !== 'w9') {
    return NextResponse.json({ unsupported: true, docType, message: 'Only ACH and W-9 push are available right now (COI & license coming soon).' })
  }
  if (!cx.vendorId) {
    return NextResponse.json({ needsVendor: true, message: 'This work order has no CINC vendor linked yet. Assign the vendor on the work order first.' })
  }

  let ext
  try { ext = await reextract(cx.att.storage_path, cx.att.filename, cx.att.mime_type) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }) }
  if (!ext) return NextResponse.json({ error: 'Could not read the document.' }, { status: 502 })

  const { write, labels, display } = buildWrite(docType, ext.fields)
  const currentDetail = await getCincVendorDetail(cx.vendorId).catch(() => null)
  const current = currentDetail as Record<string, unknown> | null

  // Build a MASKED diff for the browser. Account/Routing/TaxID are masked;
  // account-type + names shown in clear.
  const secret = new Set(['Routing', 'Account', 'TaxID'])
  const rows = Object.keys(write).map(key => {
    const newVal = (write as Record<string, unknown>)[key]
    const curRaw = current ? (current as Record<string, unknown>)[key] : null
    const isSecret = secret.has(key)
    const newShown = isSecret ? mask4(String(newVal)) : (display[key] ?? String(newVal))
    const curShown = key === 'AccountType'
      ? (curRaw === 1 ? 'Savings' : curRaw === 0 ? 'Checking' : null)
      : isSecret ? mask4(curRaw == null ? null : String(curRaw)) : (curRaw == null ? null : String(curRaw))
    const changed = String(curShown ?? '') !== String(newShown ?? '')
    return { key, label: labels[key] ?? key, current: curShown, extracted: newShown, changed }
  })

  return NextResponse.json({
    vendorId: cx.vendorId,
    vendorName: currentDetail?.VendorName ?? cx.vendorName,
    docType,
    applicableKeys: Object.keys(write),
    rows,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string; attId: string }> }) {
  const me = await staff()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, attId } = await ctx.params
  const ticketId = Number(id)
  if (!Number.isFinite(ticketId)) return NextResponse.json({ error: 'bad id' }, { status: 400 })

  let body: { keys?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === 'string') : []
  if (keys.length === 0) return NextResponse.json({ error: 'Select at least one field to apply.' }, { status: 400 })

  const cx = await context(ticketId, attId)
  if ('error' in cx) return NextResponse.json({ error: cx.error }, { status: cx.status })
  if (!cx.vendorId) return NextResponse.json({ error: 'No CINC vendor linked to this work order.' }, { status: 409 })
  const docType = cx.att.extracted_doc_type ?? 'other'
  if (docType !== 'ach' && docType !== 'w9') return NextResponse.json({ error: 'Unsupported document type.' }, { status: 400 })

  let ext
  try { ext = await reextract(cx.att.storage_path, cx.att.filename, cx.att.mime_type) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }) }
  if (!ext) return NextResponse.json({ error: 'Could not read the document.' }, { status: 502 })

  const { write, labels } = buildWrite(docType, ext.fields)
  // Keep only the fields staff approved.
  const approved: VendorRecordWrite = {}
  for (const k of keys) {
    if (k in write) (approved as Record<string, unknown>)[k] = (write as Record<string, unknown>)[k]
  }
  if (Object.keys(approved).length === 0) {
    return NextResponse.json({ error: 'None of the selected fields are available on this document.' }, { status: 400 })
  }

  try {
    await updateVendorRecord(cx.vendorId, approved)
  } catch (e) {
    return NextResponse.json({ error: `CINC update failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  // Audit note — list which fields were written (NOT the values).
  const written = Object.keys(approved).map(k => labels[k] ?? k).join(', ')
  await appendMessage(ticketId, {
    direction: 'internal_note', channel: 'internal',
    from_addr: `MAIA (${me})`,
    body: `✅ Applied ${docType === 'ach' ? 'ACH banking' : 'W-9'} to the CINC vendor record (VendorId ${cx.vendorId}): ${written}. Source: ${cx.att.filename}.`,
  }).catch(() => null)

  return NextResponse.json({ ok: true, written: Object.keys(approved) })
}
