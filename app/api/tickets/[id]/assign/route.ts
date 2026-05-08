// =====================================================================
// app/api/tickets/[id]/assign/route.ts
// Magic-link handler for one-click ticket assignment from email.
//
// URL: /api/tickets/<id>/assign?to=<email>&token=<HMAC>
//
// Token authenticates the action — no session cookie required so the
// link works straight from a Gmail tab. Verifies the HMAC, updates
// the ticket's assignee_email, sends the standard "you've been
// assigned" notification, and renders a small success page that
// links back to the ticket detail.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { updateTicket } from '@/lib/tickets'
import { sendEmail } from '@/lib/gmail'
import { verifyAssignToken } from '@/lib/ticket-assign-tokens'

export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const ticketId = Number(id)
  if (!Number.isFinite(ticketId)) {
    return htmlPage('Invalid ticket id', 'The link in your email is malformed.', false)
  }

  const to    = req.nextUrl.searchParams.get('to')?.toLowerCase()
  const token = req.nextUrl.searchParams.get('token')
  if (!to || !token) {
    return htmlPage('Missing parameters', 'The link is missing required information.', false)
  }

  const ok = await verifyAssignToken(token, ticketId, to)
  if (!ok) {
    return htmlPage(
      'Link expired or invalid',
      "This assignment link is no longer valid. Open the ticket in the dashboard to assign manually.",
      false,
      `${APP_URL}/admin/tickets/${ticketId}`,
    )
  }

  const { data: ticket } = await supabaseAdmin
    .from('tickets')
    .select('id, ticket_number, type, subject, assignee_email')
    .eq('id', ticketId)
    .single()
  if (!ticket) {
    return htmlPage('Ticket not found', 'This ticket no longer exists.', false)
  }

  // Resolve the assignee's display name for the success page (best-effort).
  const { data: staffRow } = await supabaseAdmin
    .from('pmi_staff')
    .select('name')
    .eq('email', to)
    .maybeSingle()
  const assigneeName = staffRow?.name ?? to

  // No-op if already assigned to this email — show success without spamming
  // a second notification.
  if (ticket.assignee_email?.toLowerCase() === to) {
    return htmlPage(
      'Already assigned',
      `${ticket.ticket_number} is already assigned to ${assigneeName}.`,
      true,
      `${APP_URL}/admin/tickets/${ticketId}`,
    )
  }

  await updateTicket(ticketId, { assignee_email: to }, 'magic-link')

  // Send the standard "you've been assigned" notification (skip if the
  // assignee is the system mailbox itself).
  if (to !== 'maia@pmitop.com') {
    try {
      await sendEmail({
        to,
        subject: `🎫 You've been assigned ${ticket.ticket_number} — ${ticket.subject ?? '(no subject)'}`,
        html: `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p style="font-size:14px;color:#555">You've been assigned a ${ticket.type === 'work_order' ? 'work order' : 'ticket'}:</p>
<div style="background:#f9fafb;border-left:3px solid #f26a1b;padding:12px 16px;margin:16px 0">
  <div style="font-family:ui-monospace,monospace;font-size:12px;color:#6b7280">${ticket.ticket_number}</div>
  <div style="font-size:16px;font-weight:600;margin-top:4px">${ticket.subject ?? '(no subject)'}</div>
</div>
<p style="font-size:14px;margin-top:24px">
  <a href="${APP_URL}/admin/tickets/${ticketId}" style="background:#f26a1b;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:500">Open ticket</a>
</p>
</body></html>`,
      })
    } catch (err) {
      console.error('[assign-link] notification email failed:', err instanceof Error ? err.message : err)
    }
  }

  return htmlPage(
    'Assigned',
    `${ticket.ticket_number} is now assigned to ${assigneeName}.`,
    true,
    `${APP_URL}/admin/tickets/${ticketId}`,
  )
}

function htmlPage(
  title:    string,
  message:  string,
  success:  boolean,
  cta?:     string,
): NextResponse {
  const accent  = success ? '#f26a1b' : '#dc2626'
  const icon    = success ? '✓' : '✕'
  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — PMI Top Florida</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background:#f9fafb; color:#111827; margin:0; padding:0; min-height:100vh; display:flex; align-items:center; justify-content:center; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:32px 28px; max-width:420px; width:90%; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,0.05); }
  .icon { font-size:48px; color:${accent}; margin-bottom:12px; line-height:1; }
  h1 { font-size:18px; font-weight:600; margin:0 0 8px; }
  p { font-size:14px; color:#6b7280; margin:0 0 20px; }
  a.cta { display:inline-block; background:${accent}; color:#fff; padding:10px 20px; border-radius:6px; text-decoration:none; font-weight:500; font-size:14px; }
</style>
</head><body>
<div class="card">
  <div class="icon">${icon}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  ${cta ? `<a class="cta" href="${cta}">Open ticket</a>` : ''}
</div>
</body></html>`
  return new NextResponse(html, {
    status: success ? 200 : 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
