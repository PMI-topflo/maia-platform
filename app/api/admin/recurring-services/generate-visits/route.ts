// POST /api/admin/recurring-services/generate-visits  { weekOf? }
// Generate this/next week's documentation visits (+ WOs) for active services.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { generateVisitsForWeek, mondayOf } from '@/lib/service-visits'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const t = (await cookies()).get(SESSION_COOKIE)?.value
  const s = t ? await verifySession(t) : null
  if (s?.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let weekOf: string | undefined
  try { weekOf = (await req.json())?.weekOf } catch { /* */ }
  const week = weekOf && /^\d{4}-\d{2}-\d{2}$/.test(weekOf) ? mondayOf(new Date(weekOf)) : mondayOf()

  const r = await generateVisitsForWeek(week)
  return NextResponse.json({ ok: true, weekOf: week, ...r })
}
