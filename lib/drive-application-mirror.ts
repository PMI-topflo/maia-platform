// =====================================================================
// lib/drive-application-mirror.ts
//
// Mirrors a Pre-Application intake's uploaded documents into Google Drive under
// "Unit Docs - On Going Applications" (DRIVE_FOLDERS.ongoing). MAIA creates the
// per-unit subfolder automatically — staff never pre-create per-unit folders;
// they only keep the one parent shared with the service account (Editor).
//
// Folder shape:  Unit Docs - On Going Applications / "Unit 103 - Querline Lazard"
// Runs server-side with the Drive service account (prod-only creds).
// =====================================================================

import { Readable } from 'stream'
import { getDrive, serviceAccountEmail } from '@/lib/drive-invoice-mirror'
import { DRIVE_FOLDERS } from '@/lib/drive-organize-folders'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getIntake, INTAKE_BUCKET } from '@/lib/preapply'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

async function findOrCreateSubfolder(name: string, parentId: string): Promise<string> {
  const drive = getDrive()
  const esc = name.replace(/'/g, "\\'")
  const found = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and name = '${esc}' and trashed = false`,
    fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true,
  })
  const hit = found.data.files?.[0]?.id
  if (hit) return hit
  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: 'id', supportsAllDrives: true,
  })
  if (!created.data.id) throw new Error('Drive returned no folder id')
  return created.data.id
}

/** Find or create the per-unit subfolder under "On Going Applications". */
export async function ensureOngoingUnitFolder(opts: { unitLabel: string; applicantName?: string | null; rootId?: string }): Promise<{ folderId: string; webViewLink: string }> {
  const root = opts.rootId ?? DRIVE_FOLDERS.ongoing
  const name = [`Unit ${opts.unitLabel}`.trim(), opts.applicantName?.trim()].filter(Boolean).join(' - ')
  const folderId = await findOrCreateSubfolder(name, root)
  const meta = await getDrive().files.get({ fileId: folderId, fields: 'webViewLink', supportsAllDrives: true }).catch(() => null)
  return { folderId, webViewLink: meta?.data.webViewLink ?? `https://drive.google.com/drive/folders/${folderId}` }
}

/** Mirror ONE file into a unit's "On Going Applications" subfolder (created if
 *  needed). Used when staff upload a document they received by email straight
 *  into an in-process application. Best-effort — never throws. */
export async function mirrorFileToOngoing(opts: {
  unitLabel: string; applicantName?: string | null; label: string; filename: string; mime: string | null; buffer: Buffer
}): Promise<{ ok: boolean; folderId?: string; folderUrl?: string; error?: string }> {
  try {
    const { folderId, webViewLink } = await ensureOngoingUnitFolder({ unitLabel: opts.unitLabel, applicantName: opts.applicantName })
    const ext = opts.filename.includes('.') ? opts.filename.slice(opts.filename.lastIndexOf('.')) : ''
    const label = opts.label.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Document'
    await mirrorBufferToFolder(folderId, `${label}${ext}`, opts.mime ?? 'application/octet-stream', opts.buffer)
    return { ok: true, folderId, folderUrl: webViewLink }
  } catch (err) {
    const base = err instanceof Error ? err.message : String(err)
    const sa = serviceAccountEmail()
    const hint = /not found|permission|forbidden|403|404/i.test(base) && sa
      ? ` — share the "On Going Applications" folder with ${sa} (Editor).` : ''
    return { ok: false, error: `${base}${hint}` }
  }
}

/** Upload one buffer into a Drive folder, retrying transient failures. */
export async function mirrorBufferToFolder(folderId: string, filename: string, mime: string, buffer: Buffer): Promise<string> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await getDrive().files.create({
        requestBody: { name: filename, parents: [folderId] },
        media: { mimeType: mime || 'application/octet-stream', body: Readable.from(buffer) },
        fields: 'id', supportsAllDrives: true,
      })
      if (!res.data.id) throw new Error('Drive returned no file id')
      return res.data.id
    } catch (err) { lastErr = err; if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 600)) }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** Mirror every uploaded document of an intake into its unit's On Going
 *  Applications subfolder, prefixing each file with its checklist label so the
 *  folder reads cleanly. Records the folder on the application. Best-effort:
 *  returns a result but never throws (the caller shouldn't fail submit on a
 *  Drive blip). */
