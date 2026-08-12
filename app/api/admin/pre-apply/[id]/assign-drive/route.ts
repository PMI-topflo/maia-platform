// POST /api/admin/pre-apply/[id]/assign-drive
//   { doc_key, doc_label, fileId, fileName, mimeType }
// Assign a specific file from the linked On Going Drive folder to a checklist
// item (Replace-from-Drive / the manual match for anything the auto-scan
// missed, e.g. the board approval letter). Reads the file, copies it into the
// app-docs bucket, records the document with the YYYY_MM_Type rename + reads its
// expiration. Non-destructive to Drive. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { downloadDriveFile } from '@/lib/drive-import'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { quickDocScan } from '@/lib/quick-doc-classify'
import { INTAKE_BUCKET, autoRosterFromLease } from '@/lib/preapply'
import { PDFDocument } from 'pdf-lib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// "3-4,6" (1-based, inclusive) → 0-based page indices within [0,total).
function parsePages(spec: string, total: number): number[] {
  const out: number[] = []
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/)
    if (m) { for (let n = Number(m[1]); n <= Number(m[2]); n++) if (n >= 1 && n <= total) out.push(n - 1) }
    else { const n = parseInt(part.trim(), 10); if (n >= 1 && n <= total) out.push(n - 1) }
  }
  return [...new Set(out)]
}
async function extractPages(buf: Buffer, spec: string): Promise<Buffer | null> {
  try {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true })
    const idx = parsePages(spec, src.getPageCount())
    if (idx.length === 0) return null
    const out = await PDFDocument.create()
    const pages = await out.copyPages(src, idx)
    pages.forEach(p => out.addPage(p))
    return Buffer.from(await out.save())
  } catch { return null }
}

const TYPE_TOKEN: Record<string, string> = {
  signed_lease: 'Lease', signed_purchase: 'Purchase', lease_addendum: 'LeaseAddendum',
  drivers_license: 'ID', car_registration: 'VehicleReg', vehicle_insurance: 'VehicleInsurance',
  landlord_email: 'LandlordEmail', tax_returns_2yr: 'TaxReturns', property_insurance: 'Insurance', certificate_of_use: 'LauderhillCert',
  board_decision_page: 'DecisionPage', tenant_affidavit: 'Affidavit', occupant_affidavit: 'OccupantAffidavit',
  landlord_tenant_agreement: 'Agreement', board_approval_letter: 'BoardApproval',
  deed: 'Deed', ownership: 'Ownership', governing_docs_ack: 'RulesAck', hoa_estoppel: 'Estoppel',
  background_credit: 'BackgroundCredit', emergency_contact: 'EmergencyContacts', pet_esa_documents: 'AnimalDocs',
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: app } = await supabaseAdmin.from('listing_applications').select('id, listing_id, drive_folder_id').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 })

  let b: { doc_key?: string; doc_label?: string; fileId?: string; fileName?: string; mimeType?: string; pages?: string; keepName?: boolean; stakeholder_id?: string; allow_multiple?: boolean }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const docKey = String(b.doc_key ?? '').trim()
  const stakeholderId = String(b.stakeholder_id ?? '').trim() || null
  const allowMultiple = b.allow_multiple === true
  const fileId = String(b.fileId ?? '').trim()
  const fileName = String(b.fileName ?? 'file.pdf')
  const mimeType = String(b.mimeType ?? 'application/pdf')
  const pageSpec = String(b.pages ?? '').trim()
  const keepName = b.keepName === true
  if (!docKey || !fileId) return NextResponse.json({ error: 'doc_key and fileId required' }, { status: 400 })

  // Confirm the file really lives in this application's Drive folder (or subfolders).
  const drive = getDrive()
  try {
    const meta = await drive.files.get({ fileId, fields: 'id', supportsAllDrives: true })
    if (!meta.data.id) throw new Error('not found')
  } catch { return NextResponse.json({ error: 'That file is not accessible.' }, { status: 400 }) }

  let buf: Buffer
  try { buf = await downloadDriveFile(fileId) } catch (e) { return NextResponse.json({ error: `Could not read the file: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 }) }

  // Optional: pull only the given pages out of a multi-document PDF (e.g. a
  // combined report where pages 3-4 are the W-2). The extracted pages become the
  // document for this item — the original file is untouched.
  let isPdf = mimeType.includes('pdf') || buf.subarray(0, 5).toString('latin1') === '%PDF-'
  let extractedPages: number | null = null
  if (pageSpec && isPdf) {
    const sub = await extractPages(buf, pageSpec)
    if (!sub) return NextResponse.json({ error: `Could not extract pages "${pageSpec}" — check the range.` }, { status: 200 })
    buf = sub; isPdf = true
    extractedPages = (await PDFDocument.load(sub)).getPageCount()
  }

  const scan = await quickDocScan(buf, isPdf ? 'application/pdf' : mimeType).catch(() => ({ label: 'other', expiration: null as string | null }))
  const outMime = extractedPages != null ? 'application/pdf' : mimeType
  const ext = extractedPages != null ? '.pdf' : (fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '.pdf')
  const outName = extractedPages != null ? `${fileName.replace(/\.[^.]+$/, '')} (p.${pageSpec}).pdf` : fileName
  // Per-applicant docs append the person to the name so columns stay distinct.
  let nameSuffix = ''
  if (stakeholderId) {
    const { data: shRow } = await supabaseAdmin.from('application_stakeholders').select('name').eq('id', stakeholderId).maybeSingle()
    const nm = String((shRow?.name as string | null) ?? '').trim()
    if (nm) nameSuffix = ` — ${nm}`
  }
  const rename = keepName ? outName : `${new Date().getUTCFullYear()}_${String(new Date().getUTCMonth() + 1).padStart(2, '0')}_${TYPE_TOKEN[docKey] ?? 'Document'}${nameSuffix}${ext}`
  const path = `intake/${id}/${docKey.replace(/[^\w-]+/g, '_')}/${crypto.randomUUID()}${ext}`
  const up = await supabaseAdmin.storage.from(INTAKE_BUCKET).upload(path, buf, { contentType: outMime, upsert: true })
  if (up.error) return NextResponse.json({ error: `upload failed: ${up.error.message}` }, { status: 500 })

  if (!allowMultiple) {
    const del = supabaseAdmin.from('application_documents').delete().eq('application_id', id).eq('doc_key', docKey)
    await (stakeholderId ? del.eq('stakeholder_id', stakeholderId) : del.is('stakeholder_id', null))
  }
  const { error } = await supabaseAdmin.from('application_documents').insert({
    application_id: id, listing_id: app.listing_id, kind: 'other', doc_key: docKey, doc_label: String(b.doc_label ?? docKey),
    storage_path: path, filename: outName, suggested_name: rename, expiration_date: scan.expiration,
    mime_type: outMime, uploaded_by_role: 'drive-pick', stakeholder_id: stakeholderId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // A freshly-picked lease seeds the applicant roster (best-effort).
  if (docKey === 'signed_lease') await autoRosterFromLease(id)
  return NextResponse.json({ ok: true, rename, expiration: scan.expiration, extractedPages })
}
