// =====================================================================
// app/api/profile-change/reject/[token]/route.ts
// Pair of approve/. Marks the pending row rejected, notifies the
// requester, and renders an HTML confirmation back to the browser.
// =====================================================================

import { NextResponse } from 'next/server'
import { findPending, applyRejection, type PendingChange } from '@/lib/profile-change'

export const dynamic = 'force-dynamic'

function html(title: string, body: string, color: '#15803d' | '#b91c1c' | '#6b7280' = '#6b7280'): string {
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

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  const row = await findPending('reject_token', token)
  if (!row) {
    return new NextResponse(html('Not found', `<p>This rejection link is unknown or has been removed.</p>`, '#b91c1c'), { status: 404, headers: { 'content-type': 'text/html' } })
  }

  const guard = checkStatus(row)
  if (guard) return guard

  await applyRejection(row)

  return new NextResponse(
    html('Email change rejected', `<p>The pending email change for ${row.requester_name || 'the requester'} (proposed: <strong>${row.proposed_value}</strong>) has been declined. They've been notified.</p>`, '#6b7280'),
    { headers: { 'content-type': 'text/html' } },
  )
}

function checkStatus(row: PendingChange): NextResponse | null {
  if (row.status === 'approved') return new NextResponse(html('Cannot reject — already approved', `<p>This change was already approved${row.decided_at ? ` on ${new Date(row.decided_at).toLocaleString()}` : ''}. To revert, edit the record directly in Supabase or have the user submit a new change.</p>`, '#b91c1c'), { headers: { 'content-type': 'text/html' } })
  if (row.status === 'rejected') return new NextResponse(html('Already rejected', `<p>This change was already rejected${row.decided_at ? ` on ${new Date(row.decided_at).toLocaleString()}` : ''}.</p>`, '#6b7280'), { headers: { 'content-type': 'text/html' } })
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return new NextResponse(html('Expired', `<p>This link expired on ${new Date(row.expires_at).toLocaleString()}.</p>`, '#b91c1c'), { status: 410, headers: { 'content-type': 'text/html' } })
  }
  return null
}
