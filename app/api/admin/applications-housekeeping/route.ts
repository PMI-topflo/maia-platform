// GET  /api/admin/applications-housekeeping?assoc=MANXI  → the MAIA × Drive audit (staff)
// POST /api/admin/applications-housekeeping  { action, ... }        → one housekeeping action (staff)
//   expire        { applicationId, reason }
//   reopen        { applicationId }
//   merge_folders { survivorFolderId, loserFolderId }
//   create_folder { applicationId }
//   archive_folder{ assoc, unitLabel, folderId }   (orphan folder → unit's OLD/Archive, tagged ARCHIVED)
//   screened_elsewhere { applicationId }  (fee paid / screened outside MAIA, e.g. Tenant
//                 Evaluation → provider 'tenant_evaluation', open expiry notice cleared)

import { NextResponse } from 'next/server'
import { requireStaffSession, staffLabel } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildHousekeeping } from '@/lib/application-housekeeping'
import { expireApplication, reopenApplication, moveOngoingFolderToArchive } from '@/lib/application-withdraw'
import { mergeOngoingDuplicateFolder, ensureOngoingUnitFolder } from '@/lib/drive-application-mirror'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const assoc = (new URL(req.url).searchParams.get('assoc') ?? 'MANXI').toUpperCase()
  return NextResponse.json(await buildHousekeeping(assoc))
}

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const by = staffLabel(session)
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const str = (k: string) => String(b[k] ?? '').trim()

  switch (b.action) {
    case 'expire': {
      const r = await expireApplication(str('applicationId'), { reason: str('reason') || 'Stale — no activity; closed during housekeeping', by })
      return 'error' in r ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json(r)
    }
    case 'reopen': {
      const r = await reopenApplication(str('applicationId'), by)
      return 'error' in r ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json(r)
    }
    case 'merge_folders': {
      const r = await mergeOngoingDuplicateFolder({ survivorFolderId: str('survivorFolderId'), loserFolderId: str('loserFolderId') })
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error ?? 'merge failed' }, { status: 400 })
    }
    case 'create_folder': {
      const { data: app } = await supabaseAdmin.from('listing_applications').select('id, association_code, unit_label').eq('id', str('applicationId')).maybeSingle()
      if (!app || !app.unit_label) return NextResponse.json({ error: 'application not found or has no unit' }, { status: 404 })
      const { data: stk } = await supabaseAdmin.from('application_stakeholders').select('name').eq('application_id', app.id).eq('role', 'applicant').limit(1)
      try {
        const f = await ensureOngoingUnitFolder({ unitLabel: String(app.unit_label), applicantName: (stk?.[0]?.name as string | null) ?? null, associationCode: String(app.association_code) })
        await supabaseAdmin.from('listing_applications').update({ drive_folder_id: f.folderId, drive_folder_url: f.webViewLink, updated_at: new Date().toISOString() }).eq('id', app.id)
        return NextResponse.json({ ok: true, folderId: f.folderId, url: f.webViewLink })
      } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }) }
    }
    case 'archive_folder': {
      const assoc = str('assoc').toUpperCase(); const unitLabel = str('unitLabel') || null; const folderId = str('folderId')
      if (!assoc || !folderId) return NextResponse.json({ error: 'assoc and folderId required' }, { status: 400 })
      const r = await moveOngoingFolderToArchive(assoc, unitLabel, folderId, 'ARCHIVED')
      return r.driveError && !r.driveMoved ? NextResponse.json({ error: r.driveError }, { status: 400 }) : NextResponse.json({ ok: true, ...r })
    }
    case 'screened_elsewhere': {
      // MANXI 1003 (2026-09-14): the unpaid-fee notice went to an applicant
      // who had paid Tenant Evaluation directly. Recording the provider on
      // the application keeps the 'unpaid' rule (and the Checkr auto-order
      // after a Stripe payment) away from it.
      const id = str('applicationId')
      const { data: app } = await supabaseAdmin.from('listing_applications').select('id, review_note').eq('id', id).maybeSingle()
      if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 })
      const now = new Date().toISOString()
      const { error } = await supabaseAdmin.from('listing_applications').update({
        screening_provider: 'tenant_evaluation', expiry_notice_kind: null, expiry_notice_at: null, expiry_due_at: null,
        review_note: `${now.slice(0, 10)} ${by}: background check paid / run outside MAIA (Tenant Evaluation) — no MAIA fee due. ${String(app.review_note ?? '')}`.trim(), updated_at: now,
      }).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }
}
