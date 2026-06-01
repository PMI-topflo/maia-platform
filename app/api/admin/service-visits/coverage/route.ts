// GET /api/admin/service-visits/coverage
// Staff-only. Returns this week's weekly-service coverage summary + every
// active recurring service's latest-visit documentation status.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getWeeklyCoverage, listLatestVisitPerService } from '@/lib/service-visits'

export const dynamic = 'force-dynamic'

export async function GET() {
  const t = (await cookies()).get(SESSION_COOKIE)?.value
  const s = t ? await verifySession(t) : null
  if (s?.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [weekly, latest] = await Promise.all([getWeeklyCoverage(), listLatestVisitPerService()])
  return NextResponse.json({ weekly, latest })
}
