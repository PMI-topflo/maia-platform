// =====================================================================
// POST /api/admin/compliance/request-tenant  { assoc, unit_ref }   staff-only
// Closes the loop: once an owner reports a unit is leased and gives the
// tenant's contact, staff (Jonathan) triggers this to email the TENANT their
// own self-service link to provide renters insurance (HO-4), contact info,
// usage type, registrations, etc.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { signTenantComplianceToken } from '@/lib/owner-portal-token'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { assoc?: string; unit_ref?: string; email?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const assoc = String(body.assoc ?? '').trim().toUpperCase()
  const unitRef = String(body.unit_ref ?? '').trim()
  if (!assoc || !unitRef) return NextResponse.json({ error: 'assoc and unit_ref are required' }, { status: 400 })

  const { data: tc } = await supabaseAdmin.from('unit_tenant_contacts')
    .select('tenant_name, tenant_email').eq('association_code', assoc).eq('unit_ref', unitRef).maybeSingle()
  const to = (body.email || tc?.tenant_email || '').trim()
  if (!to || !to.includes('@')) return NextResponse.json({ error: 'No tenant email on file — add one or pass it in.' }, { status: 400 })

  const link = `${APP}/renter/compliance/${await signTenantComplianceToken(assoc, unitRef)}`
  const name = (tc?.tenant_name as string | null) ?? null
  await sendEmail({
    to,
    subject: 'Your unit documents — PMI Top Florida Properties',
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
      <p>Hello${name ? ` ${esc(name)}` : ''},</p>
      <p>PMI Top Florida Properties manages your community. To keep your file current, please use the secure link below to confirm your contact information and upload a few documents — including your <strong>renters insurance (HO-4)</strong>.</p>
      <p style="margin:22px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">Provide your information →</a></p>
      <p style="color:#6b7280;font-size:12px">No account needed. This link is specific to your unit and expires in 30 days.</p>
      <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p>
    </div>`,
  })
  return NextResponse.json({ ok: true, sentTo: to })
}
