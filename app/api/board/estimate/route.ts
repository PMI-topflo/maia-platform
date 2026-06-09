// =====================================================================
// /api/board/estimate
// GET  ?token=  → the estimate approval (chosen vendor + amount + scope +
//                 PDF), the comparison, and the board member's saved signature.
// POST { token, decision:'approve'|'revision', signature?, comments? }
//      → record the decision (e-sign), save the signature for reuse, and
//        flip the approval once required_signatures approvals land.
// Public (token-gated).
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { appendMessage } from '@/lib/tickets'

export const dynamic = 'force-dynamic'
const PAOLA = 'service@topfloridaproperties.com'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const money = (n: number | null) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function loadByToken(token: string) {
  const { data: review } = await supabaseAdmin.from('estimate_approval_reviews')
    .select('id, approval_id, board_member_name, board_member_email, decision').eq('token', token).single()
  if (!review) return null
  const { data: approval } = await supabaseAdmin.from('estimate_approvals')
    .select('id, ticket_id, association_code, request_id, vendor_request_id, vendor_name, amount, scope, status, required').eq('id', review.approval_id).single()
  if (!approval) return null
  return { review, approval }
}

async function estimateUrl(ervId: string | null): Promise<string | null> {
  if (!ervId) return null
  const { data: erv } = await supabaseAdmin.from('estimate_request_vendors').select('estimate_path').eq('id', ervId).single()
  if (!erv?.estimate_path) return null
  const { data: att } = await supabaseAdmin.from('work_order_attachments').select('storage_path').eq('id', erv.estimate_path).single()
  if (!att?.storage_path) return null
  const { data: signed } = await supabaseAdmin.storage.from('work-order-photos').createSignedUrl(att.storage_path, 3600)
  return signed?.signedUrl ?? null
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!token) return NextResponse.json({ error: 'missing token' }, { status: 400 })
  const cx = await loadByToken(token)
  if (!cx) return NextResponse.json({ error: 'invalid or expired link' }, { status: 404 })
  const { review, approval } = cx

  const { data: ticket } = await supabaseAdmin.from('tickets').select('ticket_number, subject').eq('id', approval.ticket_id).single()
  const { data: comp } = await supabaseAdmin.from('estimate_request_vendors')
    .select('vendor_name, extracted_amount, status').eq('request_id', approval.request_id).order('extracted_amount', { ascending: true, nullsFirst: false })
  let savedSig: string | null = null
  if (review.board_member_email) {
    const { data: bm } = await supabaseAdmin.from('association_board_members').select('signature_image').eq('association_code', approval.association_code).eq('email', review.board_member_email).maybeSingle()
    savedSig = bm?.signature_image ?? null
  }

  return NextResponse.json({
    decided: !!review.decision,
    member: review.board_member_name,
    approval: { vendor_name: approval.vendor_name, amount: approval.amount != null ? Number(approval.amount) : null, scope: approval.scope, status: approval.status, required: approval.required },
    ticket: { number: ticket?.ticket_number ?? null, subject: ticket?.subject ?? null },
    comparison: (comp ?? []).map(v => ({ vendor_name: v.vendor_name, amount: v.extracted_amount != null ? Number(v.extracted_amount) : null, status: v.status })),
    estimate_url: await estimateUrl(approval.vendor_request_id),
    saved_signature: savedSig,
  })
}

export async function POST(req: Request) {
  let body: { token?: string; decision?: string; signature?: string; comments?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const token = String(body.token ?? '')
  const decision = body.decision
  if (!token || (decision !== 'approve' && decision !== 'revision')) return NextResponse.json({ error: 'token + decision required' }, { status: 400 })

  const cx = await loadByToken(token)
  if (!cx) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
  const { review, approval } = cx
  if (review.decision) return NextResponse.json({ error: 'already submitted' }, { status: 409 })

  const woLabel = `WO ${approval.ticket_id} · ${approval.association_code ?? ''}`

  if (decision === 'revision') {
    const comments = String(body.comments ?? '').trim()
    await supabaseAdmin.from('estimate_approval_reviews').update({ decision: 'revision', comments, decided_at: new Date().toISOString() }).eq('id', review.id)
    await supabaseAdmin.from('estimate_approvals').update({ status: 'revision_requested', decided_at: new Date().toISOString() }).eq('id', approval.id)
    await sendEmail({ to: PAOLA, subject: `Board requested a revision — ${woLabel}`, html: `<p><strong>${review.board_member_name}</strong> requested a revision on the ${approval.vendor_name} estimate for <strong>${woLabel}</strong>.</p>${comments ? `<p><strong>Comment:</strong> ${comments}</p>` : ''}<p><a href="${APP}/admin/tickets/${approval.ticket_id}">Open the work order →</a></p>` }).catch(() => null)
    await appendMessage(approval.ticket_id, { direction: 'internal_note', channel: 'internal', from_addr: `Board (${review.board_member_name})`, body: `↩️ Board requested a REVISION on the ${approval.vendor_name} estimate.${comments ? ` Comment: ${comments}` : ''}` }).catch(() => null)
    return NextResponse.json({ ok: true, status: 'revision_requested' })
  }

  // approve — use provided signature, else the member's saved one
  let signature = typeof body.signature === 'string' && body.signature.startsWith('data:image') ? body.signature : null
  if (!signature && review.board_member_email) {
    const { data: bm } = await supabaseAdmin.from('association_board_members').select('signature_image').eq('association_code', approval.association_code).eq('email', review.board_member_email).maybeSingle()
    signature = bm?.signature_image ?? null
  }
  if (!signature) return NextResponse.json({ error: 'a signature is required to approve' }, { status: 400 })

  await supabaseAdmin.from('estimate_approval_reviews').update({ decision: 'approve', signature_image: signature, decided_at: new Date().toISOString() }).eq('id', review.id)
  // Save/refresh the member's signature for reuse next time.
  if (review.board_member_email) {
    await supabaseAdmin.from('association_board_members').update({ signature_image: signature }).eq('association_code', approval.association_code).eq('email', review.board_member_email).then(() => null, () => null)
  }

  const { count } = await supabaseAdmin.from('estimate_approval_reviews').select('id', { count: 'exact', head: true }).eq('approval_id', approval.id).eq('decision', 'approve')
  const approvals = count ?? 0
  const finalized = approvals >= approval.required
  if (finalized) {
    await supabaseAdmin.from('estimate_approvals').update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', approval.id)
    await sendEmail({ to: PAOLA, subject: `Board APPROVED — ${woLabel}`, html: `<p>The board approved the ${approval.vendor_name} estimate (${money(approval.amount != null ? Number(approval.amount) : null)}) for <strong>${woLabel}</strong> (${approvals}/${approval.required}).</p><p><a href="${APP}/admin/tickets/${approval.ticket_id}">Open the work order →</a></p>` }).catch(() => null)
    await appendMessage(approval.ticket_id, { direction: 'internal_note', channel: 'internal', from_addr: 'Board', body: `✅ Board APPROVED the ${approval.vendor_name} estimate (${approvals}/${approval.required}).` }).catch(() => null)
  } else {
    await appendMessage(approval.ticket_id, { direction: 'internal_note', channel: 'internal', from_addr: `Board (${review.board_member_name})`, body: `✍️ ${review.board_member_name} approved the ${approval.vendor_name} estimate (${approvals}/${approval.required}).` }).catch(() => null)
  }
  return NextResponse.json({ ok: true, status: finalized ? 'approved' : 'pending', approvals, required: approval.required })
}
