import { NextRequest, NextResponse } from 'next/server'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { resolveStaffByLoginEmail } from '@/lib/staff-lookup'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ valid: false }, { status: 401 })

  const session = await verifySession(token)
  if (!session) return NextResponse.json({ valid: false }, { status: 401 })

  // Hydrate the staff contactName from pmi_staff each call. Resolver
  // handles email + personal_email + alt_emails AND the name-derived
  // alias fallback, so a session minted from fabio@pmitop.com finds
  // the Fabio row even when neither column literally stores that
  // address.
  let { contactName } = session
  if (session.persona === 'staff' && !contactName) {
    const id = typeof session.userId === 'string' ? session.userId : ''
    const row = id ? await resolveStaffByLoginEmail(id) : null
    contactName = row?.name ?? ''
  }

  // The resident's saved preferred language (so the widget can default to it).
  let lang: string | null = null
  if (session.persona !== 'staff' && session.userId != null) {
    const { data } = await supabaseAdmin
      .from('resident_language_prefs')
      .select('lang')
      .eq('persona', session.persona)
      .eq('persona_record_id', String(session.userId))
      .maybeSingle()
    lang = data?.lang ?? null
  }

  // For a signed-in owner, resolve their CINC account number so the widget
  // can pass it to /api/chat — that's what scopes per-unit "Teach MAIA"
  // knowledge to the right unit in MAIA's answers.
  let accountNumber: string | null = null
  if (session.persona === 'owner' && session.userId != null) {
    const { data } = await supabaseAdmin
      .from('owners')
      .select('account_number')
      .eq('id', session.userId)
      .maybeSingle()
    accountNumber = data?.account_number ?? null
  }

  return NextResponse.json({ valid: true, session: { ...session, contactName }, lang, accountNumber })
}

export async function DELETE(_req: NextRequest) {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
}
