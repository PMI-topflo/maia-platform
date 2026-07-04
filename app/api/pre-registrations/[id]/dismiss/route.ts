// =====================================================================
// app/api/pre-registrations/[id]/dismiss/route.ts
// Magic-link handler for one-click "Dismiss" from the staff alert email.
// URL: /api/pre-registrations/<id>/dismiss?token=<HMAC>
// No session required — mirrors app/api/tickets/[id]/assign/route.ts.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyPreregDismissToken } from '@/lib/prereg-tokens'

export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return htmlPage('Missing parameters', 'The link is missing required information.', false)

  const ok = await verifyPreregDismissToken(token, id)
  if (!ok) {
    return htmlPage(
      'Link expired or invalid',
      'This link is no longer valid. Open the dashboard to dismiss manually.',
      false,
      `${APP_URL}/admin/pre-registrations`,
    )
  }

  const { data: row } = await supabaseAdmin.from('pre_registrations').select('id, full_name, status').eq('id', id).maybeSingle()
  if (!row) return htmlPage('Not found', 'This pre-registration no longer exists.', false)

  if (row.status === 'dismissed') {
    return htmlPage('Already dismissed', `${row.full_name ?? 'This request'} was already dismissed.`, true, `${APP_URL}/admin/pre-registrations`)
  }

  await supabaseAdmin.from('pre_registrations').update({
    status: 'dismissed', handled_by: 'magic-link', handled_at: new Date().toISOString(),
  }).eq('id', id)

  return htmlPage('Dismissed', `${row.full_name ?? 'This request'} has been dismissed.`, true, `${APP_URL}/admin/pre-registrations`)
}

function htmlPage(title: string, message: string, success: boolean, cta?: string): NextResponse {
  const accent = success ? '#f26a1b' : '#dc2626'
  const icon   = success ? '✓' : '✕'
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
  ${cta ? `<a class="cta" href="${cta}">Open dashboard</a>` : ''}
</div>
</body></html>`
  return new NextResponse(html, { status: success ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
