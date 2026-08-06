// POST /api/admin/pre-apply/[id]/scan-drive
// Read the files already sitting in the application's linked On Going Drive
// folder, classify each by CONTENT (filenames are raw scans), match it to a
// checklist item, and import it as an application document — so a folder brought
// in from Drive fills in its own document checklist instead of re-uploading by
// hand. Non-destructive: copies Drive → the app-docs bucket + records the row;
// nothing in Drive changes. Staff-only; runs as the prod Drive service account.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { downloadDriveFile } from '@/lib/drive-import'
import { quickDocScan } from '@/lib/quick-doc-classify'
import { getIntakeChecklist, isApplicationType, type ApplicationType } from '@/lib/intake-documents'
import { INTAKE_BUCKET } from '@/lib/preapply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const FOLDER_MIME = 'application/vnd.google-apps.folder'

// Canonical tokens so a classified file and a checklist label can be compared.
function tokens(text: string): Set<string> {
  const n = ` ${text.toLowerCase()} `
  const t = new Set<string>()
  if (/(landlord.?tenant|landlord–tenant)/.test(n)) t.add('agreement')
  if (/(signed lease|lease agreement|rental agreement|\blease\b|tenancy)/.test(n)) t.add('lease')
  if (/(vehicle|auto|automobile|\bcar\b|motor)/.test(n)) t.add('vehicle')
  if (/(propert|homeowner|home owner|ho-?6|dwelling|hazard)/.test(n)) t.add('property')
  if (/(insurance|policy|declaration|binder|coverage)/.test(n)) t.add('insurance')
  if (/(registration|registrat)/.test(n)) t.add('registration')
  if (/(driver|licen[sc]e|photo id|identification|passport|\bid\b|state id)/.test(n)) t.add('id')
  if (/(tax|1040|return|w-?2|1099)/.test(n)) t.add('tax')
  if (/(certificate of use|cert.{0,6}use|lauderhill|\bc\.?o\.?u\b)/.test(n)) t.add('certuse')
  if (/(email|correspond)/.test(n)) t.add('email')
  if (/(deed|ownership|title|warranty)/.test(n)) t.add('deed')
  if (/(governing|acknowledg|by-?laws|rules)/.test(n)) t.add('governing')
  if (/(decision page|board decision)/.test(n)) t.add('decision')
  if (/affidavit/.test(n)) t.add('affidavit')
  if (/(approval letter|board approv|estoppel)/.test(n)) t.add('approval')
  return t
}
function score(a: Set<string>, b: Set<string>): number { let s = 0; for (const x of a) if (b.has(x)) s++; return s }

interface DriveFile { id: string; name: string; mimeType: string; createdTime: string | null }
async function listDeep(rootId: string): Promise<DriveFile[]> {
  const drive = getDrive()
  const out: DriveFile[] = []
  let frontier = [rootId]; const seen = new Set<string>(); let guard = 0
  while (frontier.length && guard < 300) {
    const next: string[] = []
    for (const fid of frontier) {
      if (seen.has(fid)) continue; seen.add(fid); guard++
      const res = await drive.files.list({ q: `'${fid}' in parents and trashed = false`, fields: 'files(id, name, mimeType, createdTime)', pageSize: 200, supportsAllDrives: true, includeItemsFromAllDrives: true })
      for (const f of res.data.files ?? []) {
        if (f.mimeType === FOLDER_MIME) next.push(f.id as string)
        else out.push({ id: f.id as string, name: f.name ?? '', mimeType: f.mimeType ?? 'application/octet-stream', createdTime: (f.createdTime as string | null) ?? null })
      }
    }
    frontier = next
  }
  return out
}

// A unit-folder file name Type token per checklist item, for the YYYY_MM_Type
// suggested rename shown for staff to approve.
const TYPE_TOKEN: Record<string, string> = {
  signed_lease: 'Lease', drivers_license: 'ID', car_registration: 'VehicleReg', vehicle_insurance: 'VehicleInsurance',
  landlord_email: 'LandlordEmail', tax_returns_2yr: 'TaxReturns', property_insurance: 'Insurance', certificate_of_use: 'LauderhillCert',
  board_decision_page: 'DecisionPage', tenant_affidavit: 'Affidavit', landlord_tenant_agreement: 'Agreement',
}
const ym = (iso: string | null): string => {
  const d = iso ? new Date(iso) : new Date()
  return `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, listing_id, association_code, unit_label, application_type, drive_folder_id').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 })
  const folderId = String(app.drive_folder_id ?? '')
  if (!folderId) return NextResponse.json({ error: 'No Drive folder is linked to this application.' }, { status: 400 })
  const type = isApplicationType(String(app.application_type)) ? (app.application_type as ApplicationType) : 'lease'
  const checklist = await getIntakeChecklist(String(app.association_code), type)
  const items = checklist.map(c => ({ doc_key: c.doc_key, label: c.label, toks: tokens(c.label) }))

  let files: DriveFile[]
  try { files = await listDeep(folderId) }
  catch (e) { return NextResponse.json({ error: `Could not read the Drive folder: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 }) }

  // Which items already have a doc? Don't overwrite them on a re-scan.
  const { data: existingDocs } = await supabaseAdmin.from('application_documents').select('doc_key').eq('application_id', id)
  const taken = new Set((existingDocs ?? []).map(d => String(d.doc_key)))

  const matched: { file: string; item: string; rename: string; expiration: string | null }[] = []
  const unmatched: { file: string; docType: string | null }[] = []

  for (const f of files.slice(0, 40)) {
    let docType: string | null = null
    try {
      const buf = await downloadDriveFile(f.id)
      const scan = await quickDocScan(buf, f.mimeType)   // one Haiku call → { label, expiration }
      docType = scan.label
      const ftoks = tokens(`${scan.label} ${f.name}`)
      let best: typeof items[number] | null = null, bestScore = 0
      for (const it of items) { if (taken.has(it.doc_key)) continue; const s = score(ftoks, it.toks); if (s > bestScore) { bestScore = s; best = it } }
      if (best && bestScore >= 1) {
        const ext = f.name.includes('.') ? f.name.slice(f.name.lastIndexOf('.')) : '.pdf'
        const rename = `${ym(f.createdTime)}_${TYPE_TOKEN[best.doc_key] ?? 'Document'}${ext}`
        const path = `intake/${id}/${best.doc_key.replace(/[^\w-]+/g, '_')}/${crypto.randomUUID()}${ext}`
        const up = await supabaseAdmin.storage.from(INTAKE_BUCKET).upload(path, buf, { contentType: f.mimeType || 'application/pdf', upsert: true })
        if (!up.error) {
          await supabaseAdmin.from('application_documents').insert({
            application_id: id, listing_id: app.listing_id, kind: 'other', doc_key: best.doc_key, doc_label: best.label,
            storage_path: path, filename: f.name, suggested_name: rename, expiration_date: scan.expiration,
            mime_type: f.mimeType || 'application/pdf', uploaded_by_role: 'drive-scan',
          })
          taken.add(best.doc_key)
          matched.push({ file: f.name, item: best.label, rename, expiration: scan.expiration })
          continue
        }
      }
    } catch { /* fall through to unmatched */ }
    unmatched.push({ file: f.name, docType })
  }

  return NextResponse.json({ ok: true, scanned: files.length, matched, unmatched })
}
