// POST /api/vendor/agenda/[token]/add-crew  { name, phone?, email?, preferred_channel?, preferred_language? }
// Lets the vendor OFFICE self-register a new crew member from the Friday
// agenda link. The new employee is tied to this service's vendor and then
// appears in Paola's roster. Token-gated, public.
import { NextResponse } from 'next/server'
import { verifyAgendaToken } from '@/lib/agenda-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createVendorEmployee } from '@/lib/recurring-services'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const serviceId = await verifyAgendaToken(token)
  if (!serviceId) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  const { data: svc } = await supabaseAdmin.from('recurring_services').select('cinc_vendor_id, vendor_name').eq('id', serviceId).maybeSingle()
  if (!svc) return NextResponse.json({ error: 'service not found' }, { status: 404 })

  let b: Record<string, unknown> = {}
  try { b = await req.json() } catch { /* */ }
  const name = String(b.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const r = await createVendorEmployee({
    cinc_vendor_id:     svc.cinc_vendor_id,
    vendor_name:        svc.vendor_name,
    name,
    phone:              b.phone ? String(b.phone).trim() : null,
    email:              b.email ? String(b.email).trim() : null,
    preferred_channel:  ['email', 'sms', 'whatsapp'].includes(String(b.preferred_channel)) ? String(b.preferred_channel) : 'whatsapp',
    preferred_language: ['en', 'es', 'pt', 'fr', 'he', 'ru', 'ht'].includes(String(b.preferred_language)) ? String(b.preferred_language) : 'es',
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, employee: { id: r.row.id, name: r.row.name } })
}
