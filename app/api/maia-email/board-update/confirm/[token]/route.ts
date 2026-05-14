// =====================================================================
// app/api/maia-email/board-update/confirm/[token]/route.ts
//
// Magic-link target for the `@maia update board members` flow. Looks
// up the pending row by token, applies the change atomically (mark
// existing active members inactive + insert the proposed ones), emails
// the requester a "done" notice, and renders a simple HTML page back
// to the staff member's browser.
//
// All state checks live here so retrying the link is safe:
//   - status='pending' & expires_at>now → apply
//   - status='applied' → noop ("Already applied at …")
//   - status='cancelled' → noop ("Cancelled at …")
//   - status='pending' & expires_at<=now → mark expired
//   - token unknown → 404 page
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail }     from '@/lib/gmail'

export const dynamic = 'force-dynamic'

interface PendingRow {
  id:                string
  association_code:  string
  association_name:  string
  requester_email:   string
  requester_name:    string | null
  new_members:       Array<{ name: string; role: string | null; email?: string | null }>
  current_members:   Array<{ name: string; role: string | null }>
  reply_subject:     string | null
  status:            'pending' | 'applied' | 'cancelled' | 'expired'
  expires_at:        string
  applied_at:        string | null
  cancelled_at:      string | null
}

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
    .select('id, association_code, association_name, requester_email, requester_name, new_members, current_members, reply_subject, status, expires_at, applied_at, cancelled_at')
    .eq('confirm_token', token)
    .maybeSingle<PendingRow>()
  if (error) {
    console.error('[board-update/confirm] lookup error:', error.message)
    return new NextResponse(htmlShell('Lookup error', `<p>${error.message}</p>`, '#b91c1c'), { headers: { 'content-type': 'text/html' } })
  }
  if (!row) {
    return new NextResponse(htmlShell('Not found', `<p>This confirmation link is unknown or has been removed.</p>`, '#b91c1c'), { status: 404, headers: { 'content-type': 'text/html' } })
  }

  // Idempotency on retry: already-applied / cancelled / expired just shows status.
  if (row.status === 'applied') {
    return new NextResponse(htmlShell('Already applied', `<p>This update was already applied${row.applied_at ? ` on ${new Date(row.applied_at).toLocaleString()}` : ''}. No further action is needed.</p>`), { headers: { 'content-type': 'text/html' } })
  }
  if (row.status === 'cancelled') {
    return new NextResponse(htmlShell('Cancelled', `<p>This request was cancelled${row.cancelled_at ? ` on ${new Date(row.cancelled_at).toLocaleString()}` : ''}. Nothing has been changed.</p>`, '#6b7280'), { headers: { 'content-type': 'text/html' } })
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await supabaseAdmin.from('maia_pending_board_updates').update({ status: 'expired' }).eq('id', row.id)
    return new NextResponse(htmlShell('Expired', `<p>This request expired on ${new Date(row.expires_at).toLocaleString()}. Send a fresh <code>@maia update board members</code> email to start again.</p>`, '#b91c1c'), { status: 410, headers: { 'content-type': 'text/html' } })
  }

  // Apply: deactivate currently-active members, insert the new set.
  const { error: deactErr } = await supabaseAdmin
    .from('association_board_members')
    .update({ active: false })
    .eq('association_code', row.association_code)
    .eq('active', true)
  if (deactErr) {
    console.error('[board-update/confirm] deactivate error:', deactErr.message)
    return new NextResponse(htmlShell('Database error', `<p>Failed to deactivate previous board: ${deactErr.message}</p>`, '#b91c1c'), { status: 500, headers: { 'content-type': 'text/html' } })
  }

  const inserts = row.new_members.map((m, idx) => ({
    association_code: row.association_code,
    name:             m.name,
    email:            m.email ?? null,
    role:             m.role  ?? null,
    sort_order:       idx,
    active:           true,
  }))
  if (inserts.length > 0) {
    const { error: insErr } = await supabaseAdmin
      .from('association_board_members')
      .insert(inserts)
    if (insErr) {
      console.error('[board-update/confirm] insert error:', insErr.message)
      return new NextResponse(htmlShell('Database error', `<p>Failed to insert new board members: ${insErr.message}. Previous board has been deactivated; you may want to restore manually via /admin.</p>`, '#b91c1c'), { status: 500, headers: { 'content-type': 'text/html' } })
    }
  }

  await supabaseAdmin
    .from('maia_pending_board_updates')
    .update({ status: 'applied', applied_at: new Date().toISOString() })
    .eq('id', row.id)

  // Email a confirmation to the requester.
  const memberList = row.new_members
    .map(m => `<li>${m.name}${m.role ? ` — ${m.role}` : ''}</li>`)
    .join('')
  await sendEmail({
    to:      row.requester_email,
    subject: `${row.reply_subject ?? 'Board update'} — applied`,
    html:    `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p style="margin-top:0">Hi ${row.requester_name || 'there'},</p>
<p>The board for <strong>${row.association_name}</strong> has been updated. ${row.current_members.length} previous member${row.current_members.length === 1 ? '' : 's'} marked inactive; the new board is:</p>
<ul style="margin:8px 0 16px 18px;padding:0">${memberList}</ul>
<p style="font-size:13px;color:#6b7280">View / edit at the board members admin page.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 12px">
<p style="color:#9ca3af;font-size:11px;margin:0">MAIA · PMI Top Florida Properties</p>
</body></html>`,
  }).catch(err => console.error('[board-update/confirm] confirmation email failed:', err))

  return new NextResponse(htmlShell(
    'Board updated',
    `<p>The board for <strong>${row.association_name}</strong> has been updated. A confirmation has been emailed to ${row.requester_email}. You can close this tab.</p>`,
    '#15803d',
  ), { headers: { 'content-type': 'text/html' } })
}
