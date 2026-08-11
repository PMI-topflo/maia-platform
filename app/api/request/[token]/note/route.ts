// POST /api/request/[token]/note   { note }
// Public (token-gated): the owner/tenant leaves a message with their upload.
// Registered on the request (owner_note / tenant_note) as communication history.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { loadRequest } from '../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await loadRequest(token)
  if (!r) return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 404 })

  let b: { note?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const note = String(b.note ?? '').trim()

  const { error } = await supabaseAdmin.from('document_requests')
    .update(r.role === 'owner' ? { owner_note: note || null } : { tenant_note: note || null }).eq('id', r.req.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (note && NOTIFY.length) {
    void sendEmail({ to: NOTIFY, subject: `Message from the ${r.role} — ${r.req.association_code} Unit ${r.req.unit_label ?? '—'}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6">
        <p>The ${r.role} left a message on their document request for <strong>${r.req.association_code}, Unit ${r.req.unit_label ?? '—'}</strong>:</p>
        <blockquote style="border-left:3px solid #c0571a;margin:0;padding:6px 12px;color:#1f2937">${note.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))}</blockquote>
        <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'}/admin/pre-apply/${r.req.application_id}">Open the application →</a></p>
      </div>` }).catch(() => null)
  }
  return NextResponse.json({ ok: true })
}
