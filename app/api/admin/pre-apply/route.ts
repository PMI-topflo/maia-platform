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

  const [{ data: sh, error: shError }, { data: docs }, { data: reqs }, { data: rulesAck }] = await Promise.all([
    // Every applicant, not just the primary — staff report, 2026-09-05:
    // this list showed only one name per application with no way to tell
    // which ones had a co-applicant without opening each one.
    ids.length ? supabaseAdmin.from('application_stakeholders').select('application_id, name, email, is_primary').eq('role', 'applicant').in('application_id', ids).order('is_primary', { ascending: false }).order('created_at', { ascending: true }) : Promise.resolve({ data: [], error: null }),
    ids.length ? supabaseAdmin.from('application_documents').select('application_id').in('application_id', ids) : Promise.resolve({ data: [] }),
    // When a document request last went out — staff report, 2026-08-20: an
    // application that's genuinely waiting on the APPLICANT to respond to a
    // request still reads as "Submitted — awaiting audit" (or "Collecting
    // documents"), identical to one nobody has touched yet. Rather than add
    // a new status value to the state machine (document_requests never
    // changes listing_applications.status at all today), surface the most
    // recent request date so staff can tell the two apart at a glance.
    ids.length ? supabaseAdmin.from('document_requests').select('application_id, created_at').in('application_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? supabaseAdmin.from('listing_applications').select('id, rules_ack, detailed_application_id').in('id', ids) : Promise.resolve({ data: [] }),
  ])

  // ── Checkr, per row ─────────────────────────────────────────────────
  // The legacy `applications` row (detailed_application_id) is what
  // screening_subjects foreign-keys to. One chip per application: none /
  // pending / partial / complete — the detail lives on the application page.
  const detailedByApp = new Map<string, string>()
  for (const a of rulesAck ?? []) if (a.detailed_application_id) detailedByApp.set(String(a.id), String(a.detailed_application_id))
  const detailedIds = [...new Set(detailedByApp.values())]
  const { data: subjects } = detailedIds.length
    ? await supabaseAdmin.from('screening_subjects').select('application_id, status, completed_at').in('application_id', detailedIds)
    : { data: [] as { application_id: string; status: string | null; completed_at: string | null }[] }
  const subjectsByDetailed = new Map<string, { n: number; done: number }>()
  for (const s of subjects ?? []) {
    const k = String(s.application_id)
    const cur = subjectsByDetailed.get(k) ?? { n: 0, done: 0 }
    cur.n++; if (s.completed_at || s.status === 'complete' || s.status === 'completed') cur.done++
    subjectsByDetailed.set(k, cur)
  }
  const checkrFor = (appId: string) => {
    const d = detailedByApp.get(appId); const c = d ? subjectsByDetailed.get(d) : undefined
    if (!c || c.n === 0) return null
    return { status: c.done === 0 ? 'pending' : c.done < c.n ? 'partial' : 'complete', n: c.n, done: c.done }
  }

  // ── Legacy self-serve form rows ─────────────────────────────────────
  // The old /apply form wrote straight to `applications`. Rows that were
  // never bridged to a pipeline application (no listing_applications row
  // points at them) used to be visible ONLY on the separate "Applications
  // (Checkr)" screen. User direction, 2026-09-10: one Applications screen —
  // so they show here with a "legacy form" badge until staff link or close
  // them. Test rows stay out.
  const [{ data: bridged }, { data: legacyRows }] = await Promise.all([
    supabaseAdmin.from('listing_applications').select('detailed_application_id').not('detailed_application_id', 'is', null),
    supabaseAdmin.from('applications').select('id, association, app_type, applicants, entity_name, created_at, stripe_payment_status, board_decision, screening_status, is_test')
      .order('created_at', { ascending: false }).limit(200),
  ])
  const bridgedIds = new Set((bridged ?? []).map(b => String(b.detailed_application_id)))
  const legacy = (legacyRows ?? [])
    .filter(r => !r.is_test && !bridgedIds.has(String(r.id)))
    .map(r => {
      const first = (r.applicants as { firstName?: string; lastName?: string; email?: string }[] | null)?.[0]
      const name = r.app_type === 'commercial' && r.entity_name ? String(r.entity_name) : [first?.firstName, first?.lastName].filter(Boolean).join(' ') || null
      return {
        id: String(r.id), reference: `PMI-${String(r.id).slice(0, 8).toUpperCase()}`, association: (r.association as string | null) ?? null,
        applicant: { name, email: first?.email ?? null }, createdAt: String(r.created_at),
        paid: r.stripe_payment_status === 'paid', boardDecision: (r.board_decision as string | null) ?? 'pending', screening: (r.screening_status as string | null) ?? null,
      }
    })
  // Same lesson as the 2026-09-05 incident (see lib/board-review.ts): a
  // failed query here must never read back identical to "no applicants".
  if (shError) console.error('[admin/pre-apply] stakeholders query failed:', shError.message)
  const applicantsByApp = new Map<string, { name: string | null; email: string | null; isPrimary: boolean }[]>()
  for (const s of sh ?? []) {
    const appId = s.application_id as string
    const arr = applicantsByApp.get(appId); const row = { name: s.name as string | null, email: s.email as string | null, isPrimary: !!s.is_primary }
    if (arr) arr.push(row); else applicantsByApp.set(appId, [row])
  }
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
      applicant: applicantsByApp.get(r.id)?.[0] ?? (r.applicants[0] ? { name: r.applicants[0], email: null } : null),
      // Every applicant on the application, primary first — lets the list
      // show a co-applicant instead of just the one person happening to be
      // "primary". Falls back to dash's bare name list on the same rare
      // path `applicant` above does (no stakeholder row at all yet).
      applicants: applicantsByApp.get(r.id) ?? r.applicants.map((name, i) => ({ name, email: null, isPrimary: i === 0 })),
      docCount: docCount.get(r.id) ?? 0,
      signed: signedByApp.get(r.id) ?? false,
      lastRequestedAt: lastRequestedAt.get(r.id) ?? null,
      // Already computed by getApplicationDashboard() -- surfaced here so
      // staff's own list finally shows the same days-left/overdue/signature
      // visibility the board/on-site-manager portal has always had. User
      // report, 2026-09-06: "I am totally blind" to this.
      daysLeft: r.daysLeft, alarm: r.alarm, letter: r.letter,
      // User report, 2026-09-08: "I still can't see in my dashboard when
      // someone approved all files and finalize this step" -- windowOpenedAt
      // is set the instant every required document is individually approved
      // (lib/board-review.ts's syncBoardWindow), already computed here but
      // never surfaced to this list before.
      windowOpenedAt: r.windowOpenedAt,
      // "we have the name and timestamp of who approved, don't we have?" --
      // the newest document decision on record, which is what finalized the
      // checklist and opened the window above.
      finalizedBy: r.finalizedBy, finalizedByRole: r.finalizedByRole,
      checkr: checkrFor(r.id),
    })),
    legacy,
  })
}
