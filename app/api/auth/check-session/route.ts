import { NextRequest, NextResponse } from 'next/server'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ valid: false }, { status: 401 })

  const session = await verifySession(token)
  if (!session) return NextResponse.json({ valid: false }, { status: 401 })

  // Hydrate the staff contactName from pmi_staff each call. Lets existing
  // sessions — which may have been signed before the verify-otp lookup
  // was widened to check personal_email — display the actual first name
  // without forcing a logout. For non-staff personas contactName is set
  // correctly at session creation and this path is skipped.
  let { contactName } = session
  if (session.persona === 'staff' && !contactName) {
    const id = typeof session.userId === 'string' ? session.userId : ''
    if (id && id.includes('@')) {
      const { data: row } = await supabaseAdmin
        .from('pmi_staff')
        .select('name')
        .or(`email.ilike.${id},personal_email.ilike.${id}`)
        .limit(1)
        .maybeSingle()
      contactName = row?.name ?? ''
    }
  }

  return NextResponse.json({ valid: true, session: { ...session, contactName } })
}

export async function DELETE(_req: NextRequest) {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
}
