// =====================================================================
// POST /api/admin/tickets/[id]/vendor-link   { email? }
// Staff-triggered: email the vendor a secure upload link for this work
// order. Optional `email` overrides the WO's stored vendor email.
// Staff session required.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { sendVendorUploadLink } from '@/lib/vendor-link'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sentBy = typeof session.userId === 'string' ? session.userId : 'staff'

  const { id } = await ctx.params
  const ticketId = Number(id)
  if (!Number.isFinite(ticketId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  let email: string | undefined
  try { email = (await req.json())?.email } catch { /* optional */ }

  const r = await sendVendorUploadLink({ ticketId, recipientEmail: email ?? null, sentBy })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, link: r.link, recipient: r.recipient })
}
