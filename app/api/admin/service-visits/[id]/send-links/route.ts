// POST /api/admin/service-visits/[id]/send-links
// Send the vendor's crew their upload links for this visit (their channel).
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { sendCrewUploadLinks } from '@/lib/service-visits'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const t = (await cookies()).get(SESSION_COOKIE)?.value
  const s = t ? await verifySession(t) : null
  if (s?.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number((await ctx.params).id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const r = await sendCrewUploadLinks(id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, sent: r.sent, results: r.results })
}
