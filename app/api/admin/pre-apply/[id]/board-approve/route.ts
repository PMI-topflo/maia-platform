// POST /api/admin/pre-apply/[id]/board-approve   { dryRun }
// The board's approval action for an application, run by MAIA. It does NOT
// re-scan the Drive folder (that duplicated files) — it uses exactly what staff
// already reviewed and saved to MAIA:
//   1. COPY the SAVED keeper documents (one per checklist item — Deed/Lease/HO-6/
//      Certificate of Use/Governing-Docs Ack/Board Approval/Decision Page/
//      Affidavit/Agreement) into the unit's OFFICIAL folder, each named by its
//      approved "file as" name. Non-keepers (IDs, tax returns, pay stubs) are
//      NOT copied.
//   2. MOVE the whole On Going folder into OLD/Archive under the unit (full
//      history preserved) and trash the emptied wrapper.
//   3. Best-effort: extract tenant + lease term from the lease keeper; mark
//      approved.
// dryRun=true returns the plan only — NOTHING changes. Staff-only; prod creds.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { extractLeaseDetails } from '@/lib/lease-extract'
import { mirrorBufferToFolder } from '@/lib/drive-application-mirror'
import { INTAKE_BUCKET } from '@/lib/preapply'
import { DRIVE_FOLDERS, resolveUnitFolder, resolveDatedSubfolder, approvalCategoryFolder, stripNoFilesTag } from '@/lib/drive-organize-folders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// The documents that belong in the Official (clean, current) record. Everything
// else stays in Archive only.
const KEEPER_DOC_KEYS = new Set([
  'signed_lease', 'property_insurance', 'certificate_of_use', 'board_decision_page',
  'tenant_affidavit', 'landlord_tenant_agreement', 'board_approval_letter',
  'purchase_agreement', 'deed', 'ownership', 'governing_docs_ack', 'hoa_estoppel',
])

// The immediate children (files + subfolders) of the On Going unit folder — the
// whole lot is moved to Archive on approval.
async function listChildren(rootId: string): Promise<{ id: string; name: string }[]> {
  const drive = getDrive()
  const res = await drive.files.list({
    q: `'${rootId}' in parents and trashed = false`,
    fields: 'files(id, name)', pageSize: 400, supportsAllDrives: true, includeItemsFromAllDrives: true,
  })
  return (res.data.files ?? []).map(f => ({ id: f.id as string, name: f.name ?? '' }))
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

  // 1. Use the SAVED documents (what staff reviewed), NOT a re-scan. Keeper
  //    items → Official; one per checklist item, deduped, with the approved name.
  const { data: docs } = await supabaseAdmin.from('application_documents')
    .select('id, doc_key, doc_label, storage_path, filename, suggested_name, mime_type')
    .eq('application_id', id).order('created_at', { ascending: true })
  const byKey = new Map<string, { doc_key: string; doc_label: string; storage_path: string; filename: string; suggested_name: string | null; mime_type: string | null }>()
  for (const d of docs ?? []) if (d.doc_key && !byKey.has(String(d.doc_key))) byKey.set(String(d.doc_key), d as never)
  const keepers = [...byKey.values()].filter(d => KEEPER_DOC_KEYS.has(d.doc_key))
  const keeperName = (d: { suggested_name: string | null; filename: string }) => (d.suggested_name && d.suggested_name.trim()) || d.filename

  if (dryRun) {
    return NextResponse.json({
      ok: true, dryRun: true, unitRef,
      toOfficial: keepers.map(k => ({ from: k.doc_label, as: keeperName(k), docType: k.doc_label })),
      toArchiveOnly: [...byKey.values()].filter(d => !KEEPER_DOC_KEYS.has(d.doc_key)).map(d => ({ name: d.doc_label, docType: d.doc_label })),
      archiveInto: `OLD / Archive → ${unitRef} (the whole On Going folder is moved there)`,
      totalFiles: (docs ?? []).length,
    })
  }

  // ── EXECUTE ────────────────────────────────────────────────────────
  const drive = getDrive()
  const done = { copiedToOfficial: 0, movedToArchive: 0, errors: [] as string[] }

  // 2. Copy the saved keeper documents into the unit's Official folder.
  try {
    const officialUnit = await resolveUnitFolder(DRIVE_FOLDERS.official, unitRef, true)
    if (officialUnit) {
      const meta = await drive.files.get({ fileId: officialUnit, fields: 'name', supportsAllDrives: true }).catch(() => null)
      if (meta?.data.name && /NO FILES YET/i.test(meta.data.name)) await drive.files.update({ fileId: officialUnit, requestBody: { name: stripNoFilesTag(meta.data.name) }, supportsAllDrives: true }).catch(() => null)
      const catId = await resolveDatedSubfolder(officialUnit, approvalCategoryFolder(kind), true)
      const dest = catId ?? officialUnit
      for (const k of keepers) {
        try {
          const { data: blob } = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(k.storage_path)
          if (!blob) { done.errors.push(`missing file for ${k.doc_label}`); continue }
          await mirrorBufferToFolder(dest, keeperName(k), k.mime_type ?? 'application/octet-stream', Buffer.from(await blob.arrayBuffer()))
          done.copiedToOfficial++
        } catch (e) { done.errors.push(`copy ${k.doc_label}: ${e instanceof Error ? e.message : String(e)}`) }
      }
    } else done.errors.push('could not resolve the Official unit folder')
  } catch (e) { done.errors.push(`Official: ${e instanceof Error ? e.message : String(e)}`) }

  // 3. Move the whole On Going folder (all children) into Archive/<unit>.
  try {
    const children = await listChildren(onGoingId)
    const archiveUnit = await resolveUnitFolder(DRIVE_FOLDERS.archive, unitRef, true)
    if (archiveUnit) {
      for (const ch of children) {
        try {
          const m = await drive.files.get({ fileId: ch.id, fields: 'parents', supportsAllDrives: true })
          await drive.files.update({ fileId: ch.id, addParents: archiveUnit, removeParents: (m.data.parents ?? []).join(',') || undefined, supportsAllDrives: true })
          done.movedToArchive++
        } catch (e) { done.errors.push(`move ${ch.name}: ${e instanceof Error ? e.message : String(e)}`) }
      }
      await drive.files.update({ fileId: onGoingId, requestBody: { trashed: true }, supportsAllDrives: true }).catch(() => null)
    } else done.errors.push('could not resolve the Archive unit folder')
  } catch (e) { done.errors.push(`Archive: ${e instanceof Error ? e.message : String(e)}`) }

  // 4. Best-effort: extract tenant + lease term from the saved lease keeper.
  try {
    const lease = keepers.find(k => k.doc_key === 'signed_lease')
    if (lease && kind === 'lease') {
      const { data: blob } = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(lease.storage_path)
      const d = blob ? await extractLeaseDetails(Buffer.from(await blob.arrayBuffer()), lease.mime_type) : null
      if (d && (d.tenantNames.length || d.leaseEnd)) {
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
