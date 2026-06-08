// =====================================================================
// GET  /api/admin/staff-tasks?assignee=email  → active tasks (or all)
// POST /api/admin/staff-tasks                 → create one (manual)
// Recurring staff tasks/reminders for the Staff Setup page. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SELECT = 'id, assignee_email, title, source, recurrence, next_due, expiry_date, notes, active'
const RECUR = ['once', 'daily', 'weekly', 'monthly', 'yearly', 'on_expiry']

async function requireStaff() {
  const cookieStore = await cookies()
  const token   = cookieStore.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}
const dateOrNull = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null

export async function GET(req: Request) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const assignee = (new URL(req.url).searchParams.get('assignee') ?? '').trim().toLowerCase()
  let q = supabaseAdmin.from('staff_tasks').select(SELECT).eq('active', true).order('next_due', { ascending: true, nullsFirst: false })
  if (assignee) q = q.eq('assignee_email', assignee)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tasks: data ?? [] })
}

export async function POST(req: Request) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const assignee = String(body.assignee_email ?? '').trim().toLowerCase()
  const title    = String(body.title ?? '').trim()
  if (!assignee || !title) return NextResponse.json({ error: 'assignee_email and title are required' }, { status: 400 })
  const recurrence = RECUR.includes(String(body.recurrence)) ? String(body.recurrence) : 'once'
  const createdBy = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null

  const { data, error } = await supabaseAdmin.from('staff_tasks').insert({
    assignee_email: assignee, title, source: 'manual', recurrence,
    next_due:    dateOrNull(body.next_due),
    expiry_date: dateOrNull(body.expiry_date),
    notes:       String(body.notes ?? '').trim() || null,
    created_by:  createdBy,
  }).select(SELECT).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data })
}
