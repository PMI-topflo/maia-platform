// =====================================================================
// /api/board/invoice-review
// GET  ?token=  → the invoice approval package (vendor, amount, status)
//                 and the board member's saved signature.
// POST { token, decision:'approve'|'revision', signature?, comments? }
//      → record the decision; once `required` DECIDERS approve, finalize
//        and (if the invoice already has a cinc_invoice_id) call CINC's
//        approveInvoice to flip it out of Pending Approval + write the
//        approver identity via createInvoiceNote(). If the invoice hasn't
//        been pushed to CINC yet, push/route.ts picks up the decided
//        approval and does both at push time.
// Public (token-gated).
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { createInvoiceNote, approveInvoice } from '@/lib/integrations/cinc'
import { PAOLA_EMAIL } from '@/lib/notify-recipients'

export const dynamic = 'force-dynamic'
const money = (n: number | null) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function loadByToken(token: string) {
  const { data: review } = await supabaseAdmin.from('invoice_approval_reviews')
    .select('id, approval_id, board_member_name, board_member_email, member_type, decision').eq('token', token).single()
  if (!review) return null
  const { data: approval } = await supabaseAdmin.from('invoice_approvals')
    .select('id, invoice_intake_id, cinc_invoice_id, association_code, vendor_name, amount, status, required').eq('id', review.approval_id).single()
  if (!approval) return null
  return { review, approval }
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!token) return NextResponse.json({ error: 'missing token' }, { status: 400 })
  const cx = await loadByToken(token)
  if (!cx) return NextResponse.json({ error: 'invalid or expired link' }, { status: 404 })
  const { review, approval } = cx

  let savedSig: string | null = null
  if (review.board_member_email) {
    const { data: bm } = await supabaseAdmin.from('association_board_members').select('signature_image').eq('association_code', approval.association_code).eq('email', review.board_member_email).maybeSingle()
    savedSig = bm?.signature_image ?? null
  }

  return NextResponse.json({
    decided:       !!review.decision,
    member:        review.board_member_name,
    member_type:   review.member_type,
    vendor_name:   approval.vendor_name,
    amount:        approval.amount,
    association_code: approval.association_code,
    status:        approval.status,
    required:      approval.required,
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

  const invLabel = `${approval.vendor_name ?? 'Vendor'} · ${approval.association_code ?? ''} · ${money(approval.amount as number | null)}`

  if (decision === 'revision') {
    const comments = String(body.comments ?? '').trim()
    await supabaseAdmin.from('invoice_approval_reviews').update({ decision: 'revision', comments, decided_at: new Date().toISOString() }).eq('id', review.id)
    await supabaseAdmin.from('invoice_approvals').update({ status: 'revision_requested', decided_at: new Date().toISOString() }).eq('id', approval.id)
    await sendEmail({ to: PAOLA_EMAIL, subject: `Board requested a revision — ${invLabel}`, html: `<p><strong>${review.board_member_name}</strong> requested a revision on the invoice <strong>${invLabel}</strong>.</p>${comments ? `<p><strong>Comment:</strong> ${comments}</p>` : ''}` }).catch(() => null)
    return NextResponse.json({ ok: true, status: 'revision_requested' })
  }

  // Signature: provided one, else the member's saved one.
  let signature = typeof body.signature === 'string' && body.signature.startsWith('data:image') ? body.signature : null
  if (!signature && review.board_member_email) {
    const { data: bm } = await supabaseAdmin.from('association_board_members').select('signature_image').eq('association_code', approval.association_code).eq('email', review.board_member_email).maybeSingle()
    signature = bm?.signature_image ?? null
  }
  if (!signature) return NextResponse.json({ error: 'a signature is required to approve' }, { status: 400 })

  await supabaseAdmin.from('invoice_approval_reviews').update({ decision: 'approve', signature_image: signature, decided_at: new Date().toISOString() }).eq('id', review.id)
  if (review.board_member_email) {
    await supabaseAdmin.from('association_board_members').update({ signature_image: signature }).eq('association_code', approval.association_code).eq('email', review.board_member_email).then(() => null, () => null)
  }

  // Count DECIDER approvals only -- voter approvals are recorded but never
  // count toward the threshold.
  const { count } = await supabaseAdmin.from('invoice_approval_reviews')
    .select('id', { count: 'exact', head: true }).eq('approval_id', approval.id).eq('decision', 'approve').eq('member_type', 'decider')
  const approvals = count ?? 0
  const finalized = approvals >= approval.required

  if (finalized) {
    await supabaseAdmin.from('invoice_approvals').update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', approval.id)

    // Writeback: only possible if the invoice is already in CINC. If not
    // yet pushed, push/route.ts writes this note once cinc_invoice_id
    // exists (it checks for a decided invoice_approvals row at push time).
    if (approval.cinc_invoice_id) {
      const { data: deciders } = await supabaseAdmin
        .from('invoice_approval_reviews')
        .select('board_member_name')
        .eq('approval_id', approval.id)
        .eq('member_type', 'decider')
        .eq('decision', 'approve')
      const names = (deciders ?? []).map(d => d.board_member_name).filter(Boolean).join(', ')
      const cincId = Number(approval.cinc_invoice_id)
      await approveInvoice({ invoiceId: cincId }).catch(err => {
        console.warn(`[board/invoice-review] approveInvoice failed (invoice still Pending Approval in CINC, needs WebAxis): ${(err as Error).message}`)
      })
      await createInvoiceNote({
        invoiceId: cincId,
        content:   `Invoice approved by board: ${names || review.board_member_name} on ${new Date().toISOString().slice(0, 10)} via MAIA.`,
      }).catch(() => null)
    }

    await sendEmail({ to: PAOLA_EMAIL, subject: `Board APPROVED — ${invLabel}`, html: `<p>The board approved the invoice <strong>${invLabel}</strong> (${approvals}/${approval.required} decider signature(s)).</p>` }).catch(() => null)
  }

  return NextResponse.json({ ok: true, status: finalized ? 'approved' : 'pending', approvals, required: approval.required })
}
