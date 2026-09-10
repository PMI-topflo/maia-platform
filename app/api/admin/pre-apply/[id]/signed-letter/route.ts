// =====================================================================
// POST /api/admin/pre-apply/[id]/signed-letter
//   { storage_path, filename, mime_type?, distribute?: boolean }
//
// Staff upload a Board Approval Letter the board signed OUTSIDE MAIA (on
// paper, by email) — the browser has already PUT the file to Storage via
// /upload-url with doc_key 'board_approval_letter'. This route then does
// everything the last e-signature would have done:
//   1. files the PDF as the application's board_approval_letter document
//   2. voids any still-unsigned MAIA letter for this application, so nobody
//      signs a stale one later
//   3. runs the same approval steps as a completed e-signature
//      (lib/board-approve.ts: keepers → Official, On Going → Archive, mark
//      approved) and the screening-provider handoff
//   4. optionally emails the uploaded letter to every party
//
// User report, 2026-09-10 (MANXI 801): "board approved in August and signed
// the letter … can't find where to upload the approval letter." The
// checklist no longer carries a Board Approval Letter row for new leases,
// and the Board Decision box only knew how to create + e-sign. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession, staffLabel } from '@/lib/staff-auth'
import { INTAKE_BUCKET } from '@/lib/preapply'
import { runBoardApprove } from '@/lib/board-approve'
import { handoffOnApproval } from '@/lib/application-handoff'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let b: { storage_path?: string; filename?: string; mime_type?: string; distribute?: boolean }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const storagePath = String(b.storage_path ?? '')
  const filename = String(b.filename ?? 'Board_Approval_Letter.pdf')
  // Only accept a path /upload-url minted for THIS application's letter slot.
  if (!storagePath.startsWith(`intake/${id}/board_approval_letter/`)) {
    return NextResponse.json({ error: 'storage_path is not this application’s board_approval_letter upload' }, { status: 400 })
  }

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, listing_id, association_code, unit_label, status').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 })
  if (app.status === 'approved') return NextResponse.json({ error: 'This application is already approved.' }, { status: 400 })

  // The file must actually be there (the PUT could have failed silently).
  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(storagePath)
  if (dlErr || !blob) return NextResponse.json({ error: 'The uploaded file was not found in storage — try the upload again.' }, { status: 400 })
  const pdf = Buffer.from(await blob.arrayBuffer())

  // 1. File it as the application's Board Approval Letter (one shared slot).
  await supabaseAdmin.from('application_documents').delete().eq('application_id', id).eq('doc_key', 'board_approval_letter').is('stakeholder_id', null)
  const { error: insErr } = await supabaseAdmin.from('application_documents').insert({
    application_id: id, listing_id: app.listing_id, kind: 'other',
    doc_key: 'board_approval_letter', doc_label: 'Board Approval Letter',
    storage_path: storagePath, filename, suggested_name: 'Board_Approval_Letter.pdf',
    mime_type: b.mime_type || 'application/pdf', uploaded_by_role: 'staff',
  })
  if (insErr) return NextResponse.json({ error: `Could not file the letter: ${insErr.message}` }, { status: 500 })

  // 2. Void any unsigned MAIA letter for this application / unit — the
  //    uploaded one is the decision now.
  const { data: pendingLetters } = await supabaseAdmin.from('esign_documents')
    .select('id, status, application_id, unit_ref').eq('kind', 'board_decision').eq('association_code', String(app.association_code))
    .neq('status', 'completed').neq('status', 'void')
  const voidIds = (pendingLetters ?? [])
    .filter(l => l.application_id === id || (!l.application_id && String(l.unit_ref ?? '') === String(app.unit_label ?? '')))
    .map(l => String(l.id))
  if (voidIds.length) await supabaseAdmin.from('esign_documents').update({ status: 'void', updated_at: new Date().toISOString() }).in('id', voidIds)

  // 3. The same approval steps the last e-signature runs.
  const outcome = await runBoardApprove(id, { approvedByRole: 'staff', signedLetterUploaded: true })
  if ('error' in outcome) {
    return NextResponse.json({ ok: false, filed: true, error: `Letter filed, but the approval step failed: ${outcome.error}` }, { status: 502 })
  }
  await handoffOnApproval(id, 'staff').catch(() => null)

  // 4. Optionally send the uploaded letter to every party. Reuses the
  //    distribution used for e-signed letters, with the newest MAIA letter
  //    row (now void) supplying the association / unit context.
  let distributed: number | null = null
  if (b.distribute) {
    const { data: letterRow } = await supabaseAdmin.from('esign_documents')
      .select('*').eq('kind', 'board_decision').eq('association_code', String(app.association_code))
      .or(`application_id.eq.${id},unit_ref.eq.${String(app.unit_label ?? '')}`)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (letterRow) {
      const { distributeApprovalLetter } = await import('@/lib/approval-distribution')
      const { getEsignDoc } = await import('@/lib/esign')
      const doc = await getEsignDoc(String(letterRow.id))
      if (doc) {
        const r = await distributeApprovalLetter({ doc, applicationId: id, pdf }).catch(() => null)
        distributed = r?.sent ?? null
      }
    }
  }

  await supabaseAdmin.from('listing_applications')
    .update({ review_note: `Signed approval letter uploaded by ${staffLabel(session)} — approved`, updated_at: new Date().toISOString() }).eq('id', id)

  return NextResponse.json({ ok: true, voided: voidIds.length, distributed })
}
