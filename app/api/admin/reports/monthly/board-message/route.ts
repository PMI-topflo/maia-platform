// =====================================================================
// POST /api/admin/reports/monthly/board-message
//
// Requests a "Message from the Board" for one association's monthly
// report: finds the board president, creates (or reuses) a board_messages
// row, and emails the president a tokenized link to write their note.
//
// Body: { assoc: string; month: 'YYYY-MM' }
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { monthLabel } from '@/lib/monthly-report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

interface Recipient { email: string; name: string; role: string }

/** Find who should write the board message — the president if there is
 *  one on file, otherwise any active board member. */
async function findBoardRecipient(assoc: string): Promise<Recipient | null> {
  // Newer table first.
  const { data: abm } = await supabaseAdmin
    .from('association_board_members')
    .select('name, email, role')
    .eq('association_code', assoc)
    .eq('active', true)
  const abmRows = (abm ?? []).filter(r => r.email) as Array<{ name: string | null; email: string; role: string | null }>
  const abmPres = abmRows.find(r => /president/i.test(r.role ?? ''))
  if (abmPres) return { email: abmPres.email, name: abmPres.name ?? 'Board President', role: abmPres.role ?? 'President' }

  // Legacy table.
  const { data: bm } = await supabaseAdmin
    .from('board_members')
    .select('first_name, last_name, email, position')
    .eq('association_code', assoc)
    .eq('active', true)
  const bmRows = (bm ?? []).filter(r => r.email) as Array<{ first_name: string | null; last_name: string | null; email: string; position: string | null }>
  const bmPres = bmRows.find(r => /president/i.test(r.position ?? ''))
  if (bmPres) {
    return {
      email: bmPres.email,
      name:  [bmPres.first_name, bmPres.last_name].filter(Boolean).join(' ') || 'Board President',
      role:  bmPres.position ?? 'President',
    }
  }

  // No president on file — fall back to any active board member.
  if (abmRows[0]) return { email: abmRows[0].email, name: abmRows[0].name ?? 'Board Member', role: abmRows[0].role ?? 'Board Member' }
  if (bmRows[0])  return { email: bmRows[0].email, name: [bmRows[0].first_name, bmRows[0].last_name].filter(Boolean).join(' ') || 'Board Member', role: bmRows[0].position ?? 'Board Member' }
  return null
}

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { assoc?: string; month?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const assoc = (body.assoc ?? '').trim().toUpperCase()
  const month = body.month ?? ''
  if (!assoc) return NextResponse.json({ error: 'Pick an association first — a board message is per association.' }, { status: 400 })
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'A valid month is required' }, { status: 400 })

  const recipient = await findBoardRecipient(assoc)
  if (!recipient) {
    return NextResponse.json(
      { error: `No board members on file for ${assoc}. Add the board roster first.` },
      { status: 404 },
    )
  }

  // Reuse an existing request for this association + month; only create
  // a token the first time.
  const { data: existing } = await supabaseAdmin
    .from('board_messages')
    .select('id, token, submitted_at')
    .eq('association_code', assoc)
    .eq('month', month)
    .maybeSingle()

  if (existing?.submitted_at) {
    return NextResponse.json({ ok: true, alreadySubmitted: true, sentTo: recipient.name })
  }

  const linkToken = (existing?.token as string | undefined) ?? globalThis.crypto.randomUUID()
  const staffEmail = typeof session.userId === 'string' ? session.userId.toLowerCase() : null

  if (existing) {
    await supabaseAdmin.from('board_messages').update({
      author_email: recipient.email, author_name: recipient.name, author_role: recipient.role,
      requested_by_email: staffEmail, requested_at: new Date().toISOString(),
    }).eq('id', existing.id)
  } else {
    const { error: insErr } = await supabaseAdmin.from('board_messages').insert({
      association_code: assoc, month, token: linkToken,
      author_email: recipient.email, author_name: recipient.name, author_role: recipient.role,
      requested_by_email: staffEmail,
    })
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  const link = `${APP_URL}/board-message/${linkToken}`
  try {
    await sendEmail({
      to:      recipient.email,
      subject: `Your message for the ${monthLabel(month)} board newsletter`,
      html: `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p style="margin-top:0">Hi ${recipient.name},</p>
<p>PMI Top Florida Properties is preparing the <strong>${monthLabel(month)}</strong> monthly
management report for the community. We'd love to include a short message from the board.</p>
<p>Click below to write your note — it appears as the "Message from the Board" section at the
top of the newsletter:</p>
<p style="margin:24px 0">
  <a href="${link}" style="display:inline-block;background:#f26a1b;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Write the board message</a>
</p>
<p style="font-size:13px;color:#666">A few sentences is perfect. You can save and edit it any time before the report goes out.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 12px">
<p style="color:#9ca3af;font-size:11px;margin:0">MAIA · PMI Top Florida Properties</p>
</body></html>`,
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Saved, but the email failed to send: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, sentTo: recipient.name, sentToEmail: recipient.email })
}
