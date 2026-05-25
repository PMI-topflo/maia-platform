// =====================================================================
// app/api/admin/invoices/intake/[id]/reject/route.ts
// POST — mark a draft rejected with a reason. Used when Karen sees an
// inbound that wasn't actually an invoice (a statement, a wrong send,
// a spam PDF) and wants it out of the queue without pushing to CINC.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

export const dynamic = 'force-dynamic'

interface RejectBody { reason?: string }

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await ctx.params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: RejectBody = {}
  try { body = await req.json() } catch { /* allow empty body */ }

  const { error } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .update({
      status:          'rejected',
      rejected_reason: body.reason?.slice(0, 500) ?? null,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', id)
    .in('status', ['pending_review', 'needs_vendor', 'duplicate_in_cinc'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
