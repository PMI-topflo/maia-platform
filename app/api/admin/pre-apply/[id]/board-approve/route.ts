// POST /api/admin/pre-apply/[id]/board-approve   { dryRun }
// The board's approval action for an application, run by MAIA:
//   1. SCAN each file in the unit's On Going Applications folder by CONTENT
//      (filenames are often raw scans) and classify it.
//   2. COPY the keepers — Deed/Ownership, Lease (incl. Landlord–Tenant),
//      HO-6 Insurance, Certificate of Use, Governing-Docs Acknowledgement, and
//      the Board Approval — into the unit's OFFICIAL folder, renamed
//      YYYY_MM_<Type>. Non-keepers (IDs, tax returns, etc.) are NOT copied.
//   3. MOVE everything (the whole application folder) into OLD/Archive under the
//      unit's folder — the full history is preserved, off the On Going list.
//   4. Best-effort: extract the tenant + lease term from the lease into the
//      unit's tenant record, and mark the application approved.
//
// dryRun=true does 1 only and returns the plan — NOTHING in Drive or the DB
// changes. Staff-only; runs as the Drive service account (prod creds).

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { downloadDriveFile } from '@/lib/drive-import'
import { classifyDocument, type AssociationRef } from '@/lib/document-classifier'
import { extractLeaseDetails } from '@/lib/lease-extract'
import { driveDateLabel } from '@/lib/drive-application-mirror'
import { DRIVE_FOLDERS, resolveUnitFolder, resolveDatedSubfolder, approvalCategoryFolder, stripNoFilesTag } from '@/lib/drive-organize-folders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const FOLDER_MIME = 'application/vnd.google-apps.folder'

// The keeper set the user defined. Maps a classified document to its Official
// file-name type — or null when it is NOT a keeper (stays in Archive only).
function keeperType(haystack: string): string | null {
  const n = haystack.toLowerCase()
  if (/\b(deed|ownership|warranty|title|quit\s*claim|grant\s*deed)\b/.test(n)) return 'Deed'
  if (/(certificate of use|cert(ificate)? of use|lauderhill|\bc\.?o\.?u\b)/.test(n)) return 'LauderhillCert'
  if (/(ho-?6|home\s*owner|homeowner|hazard|dwelling|insurance|policy|declaration page|declarations page|binder)/.test(n)) return 'Insurance'
  if (/(landlord|tenant agreement|lease|rental agreement)/.test(n)) return 'Lease'
  if (/(governing|acknowledg|by-?laws|rules?\s*(&|and)?\s*regulations|declaration of condominium)/.test(n)) return 'GoverningDocsAck'
  if (/(board approv|approval letter|estoppel)/.test(n)) return 'BoardApproval'
  return null
}

interface DriveFile { id: string; name: string; mimeType: string; createdTime: string | null }

