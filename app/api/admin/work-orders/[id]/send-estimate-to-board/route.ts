// =====================================================================
// POST /api/admin/work-orders/[id]/send-estimate-to-board
// Send a chosen vendor estimate to the board for approval. Creates the
// approval + per-board-member review rows (capped to required_signatures,
// honoring substitutes) and emails each a sign link. Staff-only.
// Body: { vendor_request_id }
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { appendMessage } from '@/lib/tickets'
import { getAssociationName } from '@/lib/association-name'
import { VENDOR_NOTIFY_CC } from '@/lib/notify-recipients'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAOLA = 'service@topfloridaproperties.com'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const ORANGE = '#f26a1b'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const money = (n: number | null) => n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actor = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null

  const { id } = await ctx.params
  const ticketId = parseInt(id, 10)
  let body: { vendor_request_id?: string; signer_ids?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const ervId = String(body.vendor_request_id ?? '').trim()
  if (!ervId) return NextResponse.json({ error: 'vendor_request_id is required' }, { status: 400 })

  const { data: erv } = await supabaseAdmin.from('estimate_request_vendors')
    .select('id, request_id, vendor_name, extracted_amount').eq('id', ervId).single()
  if (!erv) return NextResponse.json({ error: 'estimate not found' }, { status: 404 })
  const { data: reqRow } = await supabaseAdmin.from('estimate_requests').select('scope, association_code').eq('id', erv.request_id).single()
  const assoc = reqRow?.association_code ?? null
  if (!assoc) return NextResponse.json({ error: 'association unknown for this work order' }, { status: 400 })
  const { data: ticket } = await supabaseAdmin.from('tickets').select('ticket_number').eq('id', ticketId).single()

  // C1: Paola chooses which board members must sign. Default = President only
  // (the platform already records the approval); fall back to required_signatures
  // members if there's no President. `required` = number of chosen signers.
  const signerIds: string[] = Array.isArray(body.signer_ids) ? body.signer_ids.map(String).filter(Boolean) : []
  const { data: config } = await supabaseAdmin.from('association_config').select('required_signatures').eq('association_code', assoc).maybeSingle()
  const { data: members } = await supabaseAdmin.from('association_board_members')
    .select('id, name, role, email, substitute_active, substitute_name, substitute_email').eq('association_code', assoc).eq('active', true).order('sort_order', { ascending: true })
  let chosen = members ?? []
  if (signerIds.length) {
    chosen = chosen.filter(m => signerIds.includes(m.id as string))
  } else {
    const pres = chosen.filter(m => /president/i.test((m.role as string) ?? ''))
    chosen = pres.length ? pres : chosen.slice(0, config?.required_signatures ?? 1)
  }
  const targets = chosen
    .map(m => ({ name: m.substitute_active && m.substitute_name ? m.substitute_name : m.name, email: m.substitute_active && m.substitute_email ? m.substitute_email : m.email }))
    .filter(t => t.email && t.email.includes('@'))
  const required = targets.length || 1
  if (targets.length === 0) return NextResponse.json({ error: 'No active board members with email for this association' }, { status: 400 })

  const amount = erv.extracted_amount != null ? Number(erv.extracted_amount) : null
  const { data: approval } = await supabaseAdmin.from('estimate_approvals').insert({
    request_id: erv.request_id, ticket_id: ticketId, association_code: assoc, vendor_request_id: erv.id,
    vendor_name: erv.vendor_name, amount, scope: reqRow?.scope ?? null, required, created_by: actor,
  }).select('id').single()
  if (!approval) return NextResponse.json({ error: 'could not create approval' }, { status: 500 })

  const assocName = await getAssociationName(assoc)
  const woLabel = `${ticket?.ticket_number ?? `WO ${ticketId}`} · ${assocName ?? assoc}`
  let sent = 0
  const sentTo: string[] = []
  for (const t of targets) {
    const tk = crypto.randomUUID()
    const { error: insErr } = await supabaseAdmin.from('estimate_approval_reviews').insert({ approval_id: approval.id, board_member_name: t.name, board_member_email: t.email, token: tk })
    if (insErr) continue
    const link = `${APP}/board/estimate?token=${tk}`
    await sendEmail({
      to: t.email!, bcc: VENDOR_NOTIFY_CC, replyTo: PAOLA,
      subject: `Board approval needed — estimate for ${woLabel}`,
      html: `<p>Dear ${esc(t.name ?? 'Board Member')},</p>
        <p>An estimate needs your approval for <strong>${esc(woLabel)}</strong>.</p>
        <table style="border-collapse:collapse;margin:14px 0;font-size:14px">
          <tr><td style="padding:6px 10px;background:#f9f9f9;border:1px solid #eee;font-weight:600">Vendor</td><td style="padding:6px 10px;border:1px solid #eee">${esc(erv.vendor_name ?? '—')}</td></tr>
          <tr><td style="padding:6px 10px;background:#f9f9f9;border:1px solid #eee;font-weight:600">Amount</td><td style="padding:6px 10px;border:1px solid #eee">${money(amount)}</td></tr>
          <tr><td style="padding:6px 10px;background:#f9f9f9;border:1px solid #eee;font-weight:600">Scope</td><td style="padding:6px 10px;border:1px solid #eee">${esc(reqRow?.scope ?? '')}</td></tr>
        </table>
        <p><a href="${link}" style="display:inline-block;background:${ORANGE};color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700">Review &amp; sign →</a></p>
        <p style="font-size:12px;color:#6b7280">Reply to this email to reach our maintenance coordinator.</p>`,
    }).catch(() => null)
    sent++; sentTo.push(t.name ?? t.email!)
  }

  await sendEmail({ to: PAOLA, subject: `Estimate sent to board — ${woLabel}`, html: `<p>The ${esc(erv.vendor_name ?? '')} estimate (${money(amount)}) for <strong>${esc(woLabel)}</strong> was sent to ${sent} board member(s): ${esc(sentTo.join(', '))}.</p><p>Needs ${required} approval(s). <a href="${APP}/admin/tickets/${ticketId}">Open the work order →</a></p>` }).catch(() => null)
  await appendMessage(ticketId, { direction: 'internal_note', channel: 'internal', from_addr: actor ?? 'staff', body: `🏛️ Estimate sent to board for approval — ${erv.vendor_name} (${money(amount)}). Needs ${required} approval(s). Sent to: ${sentTo.join(', ')}.` }).catch(() => null)

  return NextResponse.json({ ok: true, approval_id: approval.id, sent, required })
}
