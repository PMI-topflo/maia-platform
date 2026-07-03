// =====================================================================
// POST /api/admin/work-orders/[id]/send-estimate-to-board
// Send the vendor-estimate COMPARISON to the board for approval. The board
// sees every submitted vendor (amount · scope · estimate images) and each
// signer picks which one they approve; the winner is stamped onto the
// approval once `required` signers pick the same vendor. Creates the
// approval + per-board-member review rows (capped to the chosen signers,
// honoring substitutes) and emails each a review link. Staff-only.
// Body: { recommended_vendor_request_id?, signer_ids? }
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
  let body: { recommended_vendor_request_id?: string; signer_ids?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const recommendedId = String(body.recommended_vendor_request_id ?? '').trim() || null

  // Latest estimate request on this work order + its submitted vendors.
  const { data: reqRow } = await supabaseAdmin.from('estimate_requests')
    .select('id, scope, association_code').eq('ticket_id', ticketId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!reqRow) return NextResponse.json({ error: 'no estimate request on this work order' }, { status: 404 })
  const assoc = reqRow.association_code ?? null
  if (!assoc) return NextResponse.json({ error: 'association unknown for this work order' }, { status: 400 })

  const { data: vendors } = await supabaseAdmin.from('estimate_request_vendors')
    .select('id, vendor_name, extracted_amount, status, estimate_path').eq('request_id', reqRow.id)
    .order('extracted_amount', { ascending: true, nullsFirst: false })
  const submitted = (vendors ?? []).filter(v => v.status === 'submitted' || !!v.estimate_path)
  if (submitted.length === 0) return NextResponse.json({ error: 'no submitted estimates to compare yet' }, { status: 400 })
  if (recommendedId && !submitted.some(v => v.id === recommendedId)) return NextResponse.json({ error: 'recommended vendor is not among the submitted estimates' }, { status: 400 })

  const { data: ticket } = await supabaseAdmin.from('tickets').select('ticket_number').eq('id', ticketId).single()

  // Paola chooses which board members must sign. Default = President only;
  // fall back to required_signatures members if there's no President.
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

  // The approval row holds the COMPARISON; the winning vendor/amount get
  // stamped on once `required` signers pick the same vendor.
  const { data: approval } = await supabaseAdmin.from('estimate_approvals').insert({
    request_id: reqRow.id, ticket_id: ticketId, association_code: assoc,
    scope: reqRow.scope ?? null, required, created_by: actor,
    recommended_vendor_request_id: recommendedId,
  }).select('id').single()
  if (!approval) return NextResponse.json({ error: 'could not create approval' }, { status: 500 })

  const assocName = await getAssociationName(assoc)
  const woLabel = `${ticket?.ticket_number ?? `WO ${ticketId}`} · ${assocName ?? assoc}`
  const recName = recommendedId ? (submitted.find(v => v.id === recommendedId)?.vendor_name ?? null) : null

  // Comparison table shown in the board email (every submitted estimate).
  const rows = submitted.map(v => {
    const amt = v.extracted_amount != null ? Number(v.extracted_amount) : null
    const rec = v.id === recommendedId
    return `<tr${rec ? ' style="background:#fff7ed"' : ''}>
      <td style="padding:6px 10px;border:1px solid #eee">${esc(v.vendor_name ?? '—')}${rec ? ' <strong style="color:' + ORANGE + '">★ recommended</strong>' : ''}</td>
      <td style="padding:6px 10px;border:1px solid #eee;text-align:right">${money(amt)}</td></tr>`
  }).join('')
  const compTable = `<table style="border-collapse:collapse;margin:14px 0;font-size:14px">
      <tr><th style="padding:6px 10px;background:#f9f9f9;border:1px solid #eee;text-align:left">Vendor</th><th style="padding:6px 10px;background:#f9f9f9;border:1px solid #eee;text-align:right">Amount</th></tr>
      ${rows}</table>`

  let sent = 0
  const sentTo: string[] = []
  for (const t of targets) {
    const tk = crypto.randomUUID()
    const { error: insErr } = await supabaseAdmin.from('estimate_approval_reviews').insert({ approval_id: approval.id, board_member_name: t.name, board_member_email: t.email, token: tk })
    if (insErr) continue
    const link = `${APP}/board/estimate?token=${tk}`
    await sendEmail({
      to: t.email!, bcc: VENDOR_NOTIFY_CC, replyTo: PAOLA,
      subject: `Board approval needed — estimates for ${woLabel}`,
      html: `<p>Dear ${esc(t.name ?? 'Board Member')},</p>
        <p>Estimates for <strong>${esc(woLabel)}</strong> are ready for the board to review. Please compare the vendors and approve the one you choose.</p>
        <p style="font-size:13px;color:#374151"><strong>Scope:</strong> ${esc(reqRow.scope ?? '')}</p>
        ${compTable}
        <p><a href="${link}" style="display:inline-block;background:${ORANGE};color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700">Review estimates &amp; approve →</a></p>
        <p style="font-size:12px;color:#6b7280">You'll see each vendor's full estimate and can pick which one to approve and sign. Reply to this email to reach our maintenance coordinator.</p>`,
    }).catch(() => null)
    sent++; sentTo.push(t.name ?? t.email!)
  }

  await sendEmail({ to: PAOLA, subject: `Estimate comparison sent to board — ${woLabel}`, html: `<p>A comparison of ${submitted.length} estimate(s)${recName ? ` (recommended: ${esc(recName)})` : ''} for <strong>${esc(woLabel)}</strong> was sent to ${sent} board member(s): ${esc(sentTo.join(', '))}.</p><p>Needs ${required} approval(s) for the same vendor. <a href="${APP}/admin/tickets/${ticketId}">Open the work order →</a></p>` }).catch(() => null)
  await appendMessage(ticketId, { direction: 'internal_note', channel: 'internal', from_addr: actor ?? 'staff', body: `🏛️ Estimate comparison sent to board — ${submitted.length} vendor(s)${recName ? `, recommended ${recName}` : ''}. Needs ${required} approval(s). Sent to: ${sentTo.join(', ')}.` }).catch(() => null)

  return NextResponse.json({ ok: true, approval_id: approval.id, sent, required, vendors: submitted.length })
}