export async function mirrorIntakeToDrive(applicationId: string): Promise<{ ok: boolean; folderUrl?: string; mirrored?: number; error?: string }> {
  try {
    const intake = await getIntake(applicationId)
    if (!intake) return { ok: false, error: 'intake not found' }
    const unitLabel = intake.unitLabel || intake.applicationId.slice(0, 8)
    const { folderId, webViewLink } = await ensureOngoingUnitFolder({ unitLabel, applicantName: intake.applicant?.name })

    const { data: docs } = await supabaseAdmin.from('application_documents')
      .select('doc_key, doc_label, storage_path, filename, mime_type').eq('application_id', applicationId)
    let mirrored = 0
    for (const d of docs ?? []) {
      const { data: blob } = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(String(d.storage_path))
      if (!blob) continue
      const buf = Buffer.from(await blob.arrayBuffer())
      const label = String(d.doc_label ?? d.doc_key ?? 'document').replace(/[\\/:*?"<>|]+/g, '_')
      const orig = String(d.filename ?? 'file')
      const ext = orig.includes('.') ? orig.slice(orig.lastIndexOf('.')) : ''
      const name = `${label}${ext}`
      try { await mirrorBufferToFolder(folderId, name, String(d.mime_type ?? 'application/octet-stream'), buf); mirrored++ }
      catch { /* keep going; one bad file shouldn't block the rest */ }
    }

    await supabaseAdmin.from('listing_applications').update({ drive_folder_id: folderId, drive_folder_url: webViewLink, updated_at: new Date().toISOString() }).eq('id', applicationId)
    return { ok: true, folderUrl: webViewLink, mirrored }
  } catch (err) {
    const base = err instanceof Error ? err.message : String(err)
    const sa = serviceAccountEmail()
    const hint = /not found|permission|forbidden|403|404/i.test(base) && sa
      ? ` — share the "On Going Applications" folder with ${sa} (Editor).` : ''
    return { ok: false, error: `${base}${hint}` }
  }
}

// ── Approved unit compliance docs → the unit's OFFICIAL Drive folder ─────────
// When staff file an owner-uploaded (or any) UNIT compliance document in the
// Document Inbox, mirror the source file into the unit's canonical folder under
// "Unit Docs - 2026 Maia Official Files", renamed YYYY_MM_Type so the Drive
// record stays clean without the manual Organize pass. Best-effort — never
// throws (a Drive blip must not fail the filing). MANXI-only for now (the only
// association with an Official Drive tree configured).

/** 'YYYY_MM' for a date, or null. */
export function driveDateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  return `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const FOLDER_TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease Renewal', additional_occupant: 'Additional Occupant', ownership_transfer: 'Ownership Transfer', occupancy_registration: 'Occupancy Registration' }

/** Rename an application's On-Going Drive folder to "<ASSOC>### — <Type> — <Applicants>"
 *  so the folder name says the application type + who's on it (fixes bare
 *  "YYYY_MM_Name" folders). Best-effort — prod-only Drive; never throws. */
export async function renameApplicationFolder(applicationId: string): Promise<void> {
  try {
    const { data: app } = await supabaseAdmin.from('listing_applications')
      .select('association_code, unit_label, application_type, drive_folder_id').eq('id', applicationId).maybeSingle()
    const fid = String(app?.drive_folder_id ?? '')
    if (!fid) return
    const { data: sh } = await supabaseAdmin.from('application_stakeholders')
      .select('name, is_primary, created_at').eq('application_id', applicationId).eq('role', 'applicant')
      .order('is_primary', { ascending: false }).order('created_at', { ascending: true })
    const names = (sh ?? []).map(s => String(s.name ?? '').trim()).filter(Boolean)
    const unitRef = `${String(app?.association_code ?? '').toUpperCase()}${String(app?.unit_label ?? '').replace(/\D/g, '')}`
    const label = FOLDER_TYPE_LABEL[String(app?.application_type ?? '')] ?? String(app?.application_type ?? '')
    const name = [unitRef, label, names.join(' & ')].filter(Boolean).join(' — ').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 200)
    if (name) await getDrive().files.update({ fileId: fid, requestBody: { name }, supportsAllDrives: true })
  } catch { /* prod-only Drive; never fails the caller */ }
}

/** A clean file-name type token from the doc type / compliance item key. */
export function driveTypeLabel(docType: string | null | undefined, itemKey: string | null | undefined): string {
  const raw = (docType && docType.trim()) || (itemKey ? itemKey.split('.').pop() ?? itemKey : '') || 'Document'
  return raw.replace(/[\\/:*?"<>|]+/g, ' ').replace(/[_\s]+/g, ' ').trim().replace(/\s/g, '_').slice(0, 60) || 'Document'
}
