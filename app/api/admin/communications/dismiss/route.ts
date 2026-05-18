// =====================================================================
// /api/admin/communications/dismiss
//
// POST   — dismiss an email_log row (set dismissed_at = now())
// DELETE — un-dismiss (clear dismissed_at) so it returns to the queue
//
// Used by the "× dismiss" button and the "Show dismissed → restore"
// flow on /admin/communications. Email-only for now; conversations
// can get a parallel column later if needed.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireStaff(): Promise<{ ok: true; email: string } | { ok: false; res: NextResponse }> {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const email = typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : 'staff'
  return { ok: true, email }
}

interface DismissBody {
  type: 'email'
  id:   string
}

export async function POST(req: Request) {
  const guard = await requireStaff()
  if (!guard.ok) return guard.res

  let body: DismissBody
  try {
    body = await req.json() as DismissBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.type !== 'email') {
    return NextResponse.json({ error: 'Only "email" supported' }, { status: 400 })
  }
  if (!body.id || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('email_logs')
    .update({
      dismissed_at:       new Date().toISOString(),
      dismissed_by_email: guard.email,
    })
    .eq('id', body.id)

  if (error) {
    return NextResponse.json({ error: `dismiss failed: ${error.message}` }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const guard = await requireStaff()
  if (!guard.ok) return guard.res

  const url = new URL(req.url)
  const type = url.searchParams.get('type')
  const id   = url.searchParams.get('id')
  if (type !== 'email') {
    return NextResponse.json({ error: 'Only "email" supported' }, { status: 400 })
  }
  if (!id) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('email_logs')
    .update({
      dismissed_at:       null,
      dismissed_by_email: null,
    })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: `restore failed: ${error.message}` }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
