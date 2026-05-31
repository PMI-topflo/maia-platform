// PATCH / DELETE /api/admin/recurring-services/[id]
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { updateRecurringService, deleteRecurringService } from '@/lib/recurring-services'

export const dynamic = 'force-dynamic'

async function staff(): Promise<boolean> {
  const t = (await cookies()).get(SESSION_COOKIE)?.value
  const s = t ? await verifySession(t) : null
  return s?.persona === 'staff'
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await staff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = Number((await ctx.params).id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* */ }
  const r = await updateRecurringService(id, body)
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await staff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = Number((await ctx.params).id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const r = await deleteRecurringService(id)
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 })
}
