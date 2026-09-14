// =====================================================================
// lib/application-withdraw.ts
//
// Withdraw an application that will not proceed (applicant backed out,
// sale fell through, owner changed plans). User request, 2026-09-13
// (MANXI 411): "Please cancel the application, the applicant has a
// personal issue" — MAIA had no cancel action; Delete only removes empty
// shells. Silent by design: no email goes out; staff reply themselves.
//
// What it does:
//   1. status → 'withdrawn' with who asked, why, when, and the staff name.
//      lib/preapply.ts's intakeClosed() then refuses uploads / answers on
//      every applicant link; the reminder crons only target submitted /
//      under_review, so they stop on their own.
//   2. Voids every e-sign document still waiting on this application (and
//      the unit's Landlord–Tenant packet), so nobody signs a dead paper.
//   3. Moves the On Going Drive folder into the unit's OLD/Archive, tagged
//      "WITHDRAWN", when the association has Archive folders configured.
//   Nothing is deleted: people, documents, messages and payments stay.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { resolveAssocDriveFolders, resolveUnitRef, resolveUnitFolder } from '@/lib/drive-organize-folders'

export interface WithdrawInput { reason: string; requestedBy: string; by: string }
export interface WithdrawResult { ok: true; voidedEsign: number; voidedPackets: number; driveMoved: number; driveError: string | null }

/** Withdrawn = one of the parties asked. Expired = nobody did: the request
 *  went stale (lease long over, no answer to reminders, a mistaken start)
 *  and staff close it during housekeeping (user, 2026-09-14). Same
 *  mechanics, different word on the record and on the Drive folder. */
export type CloseMode = 'withdrawn' | 'expired'

export async function withdrawApplication(applicationId: string, input: WithdrawInput): Promise<WithdrawResult | { error: string }> {
  return closeApplication(applicationId, { ...input, mode: 'withdrawn' })
}

export async function expireApplication(applicationId: string, input: { reason: string; by: string }): Promise<WithdrawResult | { error: string }> {
  return closeApplication(applicationId, { reason: input.reason, requestedBy: 'PMI housekeeping', by: input.by, mode: 'expired' })
}

export async function closeApplication(applicationId: string, input: WithdrawInput & { mode: CloseMode }): Promise<WithdrawResult | { error: string }> {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, association_code, unit_label, status, drive_folder_id').eq('id', applicationId).maybeSingle()
  if (!app) return { error: 'application not found' }
  if (app.status === 'approved') return { error: 'This application is already approved — an approved application is not closed this way; contact the board about rescinding the approval.' }
  if (app.status === 'withdrawn' || app.status === 'expired') return { error: `This application is already ${app.status}.` }
  const reason = input.reason.trim()
  const requestedBy = input.requestedBy.trim()
  if (!reason) return { error: 'A reason is required — it goes on the record.' }
  if (!requestedBy) return { error: 'Say who asked for the withdrawal (applicant, owner, agent…).' }

  const now = new Date().toISOString()
  const code = String(app.association_code)
  const unit = (app.unit_label as string | null) ?? null
  const word = input.mode === 'expired' ? 'Expired' : 'Withdrawn'
  const tag = input.mode === 'expired' ? 'EXPIRED' : 'WITHDRAWN'

  // 1. The status. (withdrawn_* columns hold the record for both modes.)
  const { error: upErr } = await supabaseAdmin.from('listing_applications').update({
    status: input.mode, withdrawn_at: now, withdrawn_by: input.by, withdrawn_reason: `${requestedBy}: ${reason}`,
    review_note: `${word} ${now.slice(0, 10)} by ${input.by} — ${input.mode === 'expired' ? reason : `requested by ${requestedBy}: ${reason}`}`, updated_at: now,
  }).eq('id', applicationId)
  if (upErr) return { error: upErr.message }

  // 2. Void whatever is still waiting for a signature.
  let voidedEsign = 0, voidedPackets = 0
  const { data: es } = await supabaseAdmin.from('esign_documents').select('id').eq('application_id', applicationId).not('status', 'in', '("completed","void")')
  const esIds = (es ?? []).map(r => String(r.id))
  if (unit) {
    const { data: es2 } = await supabaseAdmin.from('esign_documents').select('id').eq('association_code', code).eq('unit_ref', unit).is('application_id', null).not('status', 'in', '("completed","void")')
    for (const r of es2 ?? []) esIds.push(String(r.id))
  }
  if (esIds.length) {
    const { error } = await supabaseAdmin.from('esign_documents').update({ status: 'void', updated_at: now }).in('id', [...new Set(esIds)])
    if (!error) voidedEsign = new Set(esIds).size
  }
  if (unit) {
    const accountGuess = `${code}${unit}`.toUpperCase()
    const { data: packets } = await supabaseAdmin.from('lease_packets').select('id').eq('association_code', code)
      .or(`unit_ref.eq.${unit},unit_ref.eq.${accountGuess}`).not('status', 'in', '("completed","void")')
    if (packets?.length) {
      const { error } = await supabaseAdmin.from('lease_packets').update({ status: 'void' }).in('id', packets.map(p => p.id))
      if (!error) voidedPackets = packets.length
    }
  }

  // 3. Drive: On Going → OLD/Archive under the unit, tagged WITHDRAWN / EXPIRED.
  const onGoingId = String(app.drive_folder_id ?? '')
  const { driveMoved, driveError } = onGoingId ? await moveOngoingFolderToArchive(code, unit, onGoingId, tag) : { driveMoved: 0, driveError: null }

  return { ok: true, voidedEsign, voidedPackets, driveMoved, driveError }
}

