// =====================================================================
// POST /api/admin/invoices/intake/[id]/send-to-board
// Send an AP invoice for optional board approval. Staff pick which
// configured committee members (deciders + voters) get the link; each
// gets a review token. Does NOT block pushing the invoice to CINC —
// approval and push are independent (see push/route.ts, which writes
// the approver identity back into CINC via createInvoiceNote() once
// both a decided approval and a cinc_invoice_id exist).
// Body: { signer_ids? }
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { createInvoiceNote } from '@/lib/integrations/cinc'
import { getAssociationName } from '@/lib/association-name'
import { VENDOR_NOTIFY_CC, VENDOR_REPLY_TO, PAOLA_EMAIL } from '@/lib/notify-recipients'

export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const ORANGE = '#f26a1b'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const money = (n: number | null) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type CommitteeRow = {
  board_member_id: string
  member_type: 'decider' | 'voter'
  association_board_members: {
    id: string; name: string; email: string; active: boolean
    substitute_active: boolean; substitute_name: string | null; substitute_email: string | null
  } | null
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actor = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null

  const { id: idStr } = await ctx.params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  let body: { signer_ids?: string[] } = {}
  try { body = await req.json() } catch { /* allow empty body */ }
  const signerIds: string[] = Array.isArray(body.signer_ids) ? body.signer_ids.map(String).filter(Boolean) : []

  const { data: draft, error: draftErr } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('id, extracted_association_code, matched_vendor_name, extracted_amount, cinc_invoice_id')
    .eq('id', id)
    .single()
  if (draftErr || !draft) return NextResponse.json({ error: 'invoice draft not found' }, { status: 404 })

  const assoc = draft.extracted_association_code as string | null
  if (!assoc) return NextResponse.json({ error: 'association unknown for this invoice' }, { status: 400 })

  const { data: config } = await supabaseAdmin
    .from('board_approval_config')
    .select('required_signatures')
    .eq('association_code', assoc)
    .eq('purpose', 'invoice')
    .maybeSingle()

  const { data: committee } = await supabaseAdmin
    .from('board_approval_members')
    .select('board_member_id, member_type, association_board_members(id, name, email, active, substitute_active, substitute_name, substitute_email)')
    .eq('association_code', assoc)
    .eq('purpose', 'invoice')

  let chosen = ((committee ?? []) as unknown as CommitteeRow[]).filter(c => c.association_board_members?.active)
  if (signerIds.length) chosen = chosen.filter(c => signerIds.includes(c.board_member_id))
  const targets = chosen
    .map(c => {
      const m = c.association_board_members!
      return { name: m.substitute_active && m.substitute_name ? m.substitute_name : m.name, email: m.substitute_active && m.substitute_email ? m.substitute_email : m.email, memberType: c.member_type }
    })
    .filter(t => t.email && t.email.includes('@'))

  if (targets.length === 0) {
    return NextResponse.json({ error: 'No committee configured for invoice approval on this association — set it up in Board Setup first' }, { status: 400 })
  }

  const { data: approval } = await supabaseAdmin.from('invoice_approvals').insert({
    invoice_intake_id: id,
    cinc_invoice_id:    (draft.cinc_invoice_id as string | null) ?? null,
    association_code:   assoc,
    vendor_name:         draft.matched_vendor_name as string | null,
    amount:              draft.extracted_amount as number | null,
    required:            config?.required_signatures ?? 1,
    created_by:          actor,
  }).select('id').single()
  if (!approval) return NextResponse.json({ error: 'could not create approval' }, { status: 500 })

  const assocName = await getAssociationName(assoc)
  const vendorLabel = (draft.matched_vendor_name as string | null) ?? 'Vendor'
  const amountLabel = money(draft.extracted_amount as number | null)

  let sent = 0
  const sentTo: string[] = []
  for (const t of targets) {
    const tk = crypto.randomUUID()
    const { error: insErr } = await supabaseAdmin.from('invoice_approval_reviews').insert({
      approval_id: approval.id, board_member_name: t.name, board_member_email: t.email, member_type: t.memberType, token: tk,
    })
    if (insErr) continue
    const link = `${APP}/board/invoice-review?token=${tk}`
    await sendEmail({
      to: t.email!, bcc: VENDOR_NOTIFY_CC, replyTo: VENDOR_REPLY_TO,
      subject: `Board approval needed — invoice from ${vendorLabel} (${assocName ?? assoc})`,
      html: `<p>Dear ${esc(t.name ?? 'Board Member')},</p>
        <p>An invoice from <strong>${esc(vendorLabel)}</strong> for <strong>${esc(assocName ?? assoc)}</strong> is ready for board review.</p>
        <table style="border-collapse:collapse;margin:14px 0;font-size:14px">
          <tr><td style="padding:6px 10px;background:#f9f9f9;border:1px solid #eee;font-weight:600">Vendor</td><td style="padding:6px 10px;border:1px solid #eee">${esc(vendorLabel)}</td></tr>
          <tr><td style="padding:6px 10px;background:#f9f9f9;border:1px solid #eee;font-weight:600">Amount</td><td style="padding:6px 10px;border:1px solid #eee">${amountLabel}</td></tr>
        </table>
        <p><a href="${link}" style="display:inline-block;background:${ORANGE};color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700">Review &amp; approve →</a></p>
        <p style="font-size:12px;color:#6b7280">Reply to this email to reach our accounting team.</p>`,
    }).catch(() => null)
    sent++; sentTo.push(t.name ?? t.email!)
  }

  await sendEmail({
    to: PAOLA_EMAIL,
    subject: `Invoice sent to board for approval — ${vendorLabel} (${assocName ?? assoc})`,
    html: `<p>An invoice from <strong>${esc(vendorLabel)}</strong> (${amountLabel}) for <strong>${esc(assocName ?? assoc)}</strong> was sent to ${sent} board member(s): ${esc(sentTo.join(', '))}.</p><p>Needs ${config?.required_signatures ?? 1} decider approval(s).</p>`,
  }).catch(() => null)

  // If the invoice is already in CINC, note that it was routed to the
  // board (a lighter provenance note than the final approval note, which
  // gets written once a decider actually approves).
  if (draft.cinc_invoice_id) {
    await createInvoiceNote({
      invoiceId: Number(draft.cinc_invoice_id),
      content:   `Sent to board for approval via MAIA on ${new Date().toISOString().slice(0, 10)} by ${actor ?? 'staff'}.`,
    }).catch(() => null)
  }

  return NextResponse.json({ ok: true, approval_id: approval.id, sent, required: config?.required_signatures ?? 1 })
}
