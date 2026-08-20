// =====================================================================
// lib/board-approve.ts
//
// approval_sent -> approved, fully automatic: the instant every signer has
// signed the board decision letter, MAIA runs the exact same filing steps
// the manual "Approve" button already ran —
//   1. COPY the SAVED keeper documents (one per checklist item — Deed/Lease/
//      HO-6/Certificate of Use/Governing-Docs Ack/Board Approval/Decision
//      Page/Affidavit/Agreement) into the unit's OFFICIAL folder, each named
//      by its approved "file as" name. Non-keepers (IDs, tax returns, pay
//      stubs) are NOT copied.
//   2. MOVE the whole On Going folder into OLD/Archive under the unit (full
//      history preserved) and trash the emptied wrapper.
//   3. Best-effort: extract tenant + lease term from the lease keeper; mark
//      approved.
// User direction, 2026-08-20: "Move forward, I want all fully automatic."
//
// Extracted out of app/api/admin/pre-apply/[id]/board-approve/route.ts so
// the automatic and manual paths can never diverge — that route now calls
// into this same function for its real (non-preview) run. dryRun stays
// supported here (not just in the route) so the preview reads off the exact
// same keeper computation as the real run, instead of a second copy that
// could drift.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { extractLeaseDetails } from '@/lib/lease-extract'
import { mirrorBufferToFolder } from '@/lib/drive-application-mirror'
import { INTAKE_BUCKET } from '@/lib/preapply'
import { resolveAssocDriveFolders, resolveUnitRef, resolveUnitFolder, resolveDatedSubfolder, approvalCategoryFolder, stripNoFilesTag } from '@/lib/drive-organize-folders'

const TYPE_TAG: Record<string, string> = {
  lease: 'Lease', lease_renewal: 'LeaseRenewal', purchase: 'Purchase', additional_occupant: 'AdditionalOccupant',
}

export const KEEPER_DOC_KEYS = new Set([
  'signed_lease', 'property_insurance', 'certificate_of_use', 'board_decision_page',
  'tenant_affidavit', 'landlord_tenant_agreement', 'board_approval_letter',
  'purchase_agreement', 'signed_purchase', 'deed', 'ownership', 'governing_docs_ack', 'hoa_estoppel',
  'occupant_affidavit', 'lease_addendum',
])

const KEEPER_TO_COMPLIANCE: Record<string, string> = {
  signed_lease: 'unit.leasing', lease_addendum: 'unit.leasing', property_insurance: 'unit.ho6', certificate_of_use: 'unit.lauderhill_cou',
  governing_docs_ack: 'unit.rules_ack', landlord_tenant_agreement: 'unit.landlord_tenant_agreement',
  deed: 'unit.ownership', ownership: 'unit.ownership',
}

interface KeeperDoc { doc_key: string; doc_label: string; storage_path: string; filename: string; suggested_name: string | null; mime_type: string | null; expiration_date: string | null; no_expiration: boolean }

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

async function listChildren(rootId: string): Promise<{ id: string; name: string }[]> {
  const drive = getDrive()
  const res = await drive.files.list({
    q: `'${rootId}' in parents and trashed = false`,
    fields: 'files(id, name)', pageSize: 400, supportsAllDrives: true, includeItemsFromAllDrives: true,
  })
  return (res.data.files ?? []).map(f => ({ id: f.id as string, name: f.name ?? '' }))
}

export interface BoardApprovePreview {
  ok: true; dryRun: true; unitRef: string
  toOfficial: { from: string; as: string; docType: string }[]
  toArchiveOnly: { name: string; docType: string }[]
  archiveInto: string
  totalFiles: number
}
export interface BoardApproveResult {
  ok: true; dryRun: false; unitRef: string
  copiedToOfficial: number; movedToArchive: number; errors: string[]
}
export type BoardApproveOutcome = BoardApprovePreview | BoardApproveResult | { error: string }

