// POST /api/admin/pre-apply/[id]/board-approve   { dryRun }
// The board's approval action for an application, run by MAIA — now also
// triggered automatically the instant the board decision letter finishes
// signing (lib/esign.ts calls lib/board-approve.ts's runBoardApprove
// directly). This route stays as the manual staff-facing entry point (dry
// run preview, and a manual re-run if the automatic one needs a retry).
// dryRun=true returns the plan only — NOTHING changes. Staff-only; prod creds.
//
// refileOfficial (below) is a separate staff-only recovery tool — TRASH
// what's in the unit's Official category subfolder and re-copy the clean
// saved keepers, for a folder an earlier run filled with duplicates. Not
// part of the automatic approval flow.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { mirrorBufferToFolder } from '@/lib/drive-application-mirror'
import { INTAKE_BUCKET } from '@/lib/preapply'
import { resolveAssocDriveFolders, resolveUnitRef, resolveUnitFolder, resolveDatedSubfolder, approvalCategoryFolder } from '@/lib/drive-organize-folders'
import { runBoardApprove, KEEPER_DOC_KEYS } from '@/lib/board-approve'
import { handoffOnApproval } from '@/lib/application-handoff'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

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

  if (body.refileOfficial) {
    const { data: app } = await supabaseAdmin.from('listing_applications')
      .select('id, association_code, unit_label, application_type').eq('id', id).maybeSingle()
    if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 })
    const unitRef = await resolveUnitRef(String(app.association_code), app.unit_label as string | null)
    const assocFolders = await resolveAssocDriveFolders(String(app.association_code))
    if (!assocFolders.official) return NextResponse.json({ error: `${app.association_code} has no Official Drive folder configured.` }, { status: 400 })
    const kind = app.application_type === 'purchase' ? 'purchase' : 'lease'

    const { data: docs } = await supabaseAdmin.from('application_documents')
      .select('id, doc_key, doc_label, storage_path, filename, suggested_name, mime_type, expiration_date, no_expiration')
      .eq('application_id', id).order('created_at', { ascending: true })
    const byKey = new Map<string, { doc_key: string; doc_label: string; storage_path: string; filename: string; suggested_name: string | null; mime_type: string | null; expiration_date: string | null; no_expiration: boolean }>()
    for (const d of docs ?? []) if (d.doc_key && !byKey.has(String(d.doc_key))) byKey.set(String(d.doc_key), d as never)
    const keepers = [...byKey.values()].filter(d => KEEPER_DOC_KEYS.has(d.doc_key))
    const keeperName = (d: { suggested_name: string | null; filename: string }) => (d.suggested_name && d.suggested_name.trim()) || d.filename

    const drive = getDrive()
    const done = { trashed: 0, copiedToOfficial: 0, errors: [] as string[] }
    try {
      const officialUnit = await resolveUnitFolder(assocFolders.official, unitRef, true)
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
    return NextResponse.json({ ok: true, refiled: true, unitRef, ...done })
  }

  const outcome = await runBoardApprove(id, { dryRun })
  if ('error' in outcome) return NextResponse.json({ error: outcome.error }, { status: 400 })
  if (!outcome.dryRun) await handoffOnApproval(id, 'staff').catch(() => null)
  return NextResponse.json(outcome)
}
