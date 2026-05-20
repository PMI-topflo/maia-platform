// =====================================================================
// POST /api/admin/migrations/apply
//
// One-click migration runner for the /admin/tools schema panel. Takes a
// migration KEY, resolves its SQL from the in-repo MIGRATIONS list, and
// runs it server-side through the exec_migration helper (service role).
//
// Raw SQL is never accepted from the client — only the key — so there is
// no injection surface: staff can only run a known, reviewed migration.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getMigrationByKey, checkMigrationStatus } from '@/lib/migration-status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { key?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const key = typeof body.key === 'string' ? body.key : ''
  if (!key) {
    return NextResponse.json({ error: 'Missing migration key' }, { status: 400 })
  }

  const migration = getMigrationByKey(key)
  if (!migration) {
    return NextResponse.json({ error: `Unknown migration: ${key}` }, { status: 400 })
  }

  // SQL is sourced from the in-repo MIGRATIONS list, never the request
  // body. exec_migration is a SECURITY DEFINER helper reachable only by
  // the service role.
  const { error } = await supabaseAdmin.rpc('exec_migration', { sql: migration.sql })

  if (error) {
    const missingFn = /could not find the function|function .* does not exist/i.test(error.message)
    if (missingFn) {
      return NextResponse.json({
        ok:         false,
        needsSetup: true,
        error:      'The exec_migration helper is not installed yet — apply the one-time setup SQL first.',
      })
    }
    console.error(`[migrations/apply] ${key} failed:`, error.message)
    return NextResponse.json({ ok: false, error: error.message })
  }

  // Re-probe so the response reflects the live schema.
  const status  = await checkMigrationStatus()
  const applied = status.find(m => m.key === key)?.applied ?? false

  return NextResponse.json({ ok: true, applied })
}
