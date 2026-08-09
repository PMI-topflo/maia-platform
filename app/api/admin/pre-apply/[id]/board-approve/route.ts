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
  'occupant_affidavit', 'lease_addendum',   // additional-occupant applications
])

// Approved keeper document → the unit compliance item it satisfies, so the
// unit's "Documents on file" reflects the approval.
const KEEPER_TO_COMPLIANCE: Record<string, string> = {
  signed_lease: 'unit.leasing', lease_addendum: 'unit.leasing', property_insurance: 'unit.ho6', certificate_of_use: 'unit.lauderhill_cou',
  governing_docs_ack: 'unit.rules_ack', landlord_tenant_agreement: 'unit.landlord_tenant_agreement',
  deed: 'unit.ownership', ownership: 'unit.ownership',
}

interface KeeperDoc { doc_key: string; storage_path: string; mime_type: string | null; expiration_date: string | null; no_expiration: boolean }

// Write the unit's tenant record + compliance records from the approved keepers.
// Runs on both a fresh board approval and a "re-file" (so an already-approved
// unit can be caught up). Best-effort — collects errors, never throws.
async function fileUnitRecords(appId: string, associationCode: string, unitRef: string, kind: string, keepers: KeeperDoc[], errors: string[]): Promise<void> {
  const now = new Date().toISOString()
  if (kind === 'lease') try {
    const lease = keepers.find(k => k.doc_key === 'signed_lease')
    const { data: primarySh } = await supabaseAdmin.from('application_stakeholders').select('name, email, phone').eq('application_id', appId).eq('is_primary', true).maybeSingle()
    let d: Awaited<ReturnType<typeof extractLeaseDetails>> | null = null
    if (lease) { const { data: blob } = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(lease.storage_path); d = blob ? await extractLeaseDetails(Buffer.from(await blob.arrayBuffer()), lease.mime_type) : null }
    const tenantName = (d?.tenantNames.length ? d.tenantNames.join(' & ') : null) || (primarySh?.name as string | null) || null
    const email = d?.tenantEmail || (primarySh?.email as string | null) || null
    const phone = d?.tenantPhone || (primarySh?.phone as string | null) || null
    if (tenantName || email || phone || d?.leaseEnd) {
      await supabaseAdmin.from('unit_tenant_contacts').upsert({
        association_code: associationCode, unit_ref: unitRef, tenant_name: tenantName, tenant_email: email, tenant_phone: phone,
        lease_start: d?.leaseStart ?? null, lease_end: d?.leaseEnd ?? null, updated_by: 'staff: board approval', updated_at: now,
      }, { onConflict: 'association_code,unit_ref' })
    }
  } catch (e) { errors.push(`tenant record: ${e instanceof Error ? e.message : String(e)}`) }

  for (const k of keepers) {
    const item = KEEPER_TO_COMPLIANCE[k.doc_key]
    if (!item) continue
    const exp = k.no_expiration ? null : (k.expiration_date ?? null)
    const status = exp && new Date(exp) < new Date() ? 'expiring' : 'current'
    await supabaseAdmin.from('compliance_records').upsert({
      scope: 'unit', association_code: associationCode, unit_ref: unitRef, item_key: item,
      applicable: true, status, expiry_date: exp, updated_by: 'staff: board approval', updated_at: now,
    }, { onConflict: 'scope,association_code,unit_ref,item_key' }).then(() => null, () => null)
  }
}

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
  let body: { dryRun?: boolean; refileOfficial?: boolean }
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
    .select('id, doc_key, doc_label, storage_path, filename, suggested_name, mime_type, expiration_date, no_expiration')
    .eq('application_id', id).order('created_at', { ascending: true })
  const byKey = new Map<string, { doc_key: string; doc_label: string; storage_path: string; filename: string; suggested_name: string | null; mime_type: string | null; expiration_date: string | null; no_expiration: boolean }>()
  for (const d of docs ?? []) if (d.doc_key && !byKey.has(String(d.doc_key))) byKey.set(String(d.doc_key), d as never)
  const keepers = [...byKey.values()].filter(d => KEEPER_DOC_KEYS.has(d.doc_key))
  const keeperName = (d: { suggested_name: string | null; filename: string }) => (d.suggested_name && d.suggested_name.trim()) || d.filename

  // Recovery: TRASH whatever is in the unit's Official category subfolder and
  // re-copy the clean saved keepers — fixes a folder that an earlier run filled
  // with duplicates/misclassified files. Scoped to that one subfolder; trash is
  // reversible from Drive.
  if (body.refileOfficial) {
    const drive = getDrive()
    const done = { trashed: 0, copiedToOfficial: 0, errors: [] as string[] }
    try {
      const officialUnit = await resolveUnitFolder(DRIVE_FOLDERS.official, unitRef, true)
      if (!officialUnit) return NextResponse.json({ error: 'could not resolve the Official unit folder' }, { status: 200 })
      const catId = await resolveDatedSubfolder(officialUnit, approvalCategoryFolder(kind), true)
      const dest = catId ?? officialUnit
      for (const ch of await listChildren(dest)) {
        try { await drive.files.update({ fileId: ch.id, requestBody: { trashed: true }, supportsAllDrives: true }); done.trashed++ }
        catch (e) { done.errors.push(`trash ${ch.name}: ${e instanceof Error ? e.message : String(e)}`) }
      }
      for (const k of keepers) {
        try {
          const { data: blob } = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(k.storage_path)
          if (!blob) { done.errors.push(`missing file for ${k.doc_label}`); continue }
          await mirrorBufferToFolder(dest, keeperName(k), k.mime_type ?? 'application/octet-stream', Buffer.from(await blob.arrayBuffer()))
          done.copiedToOfficial++
        } catch (e) { done.errors.push(`copy ${k.doc_label}: ${e instanceof Error ? e.message : String(e)}`) }
      }
    } catch (e) { done.errors.push(String(e instanceof Error ? e.message : e)) }
    // Also catch up the unit's tenant record + compliance filing.
    await fileUnitRecords(id, String(app.association_code), unitRef, kind, keepers, done.errors)
    return NextResponse.json({ ok: true, refiled: true, unitRef, ...done })
  }

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

  // 4. Write the unit's tenant record + compliance filing from the keepers.
  await fileUnitRecords(id, String(app.association_code), unitRef, kind, keepers, done.errors)

  // 5. Mark approved.
  await supabaseAdmin.from('listing_applications').update({
    status: 'approved', reviewed_at: new Date().toISOString(), approved_by_role: 'board', updated_at: new Date().toISOString(),
  }).eq('id', id)

  return NextResponse.json({ ok: true, dryRun: false, unitRef, ...done })
}
