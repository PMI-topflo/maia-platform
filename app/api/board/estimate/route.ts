// =====================================================================
// /api/board/estimate
// GET  ?token=  → the estimate comparison (every submitted vendor: name +
//                 amount + scope), the board member's saved signature, and
//                 any staff "recommended" highlight. The board picks one.
// POST { token, decision:'approve'|'revision', selected_vendor_request_id?,
//        signature?, comments? }
//      → record the decision (e-sign + which vendor); once `required`
//        signers approve the SAME vendor, stamp it as the winner + finalize.
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
    .select('id, ticket_id, association_code, request_id, vendor_request_id, recommended_vendor_request_id, vendor_name, amount, scope, status, required').eq('id', review.approval_id).single()
  if (!approval) return null
  return { review, approval }
}

/** Submitted vendors on this approval's RFQ, cheapest first. */
async function comparisonVendors(requestId: string | null) {
  if (!requestId) return []
  const { data } = await supabaseAdmin.from('estimate_request_vendors')
    .select('id, vendor_name, extracted_amount, estimate_summary, status, estimate_path')
    .eq('request_id', requestId).order('extracted_amount', { ascending: true, nullsFirst: false })
  return (data ?? [])
    .filter(v => v.status === 'submitted' || !!v.estimate_path)
    .map(v => ({ id: v.id as string, vendor_name: v.vendor_name as string | null, amount: v.extracted_amount != null ? Number(v.extracted_amount) : null, summary: (v.estimate_summary as string | null) ?? null, status: v.status as string }))
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!token) return NextResponse.json({ error: 'missing token' }, { status: 400 })
  const cx = await loadByToken(token)
  if (!cx) return NextResponse.json({ error: 'invalid or expired link' }, { status: 404 })
  const { review, approval } = cx

  const { data: ticket } = await supabaseAdmin.from('tickets').select('ticket_number, subject').eq('id', approval.ticket_id).single()
  const vendors = await comparisonVendors(approval.request_id as string | null)
  let savedSig: string | null = null
  if (review.board_member_email) {
    const { data: bm } = await supabaseAdmin.from('association_board_members').select('signature_image').eq('association_code', approval.association_code).eq('email', review.board_member_email).maybeSingle()
    savedSig = bm?.signature_image ?? null
  }

  return NextResponse.json({
    decided: !!review.decision,
    member: review.board_member_name,
    ticket: { number: ticket?.ticket_number ?? null, subject: ticket?.subject ?? null },
    scope: approval.scope ?? null,
    required: approval.required,
    status: approval.status,
    recommended_vendor_request_id: (approval.recommended_vendor_request_id as string | null) ?? null,
    winner_vendor_request_id: (approval.vendor_request_id as string | null) ?? null,
    vendors,
    saved_signature: savedSig,
  })
}

