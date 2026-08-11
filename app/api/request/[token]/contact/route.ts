// POST /api/request/[token]/contact   { email, phone }
// Public (token-gated): the owner fills in the tenant's email + phone when the
// lease didn't have them. Saved onto the primary applicant. No login.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { normalizePhone } from '@/lib/cinc-sync'
import { loadRequest } from '../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await loadRequest(token)
  if (!r) return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 404 })
  if (!r.mine.some(i => i.doc_key === 'tenant_contact_info')) return NextResponse.json({ error: 'Contact info was not requested on this link.' }, { status: 400 })

  let b: { email?: string; phone?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const email = String(b.email ?? '').trim()
  const rawPhone = String(b.phone ?? '').trim()
  if (!email.includes('@')) return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  if (!rawPhone) return NextResponse.json({ error: 'Please enter a phone number.' }, { status: 400 })
  const phone = normalizePhone(rawPhone) ?? rawPhone   // E.164 / WhatsApp-ready

  const appId = String(r.req.application_id)
  const { data: primary } = await supabaseAdmin.from('application_stakeholders')
    .select('id, name').eq('application_id', appId).eq('role', 'applicant').eq('is_primary', true).maybeSingle()
  if (!primary) return NextResponse.json({ error: 'No applicant on file for this application.' }, { status: 404 })

  const { error } = await supabaseAdmin.from('application_stakeholders')
    .update({ email, phone, updated_at: new Date().toISOString() }).eq('id', primary.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (NOTIFY.length) {
    void sendEmail({ to: NOTIFY, subject: `Tenant contact provided — ${r.req.association_code} Unit ${r.req.unit_label ?? '—'}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6">
        <p>The owner provided the tenant's contact for <strong>${r.req.association_code}, Unit ${r.req.unit_label ?? '—'}</strong> (${primary.name ?? 'applicant'}): <strong>${email}</strong> · ${phone}.</p>
        <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'}/admin/pre-apply/${appId}">Open the application →</a></p>
      </div>` }).catch(() => null)
  }
  return NextResponse.json({ ok: true })
}
