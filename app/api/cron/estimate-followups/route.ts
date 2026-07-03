// =====================================================================
// /api/cron/estimate-followups
// Nudges vendors who were asked for an estimate but haven't accepted to
// quote within ~2 days (up to 3 nudges, ~2 days apart). CRON_SECRET-guarded.
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { signEstimateRequestToken } from '@/lib/estimate-request-token'
import { sendEmail } from '@/lib/gmail'
import { VENDOR_REPLY_TO } from '@/lib/notify-recipients'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const DAY = 86_400_000
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const now = Date.now()
  const { data: rows } = await supabaseAdmin.from('estimate_request_vendors')
    .select('id, request_id, vendor_name, vendor_email, status, created_at, last_followup_at, followup_count')
    .eq('status', 'sent')
  let nudged = 0
  for (const v of (rows ?? []) as { id: string; request_id: string; vendor_name: string | null; vendor_email: string; created_at: string; last_followup_at: string | null; followup_count: number }[]) {
    if (v.followup_count >= 3) continue
    const since = now - new Date(v.last_followup_at ?? v.created_at).getTime()
    if (since < 2 * DAY) continue

    const { data: reqRow } = await supabaseAdmin.from('estimate_requests').select('ticket_id, association_code, scope, status').eq('id', v.request_id).single()
    if (!reqRow) continue
    if (reqRow.status === 'closed') continue   // a winner was awarded — stop chasing
    const { data: ticket } = await supabaseAdmin.from('tickets').select('ticket_number').eq('id', reqRow.ticket_id).single()
    const woLabel = `${ticket?.ticket_number ?? `WO ${reqRow.ticket_id}`}${reqRow.association_code ? ` · ${reqRow.association_code}` : ''}`
    const link = `${APP}/vendor/estimate/${await signEstimateRequestToken(v.id)}`

    await sendEmail({
      to: v.vendor_email, replyTo: VENDOR_REPLY_TO,
      subject: `Reminder: estimate request — ${woLabel}`,
      html: `<p>Hi${v.vendor_name ? ` ${esc(v.vendor_name)}` : ''}, just following up on our estimate request for <strong>${esc(woLabel)}</strong>.</p>
        <p>Please let us know if you can quote it and by when:</p>
        <p><a href="${link}" style="background:#f26a1b;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Review &amp; respond →</a></p>
        <p style="font-size:12px;color:#6b7280">Reply to this email to reach our maintenance coordinator.</p>`,
    }).catch(() => null)
    await supabaseAdmin.from('estimate_request_vendors').update({ last_followup_at: new Date(now).toISOString(), followup_count: v.followup_count + 1 }).eq('id', v.id)
    nudged++
  }
  return NextResponse.json({ ok: true, nudged })
}
