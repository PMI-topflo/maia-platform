import { NextRequest, NextResponse } from 'next/server'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { resolveStaffByLoginEmail } from '@/lib/staff-lookup'

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

  return NextResponse.json({ valid: true, session: { ...session, contactName } })
}

export async function DELETE(_req: NextRequest) {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
}
