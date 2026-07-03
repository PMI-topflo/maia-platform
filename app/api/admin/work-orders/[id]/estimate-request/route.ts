// =====================================================================
// POST /api/admin/work-orders/[id]/estimate-request
// Request estimates from one or more vendors on a work order. Creates the
// estimate_requests + estimate_request_vendors rows, emails each vendor a
// tokenized "accept to quote + upload" link (Reply-To Paola), and sends
// Paola a summary of everyone it went to. Staff-only.
// Body: { scope, photo_paths: string[], vendors: [{vendor_id?, vendor_name?, vendor_email}] }
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { signEstimateRequestToken } from '@/lib/estimate-request-token'
import { sendEmail } from '@/lib/gmail'
import { appendMessage } from '@/lib/tickets'
import { getAssociationName } from '@/lib/association-name'
import { VENDOR_NOTIFY_CC, VENDOR_REPLY_TO, PAOLA_EMAIL } from '@/lib/notify-recipients'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actor = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null

  const { id } = await ctx.params
  const ticketId = parseInt(id, 10)
  if (!Number.isFinite(ticketId)) return NextResponse.json({ error: 'bad work order id' }, { status: 400 })

  let body: { scope?: string; photo_paths?: unknown; vendors?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const scope = String(body.scope ?? '').trim()
  if (!scope) return NextResponse.json({ error: 'scope of work is required' }, { status: 400 })
  const photoPaths = Array.isArray(body.photo_paths) ? body.photo_paths.filter((p): p is string => typeof p === 'string') : []
  const vendorsIn = (Array.isArray(body.vendors) ? body.vendors : [])
    .map((v): { vendor_id: number | null; vendor_name: string | null; vendor_email: string } | null => {
      const rec = v as Record<string, unknown>
      const email = String(rec.vendor_email ?? '').trim().toLowerCase()
      if (!email.includes('@')) return null
      const vid = Number(rec.vendor_id)
      return { vendor_id: Number.isFinite(vid) ? vid : null, vendor_name: (typeof rec.vendor_name === 'string' && rec.vendor_name.trim()) || null, vendor_email: email }
    })
    .filter((v): v is { vendor_id: number | null; vendor_name: string | null; vendor_email: string } => v !== null)
  if (vendorsIn.length === 0) return NextResponse.json({ error: 'at least one vendor with an email is required' }, { status: 400 })

  const { data: ticket } = await supabaseAdmin.from('tickets').select('id, ticket_number, subject, association_code').eq('id', ticketId).single()
  if (!ticket) return NextResponse.json({ error: 'work order not found' }, { status: 404 })

  const { data: reqRow, error: reqErr } = await supabaseAdmin.from('estimate_requests').insert({
    ticket_id: ticketId, association_code: ticket.association_code, scope, photo_paths: photoPaths, created_by: actor,
  }).select('id').single()
  if (reqErr || !reqRow) return NextResponse.json({ error: `could not create request: ${reqErr?.message}` }, { status: 500 })

  const woLabel = `${ticket.ticket_number}${ticket.association_code ? ` · ${ticket.association_code}` : ''}`
  const assocName = await getAssociationName(ticket.association_code)
  const sentTo: { name: string; email: string; link: string }[] = []
  for (const v of vendorsIn) {
    const { data: erv } = await supabaseAdmin.from('estimate_request_vendors').insert({
      request_id: reqRow.id, vendor_id: v.vendor_id, vendor_name: v.vendor_name, vendor_email: v.vendor_email,
    }).select('id').single()
    if (!erv) continue
    const link = `${APP}/vendor/estimate/${await signEstimateRequestToken(erv.id)}`
    sentTo.push({ name: v.vendor_name ?? v.vendor_email, email: v.vendor_email, link })
    await sendEmail({
      to: v.vendor_email, bcc: VENDOR_NOTIFY_CC, replyTo: VENDOR_REPLY_TO,
      subject: `Estimate request${assocName ? ` — ${assocName}` : ` — ${woLabel}`}`,
      html: `<p>Hello${v.vendor_name ? ` ${esc(v.vendor_name)}` : ''},</p>
        <p>PMI Top Florida Properties is requesting an estimate${assocName ? ` for <strong>${esc(assocName)}</strong>` : ''} (work order <strong>${esc(ticket.ticket_number)}</strong>).</p>
        <p><strong>Scope of work:</strong><br>${esc(scope).replace(/\n/g, '<br>')}</p>
        <p>Please review the details and photos, let us know if you'll quote and by when, and upload your estimate:</p>
        <p><a href="${link}" style="background:#f26a1b;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Review & respond →</a></p>
        <p style="font-size:12px;color:#6b7280">Questions? Just reply to this email — it goes to our maintenance coordinator.</p>`,
    }).catch(() => null)
  }

  // Summary to Paola — every vendor this went to.
  await sendEmail({
    to: PAOLA_EMAIL,
    subject: `Estimate request sent — ${woLabel} (${sentTo.length} vendor${sentTo.length === 1 ? '' : 's'})`,
    html: `<p>An estimate request went out for <strong>${esc(woLabel)}</strong>${ticket.subject ? ` — ${esc(ticket.subject)}` : ''}.</p>
      <p><strong>Scope:</strong><br>${esc(scope).replace(/\n/g, '<br>')}</p>
      <p><strong>Sent to:</strong></p>
      <ul>${sentTo.map(s => `<li>${esc(s.name)} — ${esc(s.email)} — <a href="${s.link}">link</a></li>`).join('')}</ul>
      <p><a href="${APP}/admin/tickets/${ticketId}">Open the work order →</a></p>`,
  }).catch(() => null)

  await appendMessage(ticketId, {
    direction: 'internal_note', channel: 'internal', from_addr: actor ?? 'staff',
    body: `📨 Estimate request sent to ${sentTo.length} vendor(s): ${sentTo.map(s => s.name).join(', ')}.\nScope: ${scope}`,
  }).catch(() => null)

  return NextResponse.json({ ok: true, request_id: reqRow.id, sent: sentTo.length })
}
