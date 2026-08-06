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
import { INTAKE_BUCKET } from '@/lib/preapply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TYPE_TOKEN: Record<string, string> = {
  signed_lease: 'Lease', drivers_license: 'ID', car_registration: 'VehicleReg', vehicle_insurance: 'VehicleInsurance',
  landlord_email: 'LandlordEmail', tax_returns_2yr: 'TaxReturns', property_insurance: 'Insurance', certificate_of_use: 'LauderhillCert',
  board_decision_page: 'DecisionPage', tenant_affidavit: 'Affidavit', landlord_tenant_agreement: 'Agreement', board_approval_letter: 'BoardApproval',
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: app } = await supabaseAdmin.from('listing_applications').select('id, listing_id, drive_folder_id').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 })

  let b: { doc_key?: string; doc_label?: string; fileId?: string; fileName?: string; mimeType?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const docKey = String(b.doc_key ?? '').trim()
  const fileId = String(b.fileId ?? '').trim()
  const fileName = String(b.fileName ?? 'file.pdf')
  const mimeType = String(b.mimeType ?? 'application/pdf')
  if (!docKey || !fileId) return NextResponse.json({ error: 'doc_key and fileId required' }, { status: 400 })

  // Confirm the file really lives in this application's Drive folder (or subfolders).
  const drive = getDrive()
  try {
    const meta = await drive.files.get({ fileId, fields: 'id', supportsAllDrives: true })
    if (!meta.data.id) throw new Error('not found')
  } catch { return NextResponse.json({ error: 'That file is not accessible.' }, { status: 400 }) }

  let buf: Buffer
  try { buf = await downloadDriveFile(fileId) } catch (e) { return NextResponse.json({ error: `Could not read the file: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 }) }
  const scan = await quickDocScan(buf, mimeType).catch(() => ({ label: 'other', expiration: null as string | null }))

  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '.pdf'
  const rename = `${new Date().getUTCFullYear()}_${String(new Date().getUTCMonth() + 1).padStart(2, '0')}_${TYPE_TOKEN[docKey] ?? 'Document'}${ext}`
  const path = `intake/${id}/${docKey.replace(/[^\w-]+/g, '_')}/${crypto.randomUUID()}${ext}`
  const up = await supabaseAdmin.storage.from(INTAKE_BUCKET).upload(path, buf, { contentType: mimeType, upsert: true })
  if (up.error) return NextResponse.json({ error: `upload failed: ${up.error.message}` }, { status: 500 })

  await supabaseAdmin.from('application_documents').delete().eq('application_id', id).eq('doc_key', docKey)
  const { error } = await supabaseAdmin.from('application_documents').insert({
    application_id: id, listing_id: app.listing_id, kind: 'other', doc_key: docKey, doc_label: String(b.doc_label ?? docKey),
    storage_path: path, filename: fileName, suggested_name: rename, expiration_date: scan.expiration,
    mime_type: mimeType, uploaded_by_role: 'drive-pick',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, rename, expiration: scan.expiration })
}
