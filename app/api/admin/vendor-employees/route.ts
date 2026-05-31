// GET /api/admin/vendor-employees?vendor=CINCID  · POST (create)
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listVendorEmployees, createVendorEmployee } from '@/lib/recurring-services'

export const dynamic = 'force-dynamic'

async function staff(): Promise<boolean> {
  const t = (await cookies()).get(SESSION_COOKIE)?.value
  const s = t ? await verifySession(t) : null
  return s?.persona === 'staff'
}

export async function GET(req: Request) {
  if (!(await staff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const vendor = new URL(req.url).searchParams.get('vendor')
  return NextResponse.json({ employees: await listVendorEmployees(vendor) })
}

export async function POST(req: Request) {
  if (!(await staff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* */ }
  if (!body.vendor_name || !body.name) return NextResponse.json({ error: 'vendor_name and name required' }, { status: 400 })
  const r = await createVendorEmployee(body)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ employee: r.row })
}
