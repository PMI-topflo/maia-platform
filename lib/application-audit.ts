// =====================================================================
// lib/application-audit.ts
//
// The "Processing audit" for one application — the six facts staff need
// when a realtor, applicant or board member says "you are taking too
// long": when it started, when the last file arrived, how many emails
// asked for documents, how fast PMI approves a file once it arrives,
// what is still missing today, and when it went to the board. Everything
// is derived from rows MAIA already writes; nothing is entered by hand.
// Rendered on the application page (staff) and on the public share page
// /application-audit/[token]. User direction, 2026-09-14.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOutstandingSummary } from '@/lib/application-outstanding-summary'

export interface AuditFile { label: string; receivedAt: string; decidedAt: string | null; decision: string | null; hours: number | null; bySource: string }

export interface ProcessingAudit {
  applicationId: string
  associationCode: string
  associationName: string
  unitLabel: string | null
  applicationType: string
  status: string
  applicants: string[]
  generatedAt: string
  daysInProcess: number
  createdAt: string
  firstFileAt: string | null
  lastFileAt: string | null
  lastFileLabel: string | null
  lastApplicantFileAt: string | null
  lastApplicantFileLabel: string | null
  requests: { total: number; staffRequests: number; staffRepliesAskingUpload: number; autoReminders: number; dates: string[] }
  approval: { files: number; decided: number; medianHours: number | null; averageHours: number | null; withinHour: number; slowest: { label: string; hours: number } | null }
  missing: { count: number; items: string[]; complete: boolean; completeSince: string | null }
  board: {
    sentAt: string | null
    daysWithBoard: number | null
    interviewRequestedAt: string | null
    interviewCompletedAt: string | null
    letterSigned: number | null
    letterSigners: number | null
    letterSentAt: string | null
  }
  closed: { status: string; at: string | null } | null
  /** Background check run outside MAIA (e.g. Tenant Evaluation), copied
   *  from the provider's own progress screen — null when not recorded. */
  screening: { provider: string; steps: { label: string; at: string }[] } | null
  files: AuditFile[]
}

const H = 3_600_000
const hoursBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / H
const daysBetween = (a: string, b: string) => Math.max(0, Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000))

