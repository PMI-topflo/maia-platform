// POST /api/admin/pre-apply/[id]/board-review/remind   (staff-only)
//
// Send the board reminder for this application RIGHT NOW, outside the cron's
// cadence — the newest review round gets the same email the daily cron would
// send: "give the final approval" while no letter exists, "sign the letter"
// once it does. Recipients are re-checked against the active roster at send
// time. User request, 2026-09-11 (MANXI 706): "push this email again with
// the corrections and correct link."

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { sendSignatureReminder } from '@/lib/board-review-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: round } = await supabaseAdmin.from('document_review_rounds')
    .select('id').eq('application_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!round) return NextResponse.json({ error: 'No board review has been sent for this application yet — use "Send to the board to review" first.' }, { status: 400 })
  const r = await sendSignatureReminder(String(round.id))
  if (!r.sent) return NextResponse.json({ error: 'Nothing to remind — the window is not open, or everyone has already signed.' }, { status: 400 })
  return NextResponse.json({ ok: true, to: r.to, variant: r.variant })
}
