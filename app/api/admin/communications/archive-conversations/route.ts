// =====================================================================
// /api/admin/communications/archive-conversations
//
// POST { ids: string[], action: 'archive' | 'restore' }
//
// Soft-archive (or restore) general_conversations rows. Archived rows
// are hidden from the default Communications view but preserved in the
// table. Supports bulk — the dashboard sends one or many ids at once.
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

interface Body {
  ids:    string[]
  action: 'archive' | 'restore'
}

export async function POST(req: Request) {
  const guard = await requireStaff()
  if (!guard.ok) return guard.res

  let body: Body
  try {
    body = await req.json() as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter(id => typeof id === 'string' && id) : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No conversation ids provided' }, { status: 400 })
  }
  if (body.action !== 'archive' && body.action !== 'restore') {
    return NextResponse.json({ error: 'action must be archive or restore' }, { status: 400 })
  }

  const patch = body.action === 'archive'
    ? { archived_at: new Date().toISOString(), archived_by_email: guard.email }
    : { archived_at: null, archived_by_email: null }

  const { error, count } = await supabaseAdmin
    .from('general_conversations')
    .update(patch, { count: 'exact' })
    .in('id', ids)

  if (error) {
    // Migration not applied yet — surface a clear, actionable message.
    if (/archived_at|column/.test(error.message)) {
      return NextResponse.json(
        { error: 'The conversations-archive migration has not been applied to the database yet.' },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: `${body.action} failed: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, updated: count ?? ids.length })
}
