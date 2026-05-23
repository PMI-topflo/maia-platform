// =====================================================================
// lib/report-feedback.ts
//
// Helpers behind the monthly-report feedback loop. Staff email a
// published report to an audience (board members or all unit owners);
// each recipient gets a tokenized /report-feedback/<token> link and
// submits a 1–5 rating + free-text feedback. One row per (report,
// recipient_email) — re-sending preserves the token + any rating
// already left.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

export type FeedbackAudience = 'board' | 'owners'
export type RecipientType    = 'board' | 'owner'

export interface FeedbackRecipient {
  email: string
  name:  string                       // 'Jane Smith' or 'Unit Owner'
  label: string                       // 'President' or 'Unit 305'
}

export interface ReportFeedbackRow {
  id:               string
  report_id:        string
  recipient_type:   RecipientType
  recipient_email:  string
  recipient_name:   string | null
  recipient_label:  string | null
  feedback_token:   string
  rating:           number | null
  feedback:         string | null
  sent_at:          string
  submitted_at:     string | null
}

const ROW_COLUMNS = 'id, report_id, recipient_type, recipient_email, recipient_name, recipient_label, feedback_token, rating, feedback, sent_at, submitted_at'

// ─────────────────────────────────────────────────────────────────────
// Recipients — pulled from the same tables /board and /my-account use.
// ─────────────────────────────────────────────────────────────────────

/** Active board members of an association (both the newer
 *  association_board_members and the legacy board_members), deduped by
 *  email. */
async function boardRecipients(code: string): Promise<FeedbackRecipient[]> {
  const seen = new Map<string, FeedbackRecipient>()

  const { data: abm } = await supabaseAdmin
    .from('association_board_members')
    .select('name, email, role')
    .eq('association_code', code)
    .eq('active', true)
  for (const r of (abm ?? []) as Array<{ name: string|null; email: string|null; role: string|null }>) {
    if (!r.email) continue
    const key = r.email.toLowerCase()
    if (seen.has(key)) continue
    seen.set(key, {
      email: r.email,
      name:  r.name || 'Board Member',
      label: r.role || 'Board Member',
    })
  }

  const { data: bm } = await supabaseAdmin
    .from('board_members')
    .select('first_name, last_name, email, position')
    .eq('association_code', code)
    .eq('active', true)
  for (const r of (bm ?? []) as Array<{ first_name: string|null; last_name: string|null; email: string|null; position: string|null }>) {
    if (!r.email) continue
    const key = r.email.toLowerCase()
    if (seen.has(key)) continue
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Board Member'
    seen.set(key, {
      email: r.email,
      name,
      label: r.position || 'Board Member',
    })
  }

  return Array.from(seen.values())
}

/** All unit owners of an association with at least one email on file —
 *  uses only the first email when an owner has several, to avoid mass
 *  duplication. */
async function ownerRecipients(code: string): Promise<FeedbackRecipient[]> {
  const seen = new Map<string, FeedbackRecipient>()

  const { data: owners } = await supabaseAdmin
    .from('owners')
    .select('first_name, last_name, unit_number, emails')
    .eq('association_code', code)
  for (const r of (owners ?? []) as Array<{ first_name: string|null; last_name: string|null; unit_number: string|null; emails: string|null }>) {
    const emails = (r.emails ?? '').split(/[,;]/).map(e => e.trim()).filter(Boolean)
    if (emails.length === 0) continue
    const first = emails[0]
    const key   = first.toLowerCase()
    if (seen.has(key)) continue
    const name  = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unit Owner'
    const label = r.unit_number ? `Unit ${r.unit_number}` : 'Unit Owner'
    seen.set(key, { email: first, name, label })
  }

  return Array.from(seen.values())
}

export async function findReportRecipients(
  assocCode: string,
  audience:  FeedbackAudience,
): Promise<FeedbackRecipient[]> {
  const code = (assocCode ?? '').toUpperCase()
  if (!code) return []
  return audience === 'board' ? boardRecipients(code) : ownerRecipients(code)
}

