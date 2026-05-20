// =====================================================================
// GET /api/admin/migration-status
//
// Returns the applied/missing status of every recent migration so the
// /admin/tools page can surface schema drift without staff having to
// grep through migration files or hit information_schema by hand.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import {
  checkMigrationStatus,
  execMigrationFunctionExists,
  EXEC_MIGRATION_FUNCTION_SQL,
} from '@/lib/migration-status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [migrations, canAutoApply] = await Promise.all([
    checkMigrationStatus(),
    execMigrationFunctionExists(),
  ])
  return NextResponse.json({
    migrations,
    canAutoApply,
    setupSql: EXEC_MIGRATION_FUNCTION_SQL,
  })
}
