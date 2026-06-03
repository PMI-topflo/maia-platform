// =====================================================================
// app/api/admin/ideas/route.ts
//
// Staff-only triage API for the MAIA improvement-ideas board.
//   GET                    → all non-deleted ideas, newest first
//   PATCH { id, status }   → set status to new | accepted | done | deleted
//                            (deleted is a soft-delete; row is kept)
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const VALID_STATUS = ['new', 'accepted', 'done', 'deleted'] as const
type IdeaStatus = (typeof VALID_STATUS)[number]

async function requireStaff() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}

export async function GET() {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('maia_improvement_ideas')
    .select('id, idea, submitted_by_name, submitted_by_email, source, status, triaged_by, triaged_at, created_at')
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ideas: data ?? [] })
}

export async function PATCH(req: Request) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { id?: unknown; status?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const id     = typeof body.id === 'string' ? body.id : ''
  const status = body.status as IdeaStatus
  if (!id || !VALID_STATUS.includes(status)) {
    return NextResponse.json({ error: 'id and a valid status are required' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('maia_improvement_ideas')
    .update({ status, triaged_by: session.contactName || session.displayName || 'staff', triaged_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
