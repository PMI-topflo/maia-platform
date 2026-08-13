// =====================================================================
// lib/application-comm-log.ts
//
// "@maia update application MANXI103" — staff forward a thread with the
// board, the tenants or an agent to maia@pmitop.com and MAIA files it against
// that unit's application, so the Communication history shows the whole
// conversation and not only the messages MAIA itself sent.
//
// Same shape as the invoice-intake trigger: an explicit phrase, an early
// return so the message never also becomes a ticket, and a reply that says
// exactly what was filed and where.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export interface ApplicationRef { associationCode: string; unitLabel: string | null }

// Long form:  "@maia update application MANXI103" / "…MANXI 103" / "…: MANXI-103"
//             (log / save / save to / add to / file also accepted — staff will
//             not all reach for the same verb)
// Short form: "@maia upapp MANXI103"  — the one people will actually type.
//             upapp / updateapp / update-app / logapp / appfile all land here.
const VERB = String.raw`(?:up(?:date)?[\s-]*app(?:lication)?|log[\s-]*app(?:lication)?|save[\s-]*(?:to[\s-]*)?app(?:lication)?|add[\s-]*to[\s-]*app(?:lication)?|file[\s-]*(?:to[\s-]*)?app(?:lication)?)`
const TRIGGER_RE = new RegExp(String.raw`@maia\s+${VERB}\b[\s:#-]*([A-Za-z][A-Za-z0-9]*)[\s-]*([0-9][A-Za-z0-9-]*)?`, 'i')

/** Does this email carry the file-to-application command, and for which unit? */
export function detectApplicationLogTrigger(body: string): ApplicationRef | null {
  const m = TRIGGER_RE.exec(body.replace(/\s+/g, ' '))
  if (!m) return null
  const token = m[1].toUpperCase()
  // "MANXI103" arrives as one word — split the trailing digits back off.
  const joined = /^([A-Za-z]+?)(\d[\w-]*)$/.exec(token)
  if (joined) return { associationCode: joined[1].toUpperCase(), unitLabel: joined[2] }
  return { associationCode: token, unitLabel: m[2] ? m[2].toUpperCase() : null }
}

/** Strip the command itself out of what we store — staff don't need to read
 *  "@maia update application MANXI103" back in the timeline. */
export function stripTrigger(body: string): string {
  const line = new RegExp(String.raw`@maia\s+${VERB}`, 'i')
  return body
    .split('\n')
    .filter(l => !line.test(l))
    .join('\n')
    .trim()
}

/** The application this correspondence belongs to. Prefers one that is still
 *  open — staff filing a board email mean the live application, not last
 *  year's — but falls back to the most recent so an approved file can still
 *  receive its paper trail. */
export async function resolveApplication(ref: ApplicationRef): Promise<{ id: string; unitLabel: string | null; status: string } | null> {
  let q = supabaseAdmin.from('listing_applications')
    .select('id, unit_label, status, created_at')
    .eq('association_code', ref.associationCode)
    .order('created_at', { ascending: false })
  if (ref.unitLabel) q = q.eq('unit_label', ref.unitLabel)

  const { data } = await q
  if (!data || data.length === 0) return null
  const open = data.find(a => a.status !== 'approved' && a.status !== 'declined')
  const pick = open ?? data[0]
  return { id: String(pick.id), unitLabel: (pick.unit_label as string | null) ?? null, status: String(pick.status) }
}

export interface LogResult {
  ok: boolean
  reason?: 'no-application' | 'empty-body' | 'error'
  applicationId?: string
  unitLabel?: string | null
  duplicate?: boolean
  detail?: string
}

/** File one email against an application's communication history. */
export async function logApplicationCommunication(opts: {
  ref: ApplicationRef
  subject: string
  body: string
  fromEmail: string
  fromName?: string | null
  to?: string[]
  cc?: string[]
  attachmentNames?: string[]
  occurredAt?: Date | string | null
  gmailMessageId?: string | null
  gmailThreadId?: string | null
  loggedBy?: string | null
}): Promise<LogResult> {
  const app = await resolveApplication(opts.ref)
  if (!app) return { ok: false, reason: 'no-application' }

  const body = stripTrigger(opts.body)
  if (!body) return { ok: false, reason: 'empty-body', applicationId: app.id, unitLabel: app.unitLabel }

  const row = {
    application_id:   app.id,
    association_code: opts.ref.associationCode,
    unit_label:       app.unitLabel,
    direction:        'inbound',
    subject:          opts.subject || null,
    body,
    from_email:       opts.fromEmail || null,
    from_name:        opts.fromName ?? null,
    to_emails:        opts.to?.length ? opts.to : null,
    cc_emails:        opts.cc?.length ? opts.cc : null,
    attachment_names: opts.attachmentNames?.length ? opts.attachmentNames : null,
    occurred_at:      (opts.occurredAt ? new Date(opts.occurredAt) : new Date()).toISOString(),
    gmail_message_id: opts.gmailMessageId ?? null,
    gmail_thread_id:  opts.gmailThreadId ?? null,
    logged_by:        opts.loggedBy ?? opts.fromEmail ?? null,
  }

  const { error } = await supabaseAdmin.from('application_communications').insert(row)
  if (error) {
    // 23505 = the unique index on gmail_message_id. A webhook retry re-delivering
    // the same message must be a no-op, not a second copy in the timeline.
    if (error.code === '23505') return { ok: true, duplicate: true, applicationId: app.id, unitLabel: app.unitLabel }
    return { ok: false, reason: 'error', detail: error.message, applicationId: app.id, unitLabel: app.unitLabel }
  }
  return { ok: true, applicationId: app.id, unitLabel: app.unitLabel }
}

/** The confirmation MAIA emails back to the staff member who filed it. */
export function buildLogReplyHtml(r: LogResult, ref: ApplicationRef, subject: string): string {
  const wrap = (inner: string) =>
    `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6">${inner}</div>`

  if (r.reason === 'no-application') {
    return wrap(`<p>I couldn't find an application for <strong>${ref.associationCode}${ref.unitLabel ? ` ${ref.unitLabel}` : ''}</strong>, so I haven't filed this email anywhere.</p>
      <p>Check the unit number, or open the unit in MAIA and start the application first — then forward this again.</p>`)
  }
  if (r.reason === 'empty-body') {
    return wrap(`<p>I found the application for <strong>${ref.associationCode} ${r.unitLabel ?? ''}</strong>, but after removing the command line there was no text left to file.</p>
      <p>Forward the message with the conversation included below your "@maia update application" line.</p>`)
  }
  if (!r.ok) {
    return wrap(`<p>I couldn't file this against <strong>${ref.associationCode} ${r.unitLabel ?? ''}</strong>: ${r.detail ?? 'unknown error'}.</p>`)
  }
  const link = `${APP}/admin/pre-apply/${r.applicationId}`
  if (r.duplicate) {
    return wrap(`<p>This email was already filed against <strong>${ref.associationCode} ${r.unitLabel ?? ''}</strong> — I haven't added a second copy.</p>
      <p><a href="${link}">Open the application →</a></p>`)
  }
  return wrap(`<p>Filed in the communication history for <strong>${ref.associationCode} ${r.unitLabel ?? ''}</strong>.</p>
    <p style="color:#6b7280">“${(subject || 'no subject').slice(0, 120)}”</p>
    <p><a href="${link}">Open the application →</a></p>`)
}
