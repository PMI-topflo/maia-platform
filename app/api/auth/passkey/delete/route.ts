// POST /api/auth/passkey/delete  { passkeyId }
// Remove one of the signed-in resident's own passkeys. Scoped to the caller's
// identity so a resident can only delete their own. Auth required.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const jar = await cookies()
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value ?? '')
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let body: { passkeyId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const passkeyId = String(body.passkeyId ?? '').trim()
  if (!passkeyId) return NextResponse.json({ error: 'passkeyId is required' }, { status: 400 })

  const { error } = await supabaseAdmin.from('resident_passkeys')
    .delete()
    .eq('id', passkeyId)
    .eq('persona', session.persona).eq('subject_user_id', String(session.userId)).eq('association_code', session.associationCode)
  if (error) return NextResponse.json({ error: 'could not delete' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
