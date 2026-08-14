// POST /api/request/[token]/contact   { people: [{ name, email, phone }] }
// Public (token-gated): the owner fills in WHO is going to live in the unit —
// every tenant/occupant's name, email and phone — when the lease didn't carry
// them. No login.
//
// This builds the roster, it doesn't just patch one row. Before, it could only
// write an email/phone onto an applicant who already existed, which was exactly
// backwards: the case where we most need the owner to tell us who the tenants
// are is the case where nobody is on the roster yet. It also accepted a single
// person, so a couple or a family could never be captured.
//
// Once the roster lands, any tenant items that were HELD on this request (we
// had nothing to send them to) go out on their own.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { normalizePhone } from '@/lib/cinc-sync'
import { sendDocumentRequestEmails, splitEmails } from '@/lib/document-request-email'
import { applicantRoleLabel, isApplicantRole } from '@/lib/applicant-roles'
import { loadRequest } from '../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)

interface Person { name: string; email: string; phone: string; role: string }

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await loadRequest(token)
  if (!r) return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 404 })
  if (!r.mine.some(i => i.doc_key === 'tenant_contact_info')) return NextResponse.json({ error: 'Contact info was not requested on this link.' }, { status: 400 })

  let b: { people?: unknown; name?: string; email?: string; phone?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  // Accept the list form, and the older single-person body.
  const raw: unknown[] = Array.isArray(b.people) ? b.people : [{ name: b.name, email: b.email, phone: b.phone }]
  const people: Person[] = raw.map(x => {
    const o = (x ?? {}) as Record<string, unknown>
    return {
      name: String(o.name ?? '').trim(),
      email: String(o.email ?? '').trim(),
      phone: String(o.phone ?? '').trim(),
      role: String(o.role ?? '').trim() || 'tenant',
    }
  }).filter(p => p.name || p.email || p.phone)

  if (people.length === 0) return NextResponse.json({ error: 'Please add at least one person.' }, { status: 400 })
  for (const p of people) {
    if (!p.name) return NextResponse.json({ error: 'Please enter a name for everyone on the list.' }, { status: 400 })
    if (!p.email.includes('@')) return NextResponse.json({ error: `Please enter a valid email for ${p.name}.` }, { status: 400 })
    if (!p.phone) return NextResponse.json({ error: `Please enter a phone number for ${p.name}.` }, { status: 400 })
  }

  const appId = String(r.req.application_id)
  const { data: existing } = await supabaseAdmin.from('application_stakeholders')
    .select('id, name, email, is_primary').eq('application_id', appId).eq('role', 'applicant')

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  let primaryTaken = (existing ?? []).some(e => e.is_primary)

  for (const p of people) {
    const phone = normalizePhone(p.phone) ?? p.phone   // E.164 / WhatsApp-ready
    const role = isApplicantRole(p.role) ? p.role : 'tenant'
    // Match an existing roster row by email first, then by name, so a second
    // submission corrects people instead of duplicating them.
    const match = (existing ?? []).find(e => norm(String(e.email ?? '')) === norm(p.email) && p.email)
      ?? (existing ?? []).find(e => norm(String(e.name ?? '')) === norm(p.name))
    if (match) {
      const { error } = await supabaseAdmin.from('application_stakeholders')
        .update({ name: p.name, email: p.email, phone, applicant_role: role, updated_at: new Date().toISOString() })
        .eq('id', match.id)
      if (error) return NextResponse.json({ error: `Could not save ${p.name}: ${error.message}` }, { status: 500 })
    } else {
      // NOTE: listing_id must stay NULL here. A stakeholder attaches to a
      // listing OR an application, never both — the `stakeholder_attached_once`
      // check constraint rejects the row outright if you set both.
      const { error } = await supabaseAdmin.from('application_stakeholders').insert({
        application_id: appId, role: 'applicant',
        name: p.name, email: p.email, phone, applicant_role: role,
        is_primary: !primaryTaken, added_by_role: 'owner', status: 'pending',
      })
      if (error) return NextResponse.json({ error: `Could not save ${p.name}: ${error.message}` }, { status: 500 })
      if (!primaryTaken) primaryTaken = true
    }
  }

  // Release any tenant items that were waiting on an address.
  let tenantSent = false
  const items = (Array.isArray(r.req.items) ? r.req.items : []) as { recipient?: string }[]
  const hasTenantItems = items.some(i => i.recipient === 'tenant' || i.recipient === 'both')
  if (hasTenantItems && !r.req.tenant_token) {
    const tenantEmails = [...new Set(people.map(p => p.email))]
    const { error: upErr } = await supabaseAdmin.from('document_requests')
      .update({ tenant_token: crypto.randomUUID(), tenant_email: tenantEmails.join(', ') }).eq('id', r.req.id)
    if (!upErr) {
      const res = await sendDocumentRequestEmails(String(r.req.id), { only: 'tenant' })
      tenantSent = res.sentTenant
    }
  } else if (hasTenantItems && r.req.tenant_token && !splitEmails(r.req.tenant_email as string | null).length) {
    await supabaseAdmin.from('document_requests').update({ tenant_email: [...new Set(people.map(p => p.email))].join(', ') }).eq('id', r.req.id)
    const res = await sendDocumentRequestEmails(String(r.req.id), { only: 'tenant' })
    tenantSent = res.sentTenant
  }

  if (NOTIFY.length) {
    const rows = people.map(p => `<li><strong>${p.name}</strong> (${applicantRoleLabel(isApplicantRole(p.role) ? p.role : 'tenant')}) — ${p.email} · ${p.phone}</li>`).join('')
    void sendEmail({ to: NOTIFY, subject: `Tenant roster provided — ${r.req.association_code} Unit ${r.req.unit_label ?? '—'}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6">
        <p>The owner provided the tenant roster for <strong>${r.req.association_code}, Unit ${r.req.unit_label ?? '—'}</strong>:</p>
        <ul>${rows}</ul>
        ${tenantSent ? '<p>The documents requested from the tenant have been emailed to them automatically.</p>' : ''}
        <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'}/admin/pre-apply/${appId}">Open the application →</a></p>
      </div>` }).catch(() => null)
  }

  return NextResponse.json({ ok: true, saved: people.length, tenantSent })
}
