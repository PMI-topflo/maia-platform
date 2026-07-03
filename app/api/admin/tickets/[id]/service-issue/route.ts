// =====================================================================
// POST /api/admin/tickets/[id]/service-issue
// Route a recurring-service complaint to the vendor's NEXT visit instead of a
// standalone work order. Creates a service_issue, emails the vendor (with the
// resident's "before" photo + Paola's note), Paola, and (optionally) the
// resident, and logs it on the ticket. Staff-only.
// Body: { recurring_service_id, note?, resident_email? }
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { appendMessage } from '@/lib/tickets'
import { VENDOR_REPLY_TO, PAOLA_EMAIL } from '@/lib/notify-recipients'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ORANGE = '#f26a1b'
const esc = (s: string) => (s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

/** Next expected visit date for a recurring service (date-only, local). */
function nextVisitDate(svc: { cadence?: string | null; expected_day?: number | null; monthly_day?: number | null }): string {
  const now = new Date()
  const cadence = (svc.cadence ?? 'weekly').toLowerCase()
  if (cadence.includes('month') && svc.monthly_day) {
    const d = new Date(now.getFullYear(), now.getMonth(), svc.monthly_day)
    if (d <= now) d.setMonth(d.getMonth() + 1)
    return d.toISOString().slice(0, 10)
  }
  // weekly / biweekly → next occurrence of expected_day (0=Sun..6=Sat), default Monday.
  const target = typeof svc.expected_day === 'number' ? svc.expected_day : 1
  const d = new Date(now)
  let add = (target - d.getDay() + 7) % 7
  if (add === 0) add = 7
  d.setDate(d.getDate() + add)
  return d.toISOString().slice(0, 10)
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const ticketId = parseInt(id, 10)
  if (!Number.isFinite(ticketId)) return NextResponse.json({ error: 'bad id' }, { status: 400 })

  const { data: ticket } = await supabaseAdmin.from('tickets').select('association_code, work_order_type_name').eq('id', ticketId).maybeSingle()
  if (!ticket?.association_code) return NextResponse.json({ recurringServices: [], existing: null })

  const { data: svcs } = await supabaseAdmin.from('recurring_services')
    .select('id, vendor_name, service_type, cadence, office_email').eq('association_code', ticket.association_code).eq('active', true).order('service_type', { ascending: true })
  const { data: existing } = await supabaseAdmin.from('service_issues')
    .select('id, vendor_name, service_type, next_visit_date, status').eq('ticket_id', ticketId).order('created_at', { ascending: false }).limit(1).maybeSingle()

  return NextResponse.json({
    recurringServices: (svcs ?? []).map(s => ({ id: s.id, vendor_name: s.vendor_name, service_type: s.service_type, cadence: s.cadence, hasEmail: !!s.office_email })),
    woType: ticket.work_order_type_name ?? null,
    existing: existing ?? null,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actor = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null

  const { id } = await ctx.params
  const ticketId = parseInt(id, 10)
  if (!Number.isFinite(ticketId)) return NextResponse.json({ error: 'bad id' }, { status: 400 })

  let body: { recurring_service_id?: number; note?: string; resident_email?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const rsId = Number(body.recurring_service_id)
  if (!Number.isFinite(rsId)) return NextResponse.json({ error: 'recurring_service_id is required' }, { status: 400 })
  const note = (body.note ?? '').trim()
  const residentEmail = (body.resident_email ?? '').trim()

  const { data: ticket } = await supabaseAdmin.from('tickets').select('id, ticket_number, subject, association_code').eq('id', ticketId).maybeSingle()
  if (!ticket) return NextResponse.json({ error: 'ticket not found' }, { status: 404 })

  const { data: svc } = await supabaseAdmin.from('recurring_services')
    .select('id, association_code, vendor_name, cinc_vendor_id, service_type, cadence, expected_day, monthly_day, office_email')
    .eq('id', rsId).maybeSingle()
  if (!svc) return NextResponse.json({ error: 'recurring service not found' }, { status: 404 })
  const vendorEmail = (svc.office_email as string | null) ?? null
  const visitDate = nextVisitDate(svc as { cadence?: string | null; expected_day?: number | null; monthly_day?: number | null })

  // Resident's "before" photo — first image attached to the ticket.
  let issuePhotoPath: string | null = null
  let issuePhotoUrl: string | null = null
  const { data: att } = await supabaseAdmin.from('work_order_attachments')
    .select('storage_path, mime_type').eq('ticket_id', ticketId).ilike('mime_type', 'image/%').order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (att?.storage_path) {
    issuePhotoPath = att.storage_path as string
    const { data: signed } = await supabaseAdmin.storage.from('work-order-photos').createSignedUrl(att.storage_path as string, 60 * 60 * 24 * 14)
    issuePhotoUrl = signed?.signedUrl ?? null
  }

  const issueSummary = (ticket.subject as string) ?? 'Service issue'
  const { data: issue } = await supabaseAdmin.from('service_issues').insert({
    ticket_id: ticketId, association_code: ticket.association_code, recurring_service_id: rsId,
    cinc_vendor_id: svc.cinc_vendor_id ?? null, vendor_name: svc.vendor_name, vendor_email: vendorEmail,
    service_type: svc.service_type, next_visit_date: visitDate, issue_summary: issueSummary,
    paola_note: note || null, issue_photo_path: issuePhotoPath, status: 'sent', created_by: actor,
  }).select('id').single()
  if (!issue) return NextResponse.json({ error: 'could not create service issue' }, { status: 500 })

  const woLabel = `${ticket.ticket_number ?? `#${ticketId}`} · ${ticket.association_code}`
  const niceDate = new Date(`${visitDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const photoBlock = issuePhotoUrl ? `<p><a href="${issuePhotoUrl}" style="display:inline-block;background:${ORANGE};color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:700">View the reported issue →</a></p>` : ''

  // Vendor: fix on the next scheduled visit.
  let vendorNotified = false
  if (vendorEmail && vendorEmail.includes('@')) {
    await sendEmail({
      to: vendorEmail, replyTo: VENDOR_REPLY_TO,
      subject: `Service issue to resolve on your next visit — ${esc(ticket.association_code as string)} (${esc(svc.service_type as string ?? '')})`,
      html: `<p>A resident reported an issue with your <strong>${esc(svc.service_type as string ?? 'service')}</strong> at <strong>${esc(ticket.association_code as string)}</strong>.</p>
        <p><strong>Issue:</strong> ${esc(issueSummary)}</p>
        ${note ? `<p><strong>Note from PMI:</strong> ${esc(note)}</p>` : ''}
        ${photoBlock}
        <p>Please address it on your <strong>next scheduled visit (${niceDate})</strong> and mark it resolved (with a photo) on your visit confirmation link.</p>
        <p style="font-size:12px;color:#6b7280">Reply to reach PMI Top Florida Properties.</p>`,
    }).then(() => { vendorNotified = true }, () => null)
  }

  // Paola: record.
  await sendEmail({ to: PAOLA_EMAIL, subject: `Routed to recurring vendor — ${woLabel}`,
    html: `<p>The complaint <strong>${esc(issueSummary)}</strong> for <strong>${esc(woLabel)}</strong> was routed to <strong>${esc(svc.vendor_name as string)}</strong> to fix on their next visit (${niceDate})${vendorNotified ? '' : ' — ⚠ no vendor office email on file, please notify them'}.</p>` }).catch(() => null)

  // Resident acknowledgment (optional).
  if (residentEmail && residentEmail.includes('@')) {
    await sendEmail({ to: residentEmail, replyTo: VENDOR_REPLY_TO, subject: `We've notified the vendor — ${esc(ticket.association_code as string)}`,
      html: `<p>Thank you for reporting this. We've notified <strong>${esc(svc.vendor_name as string)}</strong>, who services ${esc(svc.service_type as string ?? 'this')} here, to resolve it on their next scheduled visit (around <strong>${niceDate}</strong>).</p><p>If it isn't resolved, just reply and we'll escalate.</p>` }).catch(() => null)
  }

  await appendMessage(ticketId, { direction: 'internal_note', channel: 'internal', from_addr: actor ?? 'staff',
    body: `🔁 Routed to recurring vendor ${svc.vendor_name} (${svc.service_type}) to fix on next visit ${niceDate}.${note ? ` Note: ${note}` : ''}${vendorNotified ? '' : ' ⚠ no vendor email — notify manually.'}` }).catch(() => null)

  return NextResponse.json({ ok: true, service_issue_id: issue.id, vendorNotified, nextVisit: visitDate })
}
