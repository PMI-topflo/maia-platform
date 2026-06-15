// =====================================================================
// GET /api/admin/invoices/intake/[id]/approved-estimate   (staff-only)
//
// For an invoice draft that's linked to a work order, return the board's
// estimate approval so Karen can confirm it was approved before paying:
//   • the signed "Board Approval" PDF rendered to page images (it bundles
//     the estimate + the signature page), and
//   • each board signer with their signature image + date.
// Resolves the work order by ticket_id (manual "Add invoice") or by the
// CINC work-order number (email / vendor-portal invoices).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { renderPdfToImageDataUrls } from '@/lib/pdf-normalize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const WO_BUCKET = 'work-order-photos'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt((await ctx.params).id, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const { data: draft } = await supabaseAdmin
    .from('invoice_intake_drafts').select('ticket_id, work_order_number').eq('id', id).maybeSingle()
  if (!draft) return NextResponse.json({ error: 'draft not found' }, { status: 404 })

  // Resolve the work order ticket.
  let ticketId = (draft.ticket_id ?? null) as number | null
  if (!ticketId && draft.work_order_number != null) {
    const { data: t } = await supabaseAdmin.from('tickets').select('id').eq('cinc_workorder_id', String(draft.work_order_number)).maybeSingle()
    ticketId = (t?.id as number | undefined) ?? null
  }
  if (!ticketId) return NextResponse.json({ approved: false, reason: 'no work order linked' })

  // Most recent APPROVED estimate for this work order.
  const { data: approval } = await supabaseAdmin
    .from('estimate_approvals')
    .select('id, vendor_name, amount, required, decided_at')
    .eq('ticket_id', ticketId).eq('status', 'approved')
    .order('decided_at', { ascending: false }).limit(1).maybeSingle()
  if (!approval) return NextResponse.json({ approved: false, reason: 'no board-approved estimate for this work order' })

  const { data: reviewRows } = await supabaseAdmin
    .from('estimate_approval_reviews')
    .select('board_member_name, board_member_email, signature_image, comments, decided_at')
    .eq('approval_id', approval.id).eq('decision', 'approve')
    .order('decided_at', { ascending: true })
  const signers = (reviewRows ?? []).map(r => ({
    name: (r.board_member_name as string | null) ?? (r.board_member_email as string | null) ?? 'Board member',
    signatureImage: (r.signature_image as string | null) ?? null,
    comments: (r.comments as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
  }))

  // The generated "Board Approval — …" PDF bundles the estimate + signature
  // page. Render it to images for the popup. Best-effort.
  let pages: string[] = []
  const { data: att } = await supabaseAdmin
    .from('work_order_attachments')
    .select('storage_path')
    .eq('ticket_id', ticketId).ilike('filename', 'Board Approval%')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (att?.storage_path) {
    try {
      const { data: blob } = await supabaseAdmin.storage.from(WO_BUCKET).download(att.storage_path as string)
      if (blob) pages = await renderPdfToImageDataUrls(Buffer.from(await blob.arrayBuffer()), { maxPages: 8 })
    } catch { /* fall through — signers still shown */ }
  }

  return NextResponse.json({
    approved: true,
    vendorName: (approval.vendor_name as string | null) ?? null,
    amount: (approval.amount as number | null) ?? null,
    requiredSignatures: (approval.required as number | null) ?? signers.length,
    decidedAt: (approval.decided_at as string | null) ?? null,
    signers,
    pages,
  })
}
