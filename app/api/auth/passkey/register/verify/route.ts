// POST /api/auth/passkey/register/verify
// Finish passkey enrollment: verify the authenticator's attestation, then
// store the credential + a snapshot of the resident's session identity (so a
// later passkey sign-in can re-mint the same maia_session). Auth required.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rpContextFromOrigin, readChallenge, aaguidName, CHALLENGE_COOKIE } from '@/lib/webauthn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function b64u(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function POST(req: Request) {
  const jar = await cookies()
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value ?? '')
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const expectedChallenge = await readChallenge(jar.get(CHALLENGE_COOKIE)?.value)
  if (!expectedChallenge) return NextResponse.json({ error: 'webauthn_challenge_expired' }, { status: 400 })

  let body: { response?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const { rpID, origins } = rpContextFromOrigin(req.headers.get('origin'))
  let verification
  try {
    verification = await verifyRegistrationResponse({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response: body.response as any,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: false,
    })
  } catch (e) {
    return NextResponse.json({ error: 'webauthn_verification_failed', detail: (e as Error).message }, { status: 400 })
  }
  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'webauthn_verification_failed' }, { status: 400 })
  }

  const info = verification.registrationInfo
  const cred = info.credential
  const friendly = aaguidName(info.aaguid)

  const { data: inserted, error } = await supabaseAdmin.from('resident_passkeys').insert({
    credential_id:    cred.id,
    public_key:       b64u(cred.publicKey),
    counter:          cred.counter ?? 0,
    transports:       cred.transports ?? null,
    aaguid:           info.aaguid ?? null,
    friendly_name:    friendly,
    device_type:      info.credentialDeviceType ?? null,
    backed_up:        info.credentialBackedUp ?? null,
    subject_user_id:  String(session.userId),
    persona:          session.persona,
    association_code: session.associationCode,
    display_name:     session.displayName,
    contact_name:     session.contactName,
  }).select('id, friendly_name, created_at').single()

  const cleared = (resp: NextResponse) => { resp.cookies.set(CHALLENGE_COOKIE, '', { path: '/', maxAge: 0 }); return resp }

  // Unique violation on credential_id → this authenticator is already enrolled.
  if (error?.code === '23505') return cleared(NextResponse.json({ error: 'webauthn_credential_exists' }, { status: 409 }))
  if (error || !inserted) return cleared(NextResponse.json({ error: 'could not save passkey' }, { status: 500 }))

  return cleared(NextResponse.json({ ok: true, passkey: inserted }))
}
