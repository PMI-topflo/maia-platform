// POST /api/auth/passkey/login/options
// Begin a passkey sign-in. Discoverable credentials — no email/phone first.
// Returns WebAuthn request options + stashes the challenge in a cookie. Public.
import { NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { rpContextFromOrigin, signChallenge, CHALLENGE_COOKIE } from '@/lib/webauthn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const { rpID } = rpContextFromOrigin(req.headers.get('origin'))
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    // No allowCredentials → the OS shows the user's discoverable passkeys.
  })
  const res = NextResponse.json(options)
  res.cookies.set(CHALLENGE_COOKIE, await signChallenge(options.challenge), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 300,
  })
  return res
}