function labelFor(docKey: string, docLabel: string | null): string {
  if (docLabel) return docLabel
  return docKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export async function buildProcessingAudit(applicationId: string): Promise<ProcessingAudit | null> {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, status, association_code, unit_label, application_type, created_at, started_at, completed_at, withdrawn_at, board_window_opened_at, interview_requested_at, interview_completed_at')
    .eq('id', applicationId).maybeSingle()
  if (!app) return null
  // Separate, tolerant read: the column arrives with a later migration and
  // the card must not disappear on an environment that lacks it.
  const screeningRaw = await supabaseAdmin.from('listing_applications').select('screening_timeline').eq('id', applicationId).maybeSingle()
    .then(r => (r.data as { screening_timeline?: unknown } | null)?.screening_timeline ?? null, () => null)
  const code = String(app.association_code)
  const unit = (app.unit_label as string | null) ?? null
  const now = new Date().toISOString()

  const [{ data: assoc }, { data: stk }, { data: docs }, { data: reviews }, { data: reqs }, { data: reminders }, comms, { data: letters }, outstanding] = await Promise.all([
    supabaseAdmin.from('associations').select('legal_name, association_name').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('role, name, created_at').eq('application_id', applicationId).order('created_at'),
    supabaseAdmin.from('application_documents').select('doc_key, doc_label, created_at, uploaded_by_role, stakeholder_id').eq('application_id', applicationId).order('created_at'),
    supabaseAdmin.from('application_document_reviews').select('scope_key, decision, decided_at').eq('application_id', applicationId).order('decided_at'),
    supabaseAdmin.from('document_requests').select('created_at').eq('application_id', applicationId).order('created_at'),
    supabaseAdmin.from('application_reminder_approvals').select('decided_at, created_at, sent_to, status').eq('application_id', applicationId),
    supabaseAdmin.from('application_communications').select('occurred_at, created_at, subject, direction').eq('application_id', applicationId).then(r => r, () => ({ data: [] as { occurred_at: string | null; created_at: string; subject: string | null; direction: string | null }[] })),
    unit ? supabaseAdmin.from('esign_documents').select('status, signers, payload, created_at').eq('kind', 'board_decision').eq('association_code', code).eq('unit_ref', unit).order('created_at', { ascending: false }).limit(1) : Promise.resolve({ data: [] as unknown[] }),
    getOutstandingSummary(applicationId).catch(() => ({ error: 'unavailable' })),
  ])

  // ── Files and how fast each was decided ─────────────────────────────
  const files: AuditFile[] = (docs ?? []).map(d => {
    const scoped = d.stakeholder_id ? `${d.doc_key}#${d.stakeholder_id}` : String(d.doc_key)
    const decision = (reviews ?? []).find(r => (r.scope_key === scoped || r.scope_key === d.doc_key) && String(r.decided_at) >= String(d.created_at))
    const hours = decision ? hoursBetween(String(d.created_at), String(decision.decided_at)) : null
    const src = String(d.uploaded_by_role ?? '')
    return {
      label: labelFor(String(d.doc_key), (d.doc_label as string | null) ?? null), receivedAt: String(d.created_at),
      decidedAt: decision ? String(decision.decided_at) : null, decision: decision ? String(decision.decision) : null, hours,
      bySource: src.startsWith('request:') ? src.replace('request:', '') : src === 'applicant' ? 'applicant' : src === 'esign' ? 'e-signed' : src === 'staff' || src === 'drive-pick' ? 'PMI' : src || 'unknown',
    }
  })
  const decidedHours = files.map(f => f.hours).filter((h): h is number => h != null).sort((a, b) => a - b)
  const median = decidedHours.length ? (decidedHours.length % 2 ? decidedHours[(decidedHours.length - 1) / 2] : (decidedHours[decidedHours.length / 2 - 1] + decidedHours[decidedHours.length / 2]) / 2) : null
  const average = decidedHours.length ? decidedHours.reduce((s, h) => s + h, 0) / decidedHours.length : null
  const slowestFile = files.filter(f => f.hours != null).sort((a, b) => (b.hours ?? 0) - (a.hours ?? 0))[0] ?? null
  const applicantFiles = files.filter(f => f.bySource === 'applicant' || f.bySource === 'tenant' || f.bySource === 'owner' || f.bySource === 'e-signed')
  const lastFile = files[files.length - 1] ?? null
  const lastApplicantFile = applicantFiles[applicantFiles.length - 1] ?? null

  // ── Emails that asked for documents ─────────────────────────────────
  const staffRequests = (reqs ?? []).map(r => String(r.created_at))
  const autoReminders = (reminders ?? []).filter(r => r.status === 'approved' || (Array.isArray(r.sent_to) && r.sent_to.length)).map(r => String(r.decided_at ?? r.created_at))
  const repliesAskingUpload = (comms.data ?? []).filter(c => c.direction === 'outbound' && /ask them to upload|documents still needed|still needed/i.test(String(c.subject ?? ''))).map(c => String(c.occurred_at ?? c.created_at))
  const requestDates = [...staffRequests, ...autoReminders, ...repliesAskingUpload].sort()

  // ── Still missing today ─────────────────────────────────────────────
  let missingItems: string[] = []
  let complete = false
  if (!('error' in outstanding)) {
    missingItems = [...outstanding.rows.filter(r => !r.gatedBy).map(r => r.label), ...outstanding.declineQuestions.map(q => q === 'vehicle' ? 'Vehicle question' : 'Animal question')]
    complete = outstanding.nothingOutstanding
  }
  // "Complete since" = the last approve decision when nothing is missing.
  const lastApprove = (reviews ?? []).filter(r => r.decision === 'approved').map(r => String(r.decided_at)).sort().pop() ?? null

  // ── Board ───────────────────────────────────────────────────────────
  const letter = ((letters ?? []) as { status: string; signers: unknown; payload: unknown }[])[0] ?? null
  const signers = letter && Array.isArray(letter.signers) ? (letter.signers as { signed_at?: string | null }[]) : []
  const dist = (letter?.payload as { distribution?: { at?: string } } | null)?.distribution ?? null
  const sentAt = (app.board_window_opened_at as string | null) ?? null
  const closedAt = (app.withdrawn_at as string | null) ?? (dist?.at ?? null) ?? (app.completed_at as string | null) ?? null
  const status = String(app.status ?? '')
  const closed = ['approved', 'declined', 'withdrawn', 'cancelled', 'archived', 'void'].includes(status) ? { status, at: closedAt } : null
  const boardEnd = closed?.at ?? now

  const createdAt = String(app.created_at ?? app.started_at)
  const applicants = (stk ?? []).filter(s => s.role === 'applicant' && s.name).map(s => String(s.name))

  return {
    applicationId, associationCode: code,
    associationName: String(assoc?.legal_name || assoc?.association_name || code),
    unitLabel: unit, applicationType: String(app.application_type ?? ''), status, applicants,
    generatedAt: now,
    daysInProcess: daysBetween(createdAt, closed?.at ?? now),
    createdAt,
    firstFileAt: files[0]?.receivedAt ?? null,
    lastFileAt: lastFile?.receivedAt ?? null, lastFileLabel: lastFile?.label ?? null,
    lastApplicantFileAt: lastApplicantFile?.receivedAt ?? null, lastApplicantFileLabel: lastApplicantFile?.label ?? null,
    requests: { total: requestDates.length, staffRequests: staffRequests.length, staffRepliesAskingUpload: repliesAskingUpload.length, autoReminders: autoReminders.length, dates: requestDates },
    approval: {
      files: files.length, decided: decidedHours.length, medianHours: median, averageHours: average,
      withinHour: decidedHours.filter(h => h <= 1).length,
      slowest: slowestFile && slowestFile.hours != null ? { label: slowestFile.label, hours: slowestFile.hours } : null,
    },
    missing: { count: missingItems.length, items: missingItems, complete, completeSince: complete ? lastApprove : null },
    board: {
      sentAt, daysWithBoard: sentAt ? daysBetween(sentAt, boardEnd) : null,
      interviewRequestedAt: (app.interview_requested_at as string | null) ?? null,
      interviewCompletedAt: (app.interview_completed_at as string | null) ?? null,
      letterSigned: letter ? signers.filter(s => s.signed_at).length : null,
      letterSigners: letter ? signers.length : null,
      letterSentAt: dist?.at ?? null,
    },
    closed,
    screening: parseScreening(screeningRaw),
    files,
  }
}

function parseScreening(v: unknown): ProcessingAudit['screening'] {
  const o = v as { provider?: unknown; steps?: unknown } | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.steps)) return null
  const steps = (o.steps as { label?: unknown; at?: unknown }[])
    .filter(s => typeof s.label === 'string' && typeof s.at === 'string' && !Number.isNaN(new Date(s.at as string).getTime()))
    .map(s => ({ label: String(s.label), at: String(s.at) }))
    .sort((a, b) => a.at.localeCompare(b.at))
  return steps.length ? { provider: typeof o.provider === 'string' ? o.provider : 'Background check', steps } : null
}
