// POST /api/admin/pre-apply/[id]/reminder-approval  { action: 'approve' | 'decline' }
//
// Same decision as app/api/reminder-approval/[token] (approving sends the
// missing-docs reminder to every stakeholder now and clears the gate for
// every later 3-day cycle; declining leaves it pending for the cron to ask
// again), but reached from the staff admin dashboard instead of the
// no-login email link -- user direction, 2026-09-09: route PMI/Jonathan
// straight into the application's own page instead of a standalone
// approve/decline card with no other context. Staff-session gated, scoped
// by application id rather than the approval row's own token.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { getOutstandingSummary } from '@/lib/application-outstanding-summary'
import { getReminderRecipients, sendMissingDocsReminder } from '@/lib/application-reminder'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let b: { action?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (b.action !== 'approve' && b.action !== 'decline') return NextResponse.json({ error: 'invalid action' }, { status: 400 })

  const { data: row } = await supabaseAdmin.from('application_reminder_approvals')
    .select('id, status').eq('application_id', id).eq('status', 'pending').maybeSingle()
  if (!row) return NextResponse.json({ error: 'No pending reminder approval for this application.' }, { status: 404 })

  const status = b.action === 'approve' ? 'approved' : 'declined'
  const now = new Date().toISOString()
  await supabaseAdmin.from('application_reminder_approvals')
    .update({ status, decided_by: 'office', decided_at: now }).eq('id', row.id)

  let sentTo: string[] = []
  if (status === 'approved') {
    const [summary, recipients] = await Promise.all([getOutstandingSummary(id), getReminderRecipients(id)])
    if (!('error' in summary) && recipients.length) {
      const res = await sendMissingDocsReminder(id, summary, recipients)
      sentTo = res.sent
      await supabaseAdmin.from('application_reminder_approvals').update({ sent_to: sentTo }).eq('id', row.id)
    }
  }

  return NextResponse.json({ ok: true, status, sentTo })
}
