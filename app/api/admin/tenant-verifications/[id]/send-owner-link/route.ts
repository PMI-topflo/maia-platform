// =====================================================================
// POST /api/admin/tenant-verifications/[id]/send-owner-link   (staff-only)
// Resolves the active owner of record for the (now staff-confirmed)
// association_code + unit_number, and emails them the token-gated
// tenant-verify confirm page. Requires association_code/unit_number to
// already be resolved (PATCH the row first).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { signTenantVerifyToken } from '@/lib/tenant-verification-token'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

function firstEmail(emails: string | null): string | null {
  if (!emails) return null
  return emails.split(/[,;\s]+/).map(s => s.trim()).find(e => e.includes('@')) ?? null
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const { data: v } = await supabaseAdmin.from('tenant_verifications')
    .select('id, association_code, association_name, unit_number, tenant_name').eq('id', id).maybeSingle()
  if (!v) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!v.association_code || !v.unit_number) {
    return NextResponse.json({ error: 'Resolve the real association + unit number first.' }, { status: 409 })
  }

  const { data: owner } = await supabaseAdmin.from('owners')
    .select('account_number, emails, first_name, last_name')
    .eq('association_code', v.association_code).eq('unit_number', v.unit_number)
    .or('status.neq.previous,status.is.null')
    .limit(1).maybeSingle()
  if (!owner?.account_number) return NextResponse.json({ error: 'No owner of record found for that unit.' }, { status: 404 })
  const email = firstEmail(owner.emails as string | null)
  if (!email) return NextResponse.json({ error: 'Owner of record has no email on file.' }, { status: 409 })

  const link = `${APP}/owner/tenant-verify/${await signTenantVerifyToken(id)}`
  const ownerName = [owner.first_name, owner.last_name].filter(Boolean).join(' ').trim()
  try {
    await sendEmail({
      to: email,
      subject: `Please confirm your tenant — ${v.association_name ?? v.association_code} unit ${v.unit_number}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
        <p>Hello${ownerName ? ` ${ownerName}` : ''},</p>
        <p><strong>${v.tenant_name ?? 'Someone'}</strong> has told PMI Top Florida Properties they are the tenant of your unit at <strong>${v.association_name ?? v.association_code}</strong> (Unit ${v.unit_number}).</p>
        <p style="margin:22px 0"><a href="${link}" style="background:#f26a1b;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:700">Confirm →</a></p>
        <p style="color:#6b7280;font-size:12px">No account needed. This link expires in 21 days.</p>
      </div>`,
    })
  } catch (e) {
    return NextResponse.json({ error: `Send failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  await supabaseAdmin.from('tenant_verifications').update({
    owner_account_number: owner.account_number, updated_at: new Date().toISOString(),
  }).eq('id', id)

  return NextResponse.json({ ok: true, sentTo: email })
}