export async function POST(req: Request) {
  let body: { token?: string; decision?: string; selected_vendor_request_id?: string; signature?: string; comments?: string }
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
    await sendEmail({ to: PAOLA, subject: `Board requested a revision — ${woLabel}`, html: `<p><strong>${review.board_member_name}</strong> requested a revision on the estimates for <strong>${woLabel}</strong>.</p>${comments ? `<p><strong>Comment:</strong> ${comments}</p>` : ''}<p><a href="${APP}/admin/tickets/${approval.ticket_id}">Open the work order →</a></p>` }).catch(() => null)
    await appendMessage(approval.ticket_id, { direction: 'internal_note', channel: 'internal', from_addr: `Board (${review.board_member_name})`, body: `↩️ Board requested a REVISION on the estimates.${comments ? ` Comment: ${comments}` : ''}` }).catch(() => null)
    return NextResponse.json({ ok: true, status: 'revision_requested' })
  }

  // ── approve ──
  // Which vendor did this signer pick? New comparison flow sends it; fall
  // back to the approval's stamped vendor for legacy single-vendor approvals.
  const selectedId = String(body.selected_vendor_request_id ?? '').trim() || (approval.vendor_request_id as string | null) || null
  if (!selectedId) return NextResponse.json({ error: 'please choose which vendor to approve' }, { status: 400 })
  const { data: picked } = await supabaseAdmin.from('estimate_request_vendors')
    .select('id, vendor_name, extracted_amount').eq('id', selectedId).eq('request_id', approval.request_id as string).maybeSingle()
  if (!picked) return NextResponse.json({ error: 'the selected vendor is not part of this comparison' }, { status: 400 })

  // Signature: provided one, else the member's saved one.
  let signature = typeof body.signature === 'string' && body.signature.startsWith('data:image') ? body.signature : null
  if (!signature && review.board_member_email) {
    const { data: bm } = await supabaseAdmin.from('association_board_members').select('signature_image').eq('association_code', approval.association_code).eq('email', review.board_member_email).maybeSingle()
    signature = bm?.signature_image ?? null
  }
  if (!signature) return NextResponse.json({ error: 'a signature is required to approve' }, { status: 400 })

  await supabaseAdmin.from('estimate_approval_reviews').update({ decision: 'approve', selected_vendor_request_id: selectedId, signature_image: signature, decided_at: new Date().toISOString() }).eq('id', review.id)
  if (review.board_member_email) {
    await supabaseAdmin.from('association_board_members').update({ signature_image: signature }).eq('association_code', approval.association_code).eq('email', review.board_member_email).then(() => null, () => null)
  }

  // Count DECIDER approvals for the SAME vendor; the first vendor to reach
  // `required` wins. Voter approvals are recorded above but never count
  // toward the threshold. (Signers who pick different vendors simply don't
  // reach the threshold.)
  const { count } = await supabaseAdmin.from('estimate_approval_reviews')
    .select('id', { count: 'exact', head: true }).eq('approval_id', approval.id).eq('decision', 'approve').eq('selected_vendor_request_id', selectedId).eq('member_type', 'decider')
  const approvals = count ?? 0
  const vendorName = picked.vendor_name as string | null
  const finalized = approvals >= approval.required

  if (finalized) {
    // Stamp the winner onto the approval so finalizeEstimateApproval (and the
    // staff banner) read the chosen vendor from the approval row.
    await supabaseAdmin.from('estimate_approvals').update({
      status: 'approved', decided_at: new Date().toISOString(),
      vendor_request_id: selectedId, vendor_name: vendorName, amount: picked.extracted_amount,
    }).eq('id', approval.id)
    await appendMessage(approval.ticket_id, { direction: 'internal_note', channel: 'internal', from_addr: 'Board', body: `✅ Board APPROVED the ${vendorName} estimate (${approvals}/${approval.required}).` }).catch(() => null)
    try {
      const { finalizeEstimateApproval } = await import('@/lib/estimate-approval-pdf')
      await finalizeEstimateApproval(approval.id)
    } catch (err) {
      console.warn(`[board/estimate] signed-copy finalize failed: ${(err as Error).message}`)
      await sendEmail({ to: PAOLA, subject: `Board APPROVED — ${woLabel}`, html: `<p>The board approved the ${vendorName} estimate (${money(picked.extracted_amount != null ? Number(picked.extracted_amount) : null)}) for <strong>${woLabel}</strong> (${approvals}/${approval.required}). The signed-copy generation hit an error — open the work order to file it manually.</p><p><a href="${APP}/admin/tickets/${approval.ticket_id}">Open the work order →</a></p>` }).catch(() => null)
    }
  } else {
    await appendMessage(approval.ticket_id, { direction: 'internal_note', channel: 'internal', from_addr: `Board (${review.board_member_name})`, body: `✍️ ${review.board_member_name} approved the ${vendorName} estimate (${approvals}/${approval.required}).` }).catch(() => null)
  }
  return NextResponse.json({ ok: true, status: finalized ? 'approved' : 'pending', approvals, required: approval.required })
}
