// =====================================================================
// POST /api/contact/ticket
// A logged-in resident opens a tracked ticket to a department straight from
// the portal's contact cards (instead of an untracked email/phone). Creates
// the ticket, files their message, and emails the department inbox so the
// conversation stays inside MAIA. Session required.
// Body: { dept, subject, message, contactEmail, contactName?, contactPhone? }
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { createTicket, appendMessage } from '@/lib/tickets'
import { sendEmail } from '@/lib/gmail'
import { getAssociationName } from '@/lib/association-name'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

// The four contact-card departments → their inbox.
const DEPTS: Record<string, { email: string; label: string }> = {
  ar:          { email: 'ar@topfloridaproperties.com',      label: 'Accounts Receivable' },
  maintenance: { email: 'service@topfloridaproperties.com', label: 'Maintenance & Service' },
  compliance:  { email: 'support@topfloridaproperties.com', label: 'Compliance & Support' },
  billing:     { email: 'billing@topfloridaproperties.com', label: 'Vendor Billing' },
}

export async function POST(req: Request) {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value ?? '')
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let body: { dept?: string; subject?: string; message?: string; contactEmail?: string; contactName?: string; contactPhone?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const dept = DEPTS[String(body.dept ?? '')]
  if (!dept) return NextResponse.json({ error: 'unknown department' }, { status: 400 })
  const subject = String(body.subject ?? '').trim()
  const message = String(body.message ?? '').trim()
  if (!subject || !message) return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 })

  const assoc = (session.associationCode || '').toUpperCase() || null
  const contactName = String(body.contactName ?? '').trim() || session.contactName || session.displayName || null
  const sessionEmail = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : ''
  const contactEmail = (String(body.contactEmail ?? '').trim() || sessionEmail).toLowerCase() || null
  const contactPhone = String(body.contactPhone ?? '').trim() || null

  const ticket = await createTicket({
    type:             'ticket',
    channel_origin:   'web',
    association_code: assoc,
    persona:          session.persona,
    contact_name:     contactName,
    contact_email:    contactEmail,
    contact_phone:    contactPhone,
    subject:          `[${dept.label}] ${subject}`,
    assignee_email:   dept.email,
  })

  await appendMessage(ticket.id, {
    direction: 'inbound', channel: 'web',
    from_addr: contactEmail ?? 'resident', to_addr: dept.email,
    subject, body: message,
  }).catch(() => null)

  const assocName = await getAssociationName(assoc ?? '') ?? assoc ?? ''
  const who = `${esc(contactName ?? 'A resident')}${assocName ? ` · ${esc(assocName)}` : ''}${contactEmail ? ` · ${esc(contactEmail)}` : ''}${contactPhone ? ` · ${esc(contactPhone)}` : ''}`
  await sendEmail({
    to: dept.email, replyTo: contactEmail ?? undefined,
    subject: `New ${dept.label} request — ${ticket.ticket_number ?? `#${ticket.id}`}`,
    html: `<p><strong>${esc(subject)}</strong></p><p style="white-space:pre-wrap">${esc(message)}</p>
      <p style="font-size:13px;color:#374151;margin-top:14px">From: ${who}</p>
      <p><a href="${APP}/admin/tickets/${ticket.id}" style="display:inline-block;background:#f26a1b;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:700">Open the ticket →</a></p>`,
  }).catch(() => null)

  return NextResponse.json({ ok: true, ticket_number: ticket.ticket_number ?? null })
}
