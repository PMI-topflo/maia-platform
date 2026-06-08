// =====================================================================
// GET  /api/admin/maintenance/schedules?assoc=CODE   → active schedules
// POST /api/admin/maintenance/schedules              → create one
//
// Preventive maintenance schedules behind the Association Hub Maintenance
// tab + calendar. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { CADENCES, type Cadence } from '@/lib/preventive-maintenance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SELECT = 'id, association_code, task, cadence, weekday, day_of_month, start_date, vendor_name, notes, active'

async function requireStaff() {
  const cookieStore = await cookies()
  const token   = cookieStore.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}

export async function GET(req: Request) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const assoc = (new URL(req.url).searchParams.get('assoc') ?? '').trim().toUpperCase()
  if (!assoc) return NextResponse.json({ error: 'assoc is required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('preventive_schedules')
    .select(SELECT)
    .eq('association_code', assoc)
    .eq('active', true)
    .order('task')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ schedules: data ?? [] })
}

export async function POST(req: Request) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const assoc   = String(body.association_code ?? '').trim().toUpperCase()
  const task    = String(body.task ?? '').trim()
  const cadence = String(body.cadence ?? '') as Cadence
  const start   = String(body.start_date ?? '').trim()
  if (!assoc || !task)               return NextResponse.json({ error: 'association_code and task are required' }, { status: 400 })
  if (!CADENCES.includes(cadence))   return NextResponse.json({ error: 'invalid cadence' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return NextResponse.json({ error: 'start_date must be YYYY-MM-DD' }, { status: 400 })

  const weekday = cadence === 'weekly'
    ? Math.min(6, Math.max(0, Number(body.weekday ?? new Date(start).getDay())))
    : null
  const dayOfMonth = cadence !== 'weekly'
    ? Math.min(28, Math.max(1, Number(body.day_of_month ?? Number(start.slice(8, 10)))))
    : null

  const uploadedBy = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null

  const { data, error } = await supabaseAdmin
    .from('preventive_schedules')
    .insert({
      association_code: assoc, task, cadence,
      weekday, day_of_month: dayOfMonth, start_date: start,
      vendor_name: (String(body.vendor_name ?? '').trim() || null),
      notes:       (String(body.notes ?? '').trim() || null),
      created_by:  uploadedBy,
    })
    .select(SELECT)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ schedule: data })
}
