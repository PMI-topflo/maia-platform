// =====================================================================
// app/api/admin/invoices/intake/[id]/restore/route.ts
// POST — move a REJECTED draft back into "Pending review" (the inverse of
// /reject). Used when a draft was rejected by mistake, or new info shows
// it really is a payable invoice. Clears the rejected reason.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: Request,
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

  const { error } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .update({
      status:          'pending_review',
      rejected_reason: null,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'rejected')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
