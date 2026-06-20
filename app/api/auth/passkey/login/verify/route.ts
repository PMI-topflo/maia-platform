// POST /api/auth/passkey/login/verify
// Finish a passkey sign-in: verify the assertion against the stored credential,
// then re-issue the SAME maia_session cookie the OTP flow issues (from the
// identity snapshot saved at enrollment) and return the post-login redirect.
// Public (the assertion IS the auth).
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { makeSession, signSession, SESSION_COOKIE, COOKIE_MAX_AGE, type SessionData } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { associationPortalPath } from '@/lib/association-portal'
import { rpContextFromOrigin, readChallenge, CHALLENGE_COOKIE } from '@/lib/webauthn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function b64uDecode(str: string): Uint8Array<ArrayBuffer> {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Same destination logic as the OTP flow (portalUrl in app/page.tsx).
function redirectFor(persona: string, assoc: string): string {
  if (persona === 'staff') return '/admin'
  if (persona === 'owner' || persona === 'tenant') return associationPortalPath(assoc) ?? (persona === 'owner' ? '/my-account' : '/tenant')
  if (persona === 'board') return '/board'
  return '/'
}

export async function POST(req: Request) {
  const jar = await cookies()
  const expectedChallenge = await readChallenge(jar.get(CHALLENGE_COOKIE)?.value)
  if (!expectedChallenge) return NextResponse.json({ error: 'webauthn_challenge_expired' }, { status: 400 })

  let body: { response?: { id?: string } }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const credentialId = body.response?.id
  if (!credentialId) return NextResponse.json({ error: 'invalid response' }, { status: 400 })

  const { data: row } = await supabaseAdmin.from('resident_passkeys')
    .select('*').eq('credential_id', credentialId).maybeSingle()
  if (!row) return NextResponse.json({ error: 'webauthn_credential_not_found' }, { status: 404 })

  const { rpID, origins } = rpContextFromOrigin(req.headers.get('origin'))
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response: body.response as any,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: row.credential_id as string,
        publicKey: b64uDecode(row.public_key as string),
        counter: Number(row.counter ?? 0),
        transports: (row.transports ?? undefined) as undefined,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: 'webauthn_verification_failed', detail: (e as Error).message }, { status: 400 })
  }
  if (!verification.verified) return NextResponse.json({ error: 'webauthn_verification_failed' }, { status: 400 })

  // Advance the signature counter + mark last use (best-effort).
  await supabaseAdmin.from('resident_passkeys')
    .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
    .eq('id', row.id).then(() => null, () => null)

  // Re-mint the exact maia_session from the enrollment snapshot.
  const session = makeSession({
    userId:          row.subject_user_id as string,
    persona:         row.persona as SessionData['persona'],
    associationCode: row.association_code as string,
    displayName:     (row.display_name as string) ?? '',
    contactName:     (row.contact_name as string) ?? '',
  })
  const token = await signSession(session)
  const redirect = redirectFor(row.persona as string, row.association_code as string)

  const res = NextResponse.json({ ok: true, redirect })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env['NODE_ENV'] === 'production', sameSite: 'strict', maxAge: COOKIE_MAX_AGE, path: '/',
  })
  res.cookies.set(CHALLENGE_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}
