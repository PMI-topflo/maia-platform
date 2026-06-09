// POST /api/admin/staff-tasks/sync — regenerate MAIA staff tasks on demand
// (same engine the daily cron runs). Staff-only. Lets staff refresh the
// auto-tasks without waiting for the 8:30 ET cron.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { syncStaffTasks } from '@/lib/staff-task-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await syncStaffTasks()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
