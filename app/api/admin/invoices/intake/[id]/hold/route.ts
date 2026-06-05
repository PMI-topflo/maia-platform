// =====================================================================
// app/api/admin/invoices/intake/[id]/hold/route.ts
// POST — put an invoice draft ON HOLD while collecting missing vendor
// docs (COI / license / W-9 / ACH). Optionally creates a follow-up work
// order ticket and emails the vendor a tokenized upload link listing the
// requested documents.
//
//   POST { items: string[], note?, createTicket?: bool, attachTicketId?,
//          emailVendor?: bool, vendorEmail? }
//   DELETE — release from hold back to pending_review.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { createTicket } from '@/lib/tickets'
import { signVendorUploadToken } from '@/lib/vendor-upload-token'

export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

async function staffEmail() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return null
  return typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await staffEmail()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: idStr } = await ctx.params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  let body: { items?: unknown; note?: unknown; createTicket?: unknown; attachTicketId?: unknown; emailVendor?: unknown; vendorEmail?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const items = Array.isArray(body.items) ? body.items.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(s => s.trim()) : []
  const note  = typeof body.note === 'string' ? body.note.trim() : null
  if (items.length === 0) return NextResponse.json({ error: 'Select at least one document to request.' }, { status: 400 })

  const { data: draft, error: loadErr } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('id, status, cinc_invoice_id, matched_vendor_name, extracted_vendor_name, extracted_association_code, extracted_invoice_number, extracted_amount')
    .eq('id', id).single()
  if (loadErr || !draft) return NextResponse.json({ error: loadErr?.message ?? 'not found' }, { status: 404 })
  if (draft.status === 'pushed_to_cinc' || draft.cinc_invoice_id) {
    return NextResponse.json({ error: 'Already pushed to CINC — cannot put on hold.' }, { status: 409 })
  }

  const vendor = (draft.matched_vendor_name ?? draft.extracted_vendor_name ?? 'vendor') as string
  const assoc  = (draft.extracted_association_code ?? null) as string | null

  // ── Follow-up ticket (create new work order, or attach an existing one) ──
  let ticketId: number | null = typeof body.attachTicketId === 'number' ? body.attachTicketId : null
  if (!ticketId && body.createTicket !== false) {
    try {
      const t = await createTicket({
        // A "vendor docs needed" follow-up is an admin/paperwork chase, NOT
        // field maintenance — so it's a ticket, not a work order.
        type:            'ticket',
        channel_origin:  'internal',
        priority:        'normal',
        association_code: assoc,
        contact_name:    vendor,
        contact_email:   typeof body.vendorEmail === 'string' ? body.vendorEmail : null,
        subject:         `Vendor docs needed — ${vendor}`,
        summary:         `Invoice on hold pending: ${items.join(', ')}.${note ? ` Note: ${note}` : ''} (invoice #${draft.extracted_invoice_number ?? '—'}, $${draft.extracted_amount ?? '—'}${assoc ? `, ${assoc}` : ''})`,
        assignee_email:  me,
        ticket_category: 'Vendor Compliance',
      })
      ticketId = t.id
    } catch (err) {
      console.warn('[invoice-hold] ticket create failed:', err instanceof Error ? err.message : err)
    }
  }

  // ── Mark on hold ─────────────────────────────────────────────────────
  const { error: updErr } = await supabaseAdmin.from('invoice_intake_drafts').update({
    status:               'on_hold',
    hold_requested_items: items,
    hold_ticket_id:       ticketId,
    hold_requested_at:    new Date().toISOString(),
    hold_note:            note,
    updated_at:           new Date().toISOString(),
  }).eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // ── Email the vendor a tokenized upload link listing the requested docs ──
  let emailWarning: string | null = null
  let uploadLink: string | null = null
  const vendorEmail = typeof body.vendorEmail === 'string' ? body.vendorEmail.trim() : ''
  if (body.emailVendor && vendorEmail && ticketId) {
    try {
      const token = await signVendorUploadToken(ticketId)
      uploadLink = `${APP_URL}/vendor/upload/${token}`
      const list = items.map(i => `<li>${i}</li>`).join('')
      await sendEmail({
        to: vendorEmail,
        subject: `Documents needed — PMI Top Florida Properties`,
        html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a">
          <p>Hello ${vendor},</p>
          <p>Before we can process your invoice, please provide the following:</p>
          <ul>${list}</ul>
          ${note ? `<p>${note}</p>` : ''}
          <p><a href="${uploadLink}" style="display:inline-block;background:#f26a1b;color:#fff;padding:11px 22px;border-radius:6px;text-decoration:none;font-weight:600">Upload your documents →</a></p>
          <p style="font-size:12px;color:#9ca3af">PMI Top Florida Properties</p>
        </div>`,
        text: `Hello ${vendor},\n\nBefore we can process your invoice, please provide: ${items.join(', ')}.\n${note ? note + '\n' : ''}\nUpload here: ${uploadLink}\n\nPMI Top Florida Properties`,
      })
    } catch (err) {
      emailWarning = `Couldn't email the vendor: ${err instanceof Error ? err.message : String(err)}`
    }
  } else if (body.emailVendor && !vendorEmail) {
    emailWarning = 'No vendor email provided — skipped the email. The upload link is on the follow-up ticket.'
  }

  return NextResponse.json({ ok: true, ticketId, uploadLink, warning: emailWarning })
}

// Release from hold → back to pending review.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await staffEmail()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: idStr } = await ctx.params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('invoice_intake_drafts')
    .update({ status: 'pending_review', hold_requested_at: null, updated_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'on_hold')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