// Every file under a folder at any depth (application docs often sit in a
// dated subfolder), plus the immediate children (files + folders) for the move.
async function listDeep(rootId: string): Promise<{ files: DriveFile[]; children: { id: string; name: string; isFolder: boolean }[] }> {
  const drive = getDrive()
  const files: DriveFile[] = []
  const children: { id: string; name: string; isFolder: boolean }[] = []
  let frontier = [rootId]; const seen = new Set<string>(); let guard = 0
  while (frontier.length && guard < 300) {
    const next: string[] = []
    for (const fid of frontier) {
      if (seen.has(fid)) continue; seen.add(fid); guard++
      const res = await drive.files.list({
        q: `'${fid}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType, createdTime)', pageSize: 200, supportsAllDrives: true, includeItemsFromAllDrives: true,
      })
      for (const f of res.data.files ?? []) {
        if (fid === rootId) children.push({ id: f.id as string, name: f.name ?? '', isFolder: f.mimeType === FOLDER_MIME })
        if (f.mimeType === FOLDER_MIME) next.push(f.id as string)
        else files.push({ id: f.id as string, name: f.name ?? '', mimeType: f.mimeType ?? 'application/octet-stream', createdTime: (f.createdTime as string | null) ?? null })
      }
    }
    frontier = next
  }
  return { files, children }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  let body: { dryRun?: boolean }
  try { body = await req.json() } catch { body = {} }
  const dryRun = body.dryRun !== false   // default to a SAFE dry run

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, association_code, unit_label, application_type, status, drive_folder_id').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 })
  const unitRef = `MANXI${String(app.unit_label ?? '').replace(/\D/g, '')}`
  const kind = app.application_type === 'purchase' ? 'purchase' : 'lease'
  const onGoingId = String(app.drive_folder_id ?? '')
  if (!onGoingId) return NextResponse.json({ error: 'This application has no On Going Drive folder linked yet.' }, { status: 400 })

  // 1. Scan + classify every file by content.
  const { files, children } = await listDeep(onGoingId)
  const assocs: AssociationRef[] = []   // classifier doesn't need the assoc list for a keeper decision
  const scanned: { id: string; name: string; mimeType: string; createdTime: string | null; docType: string | null; keeper: string | null; newName: string }[] = []
  for (const f of files) {
    let docType: string | null = null
    let classText = ''
    try {
      const buf = await downloadDriveFile(f.id)
      const c = await classifyDocument(buf, f.mimeType, assocs, 1, `On Going application file for ${unitRef}, filename "${f.name}"`)
      docType = c.items?.[0]?.doc_type ?? c.summary ?? null
      classText = [c.summary, ...(c.items ?? []).map(it => `${it.doc_type ?? ''} ${it.category ?? ''}`)].filter(Boolean).join(' ')
    } catch { /* fall back to the filename below */ }
    const hay = [classText, f.name].filter(Boolean).join(' ')
    const type = keeperType(hay)
    const ext = f.name.includes('.') ? f.name.slice(f.name.lastIndexOf('.')) : '.pdf'
    const ym = driveDateLabel(f.createdTime) ?? new Date().toISOString().slice(0, 7).replace('-', '_')
    scanned.push({ id: f.id, name: f.name, mimeType: f.mimeType, createdTime: f.createdTime, docType, keeper: type, newName: type ? `${ym}_${type}${ext}` : f.name })
  }
  const keepers = scanned.filter(s => s.keeper)

  if (dryRun) {
    return NextResponse.json({
      ok: true, dryRun: true, unitRef,
      toOfficial: keepers.map(k => ({ from: k.name, as: k.newName, docType: k.docType })),
      toArchiveOnly: scanned.filter(s => !s.keeper).map(s => ({ name: s.name, docType: s.docType })),
      archiveInto: `OLD / Archive → ${unitRef}`,
      totalFiles: scanned.length,
    })
  }

  // ── EXECUTE ────────────────────────────────────────────────────────
  const drive = getDrive()
  const done = { copiedToOfficial: 0, movedToArchive: 0, errors: [] as string[] }

  // 2. Copy keepers into the unit's Official folder (category subfolder).
  try {
    const officialUnit = await resolveUnitFolder(DRIVE_FOLDERS.official, unitRef, true)
    if (officialUnit) {
      const meta = await drive.files.get({ fileId: officialUnit, fields: 'name', supportsAllDrives: true }).catch(() => null)
      if (meta?.data.name && /NO FILES YET/i.test(meta.data.name)) await drive.files.update({ fileId: officialUnit, requestBody: { name: stripNoFilesTag(meta.data.name) }, supportsAllDrives: true }).catch(() => null)
      const catId = await resolveDatedSubfolder(officialUnit, approvalCategoryFolder(kind), true)
      const dest = catId ?? officialUnit
      for (const k of keepers) {
        try { await drive.files.copy({ fileId: k.id, requestBody: { name: k.newName, parents: [dest] }, fields: 'id', supportsAllDrives: true }); done.copiedToOfficial++ }
        catch (e) { done.errors.push(`copy ${k.name}: ${e instanceof Error ? e.message : String(e)}`) }
      }
    } else done.errors.push('could not resolve the Official unit folder')
  } catch (e) { done.errors.push(`Official: ${e instanceof Error ? e.message : String(e)}`) }

  // 3. Move the whole application folder (all children) into Archive/<unit>.
  try {
    const archiveUnit = await resolveUnitFolder(DRIVE_FOLDERS.archive, unitRef, true)
    if (archiveUnit) {
      for (const ch of children) {
        try {
          const m = await drive.files.get({ fileId: ch.id, fields: 'parents', supportsAllDrives: true })
          await drive.files.update({ fileId: ch.id, addParents: archiveUnit, removeParents: (m.data.parents ?? []).join(',') || undefined, supportsAllDrives: true })
          done.movedToArchive++
        } catch (e) { done.errors.push(`move ${ch.name}: ${e instanceof Error ? e.message : String(e)}`) }
      }
      // Trash the now-empty On Going wrapper so it leaves the On Going list.
      await drive.files.update({ fileId: onGoingId, requestBody: { trashed: true }, supportsAllDrives: true }).catch(() => null)
    } else done.errors.push('could not resolve the Archive unit folder')
  } catch (e) { done.errors.push(`Archive: ${e instanceof Error ? e.message : String(e)}`) }

  // 4. Best-effort: extract tenant + lease term from the lease keeper.
  try {
    const lease = keepers.find(k => k.keeper === 'Lease')
    if (lease && kind === 'lease') {
      const buf = await downloadDriveFile(lease.id)
      const d = await extractLeaseDetails(buf, lease.mimeType)
      if (d.tenantNames.length || d.leaseEnd) {
        await supabaseAdmin.from('unit_tenant_contacts').upsert({
          association_code: String(app.association_code), unit_ref: unitRef,
          tenant_name: d.tenantNames.join(' & ') || null, tenant_email: d.tenantEmail, tenant_phone: d.tenantPhone,
          lease_start: d.leaseStart, lease_end: d.leaseEnd, updated_by: 'staff: board approval', updated_at: new Date().toISOString(),
        }, { onConflict: 'association_code,unit_ref' })
      }
    }
  } catch (e) { done.errors.push(`lease extract: ${e instanceof Error ? e.message : String(e)}`) }

  // 5. Mark approved.
  await supabaseAdmin.from('listing_applications').update({
    status: 'approved', reviewed_at: new Date().toISOString(), approved_by_role: 'board', updated_at: new Date().toISOString(),
  }).eq('id', id)

  return NextResponse.json({ ok: true, dryRun: false, unitRef, ...done })
}
