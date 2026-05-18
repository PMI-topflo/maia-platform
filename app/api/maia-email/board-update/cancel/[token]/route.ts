// =====================================================================
// app/api/maia-email/board-update/cancel/[token]/route.ts
//
// Pair of confirm/[token]. Marks the pending row as cancelled, emails
// the requester a short notice, renders a confirmation HTML page.
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail }     from '@/lib/gmail'

export const dynamic = 'force-dynamic'

function htmlShell(title: string, body: string, color: '#15803d' | '#b91c1c' | '#6b7280' = '#6b7280'): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:-apple-system,system-ui,sans-serif;background:#f9fafb;margin:0;padding:40px 20px;color:#222">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;border-top:4px solid ${color}">
    <h1 style="margin:0 0 16px 0;font-size:22px;color:${color}">${title}</h1>
    ${body}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 12px">
    <p style="color:#9ca3af;font-size:11px;margin:0">MAIA · PMI Top Florida Properties</p>
  </div>
</body></html>`
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params

  const { data: row, error } = await supabaseAdmin
    .from('maia_pending_board_updates')
    .select('id, association_name, requester_email, requester_name, reply_subject, status, applied_at, cancelled_at')
    .eq('confirm_token', token)
    .maybeSingle()
  if (error) {
    return new NextResponse(htmlShell('Lookup error', `<p>${error.message}</p>`, '#b91c1c'), { headers: { 'content-type': 'text/html' } })
  }
  if (!row) {
    return new NextResponse(htmlShell('Not found', `<p>This cancellation link is unknown or has been removed.</p>`, '#b91c1c'), { status: 404, headers: { 'content-type': 'text/html' } })
  }
  if (row.status === 'applied') {
    return new NextResponse(htmlShell('Cannot cancel — already applied', `<p>This update was already applied${row.applied_at ? ` on ${new Date(row.applied_at).toLocaleString()}` : ''}. To revert, edit the board members manually in the admin UI.</p>`, '#b91c1c'), { headers: { 'content-type': 'text/html' } })
  }
  if (row.status === 'cancelled') {
    return new NextResponse(htmlShell('Already cancelled', `<p>This request was already cancelled${row.cancelled_at ? ` on ${new Date(row.cancelled_at).toLocaleString()}` : ''}.</p>`, '#6b7280'), { headers: { 'content-type': 'text/html' } })
  }

  await supabaseAdmin
    .from('maia_pending_board_updates')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', row.id)

  await sendEmail({
    to:      row.requester_email,
    subject: `${row.reply_subject ?? 'Board update'} — cancelled`,
    html:    `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p style="margin-top:0">Hi ${row.requester_name || 'there'},</p>
<p>The pending board update for <strong>${row.association_name}</strong> has been cancelled. Nothing was changed.</p>
<p style="font-size:13px;color:#6b7280">Send a fresh <code>@maia update board members</code> email if you want to try again.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 12px">
<p style="color:#9ca3af;font-size:11px;margin:0">MAIA · PMI Top Florida Properties</p>
</body></html>`,
  }).catch(err => console.error('[board-update/cancel] notice email failed:', err))

  return new NextResponse(htmlShell(
    'Cancelled',
    `<p>The pending board update for <strong>${row.association_name}</strong> has been cancelled. Nothing has been changed. You can close this tab.</p>`,
    '#6b7280',
  ), { headers: { 'content-type': 'text/html' } })
}
