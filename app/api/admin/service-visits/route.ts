// GET /api/admin/service-visits?assoc=CODE&weekOf=YYYY-MM-DD
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listVisits } from '@/lib/service-visits'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const t = (await cookies()).get(SESSION_COOKIE)?.value
  const s = t ? await verifySession(t) : null
  if (s?.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url   = new URL(req.url)
  const assoc = url.searchParams.get('assoc')
  const week  = url.searchParams.get('weekOf') ?? undefined
  if (!assoc) return NextResponse.json({ error: 'assoc required' }, { status: 400 })
  return NextResponse.json({ visits: await listVisits(assoc, week) })
}
