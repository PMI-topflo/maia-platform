// GET /api/admin/recurring-services?assoc=CODE  · POST (create)
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listRecurringServices, createRecurringService } from '@/lib/recurring-services'

export const dynamic = 'force-dynamic'

async function staff(): Promise<boolean> {
  const t = (await cookies()).get(SESSION_COOKIE)?.value
  const s = t ? await verifySession(t) : null
  return s?.persona === 'staff'
}

export async function GET(req: Request) {
  if (!(await staff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const assoc = new URL(req.url).searchParams.get('assoc')
  return NextResponse.json({ services: await listRecurringServices(assoc) })
}

export async function POST(req: Request) {
  if (!(await staff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* */ }
  if (!body.association_code || !body.vendor_name) return NextResponse.json({ error: 'association_code and vendor_name required' }, { status: 400 })
  const r = await createRecurringService(body)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ service: r.row })
}
