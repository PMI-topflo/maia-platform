// GET /api/admin/pre-apply  → the Applications command center: every open
// application (started / submitted / under_review / approval_sent) plus
// recently decided ones, with applicant, unit, type, stage, document count,
// and the On Going Drive folder. Staff-only.
//
// Stage now comes from getApplicationDashboard() (lib/application-dashboard.ts)
// — the SAME live document-review computation the staff/board/on-site-manager
// dashboards already use — rather than a friendly label slapped onto the raw
// `status` column. Real bug found live, 2026-08-21: MANXI 801 and 901 both
// had status='under_review' (set by the old, since-retired "Mark audited"
// button, which never checked completeness) while their documents were
// nowhere near actually complete — the old status-only labeling had no way
// to catch that; this page called them "Documents approved — creating
// letter" for ten days. Wiring this page to the real stage means "what was
// developed" (the dashboard feature) and what staff see here can no longer
// silently disagree.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { getApplicationDashboard, STAGE_LABEL, type Stage } from '@/lib/application-dashboard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dash = await getApplicationDashboard({ includeDecided: true, limit: 300 })
  const ids = dash.rows.map(r => r.id)

  const [{ data: sh }, { data: docs }, { data: reqs }, { data: rulesAck }] = await Promise.all([
    ids.length ? supabaseAdmin.from('application_stakeholders').select('application_id, name, email, is_primary').eq('is_primary', true).in('application_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? supabaseAdmin.from('application_documents').select('application_id').in('application_id', ids) : Promise.resolve({ data: [] }),
    // When a document request last went out — staff report, 2026-08-20: an
    // application that's genuinely waiting on the APPLICANT to respond to a
    // request still reads as "Submitted — awaiting audit" (or "Collecting
    // documents"), identical to one nobody has touched yet. Rather than add
    // a new status value to the state machine (document_requests never
    // changes listing_applications.status at all today), surface the most
    // recent request date so staff can tell the two apart at a glance.
    ids.length ? supabaseAdmin.from('document_requests').select('application_id, created_at').in('application_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? supabaseAdmin.from('listing_applications').select('id, rules_ack').in('id', ids) : Promise.resolve({ data: [] }),
  ])
  const nameByApp = new Map((sh ?? []).map(s => [s.application_id, { name: s.name as string | null, email: s.email as string | null }]))
  const docCount = new Map<string, number>()
  for (const d of docs ?? []) docCount.set(d.application_id as string, (docCount.get(d.application_id as string) ?? 0) + 1)
  const lastRequestedAt = new Map<string, string>()
  for (const r of reqs ?? []) {
    const appId = String(r.application_id), at = String(r.created_at)
    if (!lastRequestedAt.has(appId) || at > lastRequestedAt.get(appId)!) lastRequestedAt.set(appId, at)
  }
  const signedByApp = new Map((rulesAck ?? []).map(a => [String(a.id), !!(a.rules_ack as { name?: string } | null)?.name]))

  // Decided rows keep "Approved"/"Declined" as their own label and their own
  // chip key — decideStage() collapses both into one 'decided' stage
  // (correctly: nothing further is owed either way), but staff still need
  // the two visually distinct here, same as before this rewire.
  const chipKey = (r: { stage: Stage; status: string }) => r.stage === 'decided' ? r.status : r.stage
  const stageLabel = (r: { stage: Stage; status: string }) =>
    r.stage === 'decided' ? (r.status === 'approved' ? 'Approved' : 'Declined') : STAGE_LABEL[r.stage]

  return NextResponse.json({
    applications: dash.rows.map(r => ({
      id: r.id, associationCode: r.associationCode, type: r.type, unit: r.unit,
      status: r.status, stage: r.stage, chipKey: chipKey(r), stageLabel: stageLabel(r), detail: r.detail,
      submittedAt: r.submittedAt, startedAt: r.createdAt, reviewedAt: r.reviewedAt, driveFolderUrl: r.driveFolderUrl,
      applicant: nameByApp.get(r.id) ?? (r.applicants[0] ? { name: r.applicants[0], email: null } : null),
      docCount: docCount.get(r.id) ?? 0,
      signed: signedByApp.get(r.id) ?? false,
      lastRequestedAt: lastRequestedAt.get(r.id) ?? null,
    })),
  })
}