export async function runBoardApprove(applicationId: string, opts: { dryRun?: boolean; approvedByRole?: 'onsite_manager' | 'board' | 'staff' } = {}): Promise<BoardApproveOutcome> {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, association_code, unit_label, application_type, status, drive_folder_id').eq('id', applicationId).maybeSingle()
  if (!app) return { error: 'application not found' }
  // Idempotency guard for the automatic path — an application that somehow
  // reaches here already approved (e.g. re-triggered) is a no-op, not a
  // second archive run against an already-emptied On Going folder.
  if (!opts.dryRun && app.status === 'approved') return { error: 'already approved' }

  // The board's signature IS the decision (see lib/esign.ts's completion
  // hook, the normal way this function is reached). A manual EXECUTE must
  // require the same thing — otherwise this button lets staff file to
  // Official and archive the folder before the board has actually signed
  // anything, which defeats the point of the automatic, signature-driven
  // trigger. Preview (dryRun) is unaffected — it's read-only and useful to
  // sanity-check before the board has signed.
  if (!opts.dryRun) {
    const unitLabel = String(app.unit_label ?? '')
    const { data: letter } = await supabaseAdmin.from('esign_documents')
      .select('status').eq('kind', 'board_decision')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const fallbackLetter = letter ? null : (await supabaseAdmin.from('esign_documents')
      .select('status').eq('kind', 'board_decision').eq('association_code', String(app.association_code)).eq('unit_ref', unitLabel)
      .neq('status', 'void').order('created_at', { ascending: false }).limit(1).maybeSingle()).data
    const current = letter ?? fallbackLetter
    if (!current || current.status !== 'completed') {
      return { error: 'The board decision letter has not been fully signed yet — nothing to file until every signer has signed.' }
    }
  }

  const unitRef = await resolveUnitRef(String(app.association_code), app.unit_label as string | null)
  const assocFolders = await resolveAssocDriveFolders(String(app.association_code))
  if (!assocFolders.official || !assocFolders.archive) {
    return { error: `${app.association_code} has no Official/Archive Drive folders configured — set them on the association before approving.` }
  }
  const kind = app.application_type === 'purchase' ? 'purchase' : 'lease'
  const onGoingId = String(app.drive_folder_id ?? '')
  if (!onGoingId) return { error: 'This application has no On Going Drive folder linked yet.' }

  const { data: docs } = await supabaseAdmin.from('application_documents')
    .select('id, doc_key, doc_label, storage_path, filename, suggested_name, mime_type, expiration_date, no_expiration')
    .eq('application_id', applicationId).order('created_at', { ascending: true })
  const byKey = new Map<string, KeeperDoc>()
  for (const d of docs ?? []) if (d.doc_key && !byKey.has(String(d.doc_key))) byKey.set(String(d.doc_key), d as unknown as KeeperDoc)
  const keepers = [...byKey.values()].filter(d => KEEPER_DOC_KEYS.has(d.doc_key))
  const keeperName = (d: { suggested_name: string | null; filename: string }) => (d.suggested_name && d.suggested_name.trim()) || d.filename

  if (opts.dryRun) {
    return {
      ok: true, dryRun: true, unitRef,
      toOfficial: keepers.map(k => ({ from: k.doc_label, as: keeperName(k), docType: k.doc_label })),
      toArchiveOnly: [...byKey.values()].filter(d => !KEEPER_DOC_KEYS.has(d.doc_key)).map(d => ({ name: d.doc_label, docType: d.doc_label })),
      archiveInto: `OLD / Archive → ${unitRef} (the whole On Going folder is moved there)`,
      totalFiles: (docs ?? []).length,
    }
  }

  const drive = getDrive()
  const done = { copiedToOfficial: 0, movedToArchive: 0, errors: [] as string[] }

  try {
    const officialUnit = await resolveUnitFolder(assocFolders.official, unitRef, true)
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

  try {
    const children = await listChildren(onGoingId)
    const archiveUnit = await resolveUnitFolder(assocFolders.archive, unitRef, true)
    if (archiveUnit) {
      const typeTag = (TYPE_TAG[String(app.application_type ?? '')] ?? '').trim()
      for (const ch of children) {
        try {
          const m = await drive.files.get({ fileId: ch.id, fields: 'parents', supportsAllDrives: true })
          const name = String(ch.name ?? '')
          const needsTag = typeTag && !new RegExp(typeTag, 'i').test(name)
          await drive.files.update({
            fileId: ch.id, addParents: archiveUnit, removeParents: (m.data.parents ?? []).join(',') || undefined,
            ...(needsTag ? { requestBody: { name: `${name}_${typeTag}` } } : {}),
            supportsAllDrives: true,
          })
          done.movedToArchive++
        } catch (e) { done.errors.push(`move ${ch.name}: ${e instanceof Error ? e.message : String(e)}`) }
      }
      await drive.files.update({ fileId: onGoingId, requestBody: { trashed: true }, supportsAllDrives: true }).catch(() => null)
    } else done.errors.push('could not resolve the Archive unit folder')
  } catch (e) { done.errors.push(`Archive: ${e instanceof Error ? e.message : String(e)}`) }

  await fileUnitRecords(applicationId, String(app.association_code), unitRef, kind, keepers, done.errors)

  await supabaseAdmin.from('listing_applications').update({
    status: 'approved', reviewed_at: new Date().toISOString(), approved_by_role: opts.approvedByRole ?? 'board', updated_at: new Date().toISOString(),
  }).eq('id', applicationId)

  return { ok: true, dryRun: false, unitRef, copiedToOfficial: done.copiedToOfficial, movedToArchive: done.movedToArchive, errors: done.errors }
}
