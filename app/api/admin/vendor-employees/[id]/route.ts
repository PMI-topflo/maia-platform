// PATCH / DELETE /api/admin/vendor-employees/[id]
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { updateVendorEmployee, deleteVendorEmployee } from '@/lib/recurring-services'

export const dynamic = 'force-dynamic'

async function staff(): Promise<boolean> {
  const t = (await cookies()).get(SESSION_COOKIE)?.value
  const s = t ? await verifySession(t) : null
  return s?.persona === 'staff'
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await staff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* */ }
  const r = await updateVendorEmployee(id, body)
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await staff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const r = await deleteVendorEmployee(id)
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 })
}
