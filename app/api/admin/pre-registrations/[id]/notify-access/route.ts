// =====================================================================
// POST /api/admin/pre-registrations/[id]/notify-access   (staff-only)
// Sends the "you're all set" email once a pre-registered contact has been
// approved/added to the system. Persona-aware copy. Manual/resendable —
// vendor onboarding already sends its own link automatically (skip here).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

const COPY: Record<string, { subject: string; body: (assoc: string | null) => string }> = {
  owner: {
    subject: "You're set up — PMI Top Florida Properties",
    body: assoc => `<p>You're on file as an owner${assoc ? ` at <strong>${assoc}</strong>` : ''}. Call or text us anytime — we'll recognize your number, or you can log in at <a href="${APP}/my-account">${APP}/my-account</a> with a one-time code sent to this email or your phone.</p>`,
  },
  board: {
    subject: "You're set up — PMI Top Florida Properties",
    body: assoc => `<p>You're on file as a board member${assoc ? ` at <strong>${assoc}</strong>` : ''}. Log in anytime at <a href="${APP}/board">${APP}/board</a> with a one-time code sent to this email or your phone.</p>`,
  },
  agent: {
    subject: 'Your PMI Top Florida Agent Registration — Approved ✅',
    body: () => `<p>We're pleased to inform you that your registration with PMI Top Florida Properties has been <strong style="color:#22c55e">approved</strong>! You can now access our network and receive listing referrals.</p>`,
  },
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const { data: row } = await supabaseAdmin.from('pre_registrations')
    .select('id, full_name, email, persona, association').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!row.email) return NextResponse.json({ error: 'No email on file for this contact.' }, { status: 409 })

  const copy = COPY[row.persona as string]
  if (!copy) return NextResponse.json({ error: `No notify-access template for persona "${row.persona}".` }, { status: 400 })

  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p>Hi ${row.full_name ?? 'there'},</p>
    ${copy.body(row.association)}
    <p style="color:#9ca3af;font-size:12px;margin-top:20px">Questions? <a href="mailto:service@topfloridaproperties.com" style="color:#f26a1b">service@topfloridaproperties.com</a> · 305.900.5077</p>
  </div>`

  try {
    await sendEmail({ to: row.email, subject: copy.subject, html })
  } catch (e) {
    return NextResponse.json({ error: `Send failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
