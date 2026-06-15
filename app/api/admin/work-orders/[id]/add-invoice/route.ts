// =====================================================================
// POST /api/admin/work-orders/[id]/add-invoice    (staff-only)
//
// Paola adds the vendor's invoice straight from a work order. The PDF/photo
// runs through the normal intake pipeline (Claude extraction + CINC vendor
// match + duplicate pre-check), pre-linked to THIS work order (ticket_id +
// work_order_number + association + vendor), and lands as a draft in the
// Invoice Intake review queue. The work order is marked "ready_for_payment".
// When AP later pushes that invoice to CINC, the push route closes the WO as
// PAID (app/api/admin/invoices/intake/[id]/push). multipart: field "file".
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createInvoiceDraftFromUpload } from '@/lib/invoice-intake'
import { appendMessage } from '@/lib/tickets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_BYTES = 25 * 1024 * 1024
const ACCEPTED = /\.(pdf|jpe?g|png|heic|heif|webp)$/i

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const by = typeof session.userId === 'string' ? session.userId : 'staff'

  const id = parseInt((await ctx.params).id, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid work order id' }, { status: 400 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 }) }
  const file = form.getAll('file').find((f): f is File => f instanceof File && f.size > 0)
  if (!file) return NextResponse.json({ error: 'no file uploaded' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file over 25 MB' }, { status: 400 })
  if (!ACCEPTED.test(file.name)) return NextResponse.json({ error: 'not a PDF or image' }, { status: 400 })

  const { data: ticket } = await supabaseAdmin
    .from('tickets')
    .select('id, ticket_number, type, status, association_code, cinc_workorder_id')
    .eq('id', id).maybeSingle()
  if (!ticket) return NextResponse.json({ error: 'work order not found' }, { status: 404 })

  const { data: wod } = await supabaseAdmin
    .from('work_order_details').select('vendor_name').eq('ticket_id', id).maybeSingle()
  const woNum = ticket.cinc_workorder_id ? parseInt(String(ticket.cinc_workorder_id), 10) : null

  let result: Awaited<ReturnType<typeof createInvoiceDraftFromUpload>>
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    result = await createInvoiceDraftFromUpload({
      ticketId:        id,
      associationCode: (ticket.association_code as string | null) ?? null,
      vendorName:      (wod?.vendor_name as string | null) ?? null,
      workOrderNumber: woNum !== null && Number.isFinite(woNum) ? woNum : null,
      buf,
      filename:        file.name,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  if (!result.ok) return NextResponse.json({ error: result.reason ?? 'could not read the invoice' }, { status: 502 })

  // Mark the WO ready for payment (left open until the invoice is paid in CINC).
  await supabaseAdmin.from('tickets').update({ payment_state: 'ready_for_payment', updated_at: new Date().toISOString() }).eq('id', id)
  await appendMessage(id, {
    direction: 'internal_note', channel: 'internal', from_addr: 'maia',
    body: `💳 Invoice added by ${by} — work order is READY FOR PAYMENT. It's in the Invoice Intake review queue${result.status === 'needs_vendor' ? ' (needs a CINC vendor match)' : ''}; the WO will close as PAID once it's pushed to CINC.`,
  }).catch(() => null)

  return NextResponse.json({ ok: true, status: result.status, draftId: result.draftId })
}
