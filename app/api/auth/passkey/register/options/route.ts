// POST /api/auth/passkey/register/options
// Begin passkey enrollment for the ALREADY-signed-in resident (valid
// maia_session, from phone-OTP). Returns WebAuthn creation options and stashes
// the challenge in a signed cookie. Node runtime (@simplewebauthn/server).
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rpContextFromOrigin, signChallenge, CHALLENGE_COOKIE, RP_DISPLAY_NAME } from '@/lib/webauthn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const jar = await cookies()
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value ?? '')
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { rpID } = rpContextFromOrigin(req.headers.get('origin'))
  const subject = `${session.persona}:${String(session.userId)}:${session.associationCode}`

  // Exclude already-enrolled credentials for this resident so the OS offers a
  // fresh enrollment instead of silently re-registering the same authenticator.
  const { data: existing } = await supabaseAdmin.from('resident_passkeys')
    .select('credential_id, transports')
    .eq('persona', session.persona).eq('subject_user_id', String(session.userId)).eq('association_code', session.associationCode)

  const options = await generateRegistrationOptions({
    rpName: RP_DISPLAY_NAME,
    rpID,
    userName: session.contactName || session.displayName || 'Resident',
    userDisplayName: session.contactName || session.displayName || 'Resident',
    userID: new TextEncoder().encode(subject),
    attestationType: 'none',
    excludeCredentials: (existing ?? []).map(c => ({ id: c.credential_id as string, transports: (c.transports ?? undefined) as undefined })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  })

  const res = NextResponse.json(options)
  res.cookies.set(CHALLENGE_COOKIE, await signChallenge(options.challenge), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 300,
  })
  return res
}
