// GET /api/auth/passkey/list
// The signed-in resident's own passkeys (for the settings surface). Auth required.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const jar = await cookies()
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value ?? '')
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { data } = await supabaseAdmin.from('resident_passkeys')
    .select('id, friendly_name, created_at, last_used_at')
    .eq('persona', session.persona).eq('subject_user_id', String(session.userId)).eq('association_code', session.associationCode)
    .order('created_at', { ascending: false })

  return NextResponse.json({ passkeys: data ?? [] })
}
