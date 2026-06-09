// =====================================================================
// /api/cron/sync-staff-tasks
// Regenerates MAIA staff tasks (compliance / invoice intake / recon /
// deliveries) from live state. Runs before the Daily News so each
// person's "tasks coming up" is current. CRON_SECRET-guarded.
// =====================================================================

import { NextResponse } from 'next/server'
import { syncStaffTasks } from '@/lib/staff-task-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const result = await syncStaffTasks()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