/** Move every file of an On Going application folder into the unit's
 *  OLD/Archive folder (created if needed), tag each file name, trash the
 *  emptied folder. Shared by withdraw / expire and the housekeeping page
 *  (orphan folders of already-approved applications). Never throws. */
export async function moveOngoingFolderToArchive(code: string, unit: string | null, onGoingId: string, tag: string): Promise<{ driveMoved: number; driveError: string | null }> {
  let driveMoved = 0, driveError: string | null = null
  try {
    const drive = getDrive()
    const folders = await resolveAssocDriveFolders(code)
    const unitRef = await resolveUnitRef(code, unit)
    const archiveUnit = folders.archive ? await resolveUnitFolder(folders.archive, unitRef, true) : null
    if (!archiveUnit) {
      driveError = 'no Archive folder configured for this association — the On Going folder was left in place'
    } else {
      const { data: list } = await drive.files.list({ q: `'${onGoingId}' in parents and trashed = false`, fields: 'files(id,name,parents)', supportsAllDrives: true, includeItemsFromAllDrives: true })
      const re = new RegExp(tag, 'i')
      for (const f of list.files ?? []) {
        try {
          const name = String(f.name ?? '')
          await drive.files.update({
            fileId: String(f.id), addParents: archiveUnit, removeParents: (f.parents ?? []).join(',') || undefined,
            ...(re.test(name) ? {} : { requestBody: { name: `${name}_${tag}` } }), supportsAllDrives: true,
          })
          driveMoved++
        } catch (e) { driveError = e instanceof Error ? e.message : String(e) }
      }
      await drive.files.update({ fileId: onGoingId, requestBody: { trashed: true }, supportsAllDrives: true }).catch(() => null)
    }
  } catch (e) { driveError = e instanceof Error ? e.message : String(e) }
  return { driveMoved, driveError }
}

/** Undo a withdraw / expire done by mistake: the application goes back to
 *  where it was (submitted if it ever was, else started). The Drive files
 *  are NOT moved back — they sit in the unit's Archive tagged; the next
 *  upload recreates an On Going folder. */
export async function reopenApplication(applicationId: string, by: string): Promise<{ ok: true; status: string } | { error: string }> {
  const { data: app } = await supabaseAdmin.from('listing_applications').select('id, status, submitted_at, review_note').eq('id', applicationId).maybeSingle()
  if (!app) return { error: 'application not found' }
  if (app.status !== 'withdrawn' && app.status !== 'expired') return { error: `Only a withdrawn or expired application can be reopened (this one is ${app.status}).` }
  const status = app.submitted_at ? 'submitted' : 'started'
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin.from('listing_applications').update({
    status, withdrawn_at: null, withdrawn_by: null, withdrawn_reason: null, drive_folder_id: null, drive_folder_url: null,
    review_note: `Reopened ${now.slice(0, 10)} by ${by} (was ${app.status}). ${String(app.review_note ?? '')}`.trim(), updated_at: now,
  }).eq('id', applicationId)
  if (error) return { error: error.message }
  return { ok: true, status }
}