// ─────────────────────────────────────────────────────────────────────
// DB — feedback rows
// ─────────────────────────────────────────────────────────────────────

/** Ensure a report_feedback row exists for each recipient. Existing
 *  rows have their sent_at bumped (re-send) and contact info refreshed;
 *  ratings and feedback are preserved. Returns the full row list. */
export async function prepareReportSend(
  reportId:   string,
  audience:   FeedbackAudience,
  recipients: FeedbackRecipient[],
): Promise<ReportFeedbackRow[]> {
  const recipientType: RecipientType = audience === 'board' ? 'board' : 'owner'
  const out: ReportFeedbackRow[] = []

  for (const r of recipients) {
    const { data: existing } = await supabaseAdmin
      .from('report_feedback')
      .select(ROW_COLUMNS)
      .eq('report_id', reportId)
      .eq('recipient_email', r.email)
      .maybeSingle()

    if (existing) {
      const { data: upd } = await supabaseAdmin
        .from('report_feedback')
        .update({
          sent_at:         new Date().toISOString(),
          recipient_name:  r.name,
          recipient_label: r.label,
          recipient_type:  recipientType,
        })
        .eq('id', (existing as ReportFeedbackRow).id)
        .select(ROW_COLUMNS)
        .single()
      if (upd) out.push(upd as ReportFeedbackRow)
      continue
    }

    const token = globalThis.crypto.randomUUID()
    const { data: ins } = await supabaseAdmin
      .from('report_feedback')
      .insert({
        report_id:       reportId,
        recipient_type:  recipientType,
        recipient_email: r.email,
        recipient_name:  r.name,
        recipient_label: r.label,
        feedback_token:  token,
        sent_at:         new Date().toISOString(),
      })
      .select(ROW_COLUMNS)
      .single()
    if (ins) out.push(ins as ReportFeedbackRow)
  }

  return out
}

export async function getFeedbackByToken(token: string): Promise<ReportFeedbackRow | null> {
  const { data } = await supabaseAdmin
    .from('report_feedback')
    .select(ROW_COLUMNS)
    .eq('feedback_token', token)
    .maybeSingle()
  return (data as ReportFeedbackRow) || null
}

export async function submitFeedback(
  token:    string,
  rating:   number,
  feedback: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: 'Rating must be a whole number from 1 to 5' }
  }
  const trimmed = (feedback ?? '').trim().slice(0, 4000) || null
  const { error } = await supabaseAdmin
    .from('report_feedback')
    .update({
      rating,
      feedback:     trimmed,
      submitted_at: new Date().toISOString(),
    })
    .eq('feedback_token', token)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function getFeedbackForReport(reportId: string): Promise<ReportFeedbackRow[]> {
  const { data } = await supabaseAdmin
    .from('report_feedback')
    .select(ROW_COLUMNS)
    .eq('report_id', reportId)
    .order('recipient_type', { ascending: true })
    .order('sent_at',        { ascending: true })
  return (data ?? []) as ReportFeedbackRow[]
}

// ─────────────────────────────────────────────────────────────────────
// Aggregate
// ─────────────────────────────────────────────────────────────────────

export interface AudienceStat {
  sent:        number
  responded:   number
  avgRating:   number | null
  lastSentAt:  string | null
}

export function aggregateByAudience(rows: ReportFeedbackRow[]): {
  board:  AudienceStat
  owners: AudienceStat
} {
  const tally = (kind: RecipientType): AudienceStat => {
    const subset = rows.filter(r => r.recipient_type === kind)
    const ratings = subset.filter(r => typeof r.rating === 'number').map(r => r.rating as number)
    return {
      sent:       subset.length,
      responded:  ratings.length,
      avgRating:  ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
      lastSentAt: subset.reduce<string | null>(
        (latest, r) => (!latest || r.sent_at > latest) ? r.sent_at : latest,
        null,
      ),
    }
  }
  return { board: tally('board'), owners: tally('owner') }
}
