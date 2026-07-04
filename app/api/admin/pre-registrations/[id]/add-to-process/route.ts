// =====================================================================
// POST /api/admin/pre-registrations/[id]/add-to-process   (staff-only)
// For a buyer/tenant persona wanting to apply for a unit — emails them the
// public /apply link and marks the pre-registration 'contacted'. Does NOT
// approve/add them to the system; that only happens once the application
// itself is submitted and (for an existing tenant) verified.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = typeof session.userId === 'string' ? session.userId : 'staff'

  const { id } = await ctx.params
  const { data: row } = await supabaseAdmin.from('pre_registrations')
    .select('id, full_name, email, persona, association, unit').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!row.email) return NextResponse.json({ error: 'No email on file for this contact.' }, { status: 409 })
  if (row.persona !== 'buyer' && row.persona !== 'tenant') {
    return NextResponse.json({ error: `"Add to process" is for buyer/tenant applicants, not persona "${row.persona}".` }, { status: 400 })
  }

  const applyLink = `${APP}/apply`
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p>Hi ${row.full_name ?? 'there'},</p>
    <p>Thanks for reaching out${row.association ? ` about <strong>${row.association}</strong>` : ''}${row.unit ? ` (unit ${row.unit})` : ''}. To get started, please complete our application here:</p>
    <p><a href="${applyLink}" style="display:inline-block;background:#f26a1b;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:700">Start your application →</a></p>
    <p style="color:#9ca3af;font-size:12px;margin-top:20px">Questions? <a href="mailto:service@topfloridaproperties.com" style="color:#f26a1b">service@topfloridaproperties.com</a> · 305.900.5077</p>
  </div>`

  try {
    await sendEmail({ to: row.email, subject: 'Your application — PMI Top Florida Properties', html })
  } catch (e) {
    return NextResponse.json({ error: `Send failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  await supabaseAdmin.from('pre_registrations').update({
    status: 'contacted', handled_by: me, handled_at: new Date().toISOString(),
  }).eq('id', id)

  return NextResponse.json({ ok: true })
}
