// POST /api/request/[token]/lease-packet
// Public (token-gated): the owner or tenant pushes the "Send me the
// Landlord–Tenant Agreement to sign" button on their /request/[token] card.
// Triggers the same sendLeasePacket() the staff request-docs panel and the
// units-portal button use — one owner+tenant e-sign packet, never a
// duplicate. Refuses if a packet already exists for this unit (sent,
// partially signed, or completed) — the card only shows this button when
// none does; a second click racing the first must not double-invite.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadRequest } from '../route'
import { sendLeasePacket, findUnitLeasePacket } from '@/lib/lease-packet'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await loadRequest(token)
  if (!r) return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 404 })

  const code = String(r.req.association_code)
  const unit = (r.req.unit_label as string | null) ?? null
  if (!unit) return NextResponse.json({ error: 'No unit on this application.' }, { status: 400 })

  const existing = await findUnitLeasePacket(code, unit)
  if (existing) return NextResponse.json({ error: 'Already sent — check your inbox (or spam) for the signing link.' }, { status: 409 })

  // Same tenant override request-docs/route.ts resolves from — a brand-new
  // lease's tenant is on application_stakeholders well before
  // unit_tenant_contacts has heard of them.
  const { data: primaryApplicant } = await supabaseAdmin.from('application_stakeholders')
    .select('name, email, phone').eq('application_id', r.req.application_id).eq('role', 'applicant')
    .order('is_primary', { ascending: false }).limit(1).maybeSingle()

  const result = await sendLeasePacket(code, unit, `request-page:${r.role}`, {
    name: (primaryApplicant?.name as string | null) ?? null,
    email: (primaryApplicant?.email as string | null) ?? null,
    phone: (primaryApplicant?.phone as string | null) ?? null,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ ok: true, sent: result.sent, skipped: result.skipped })
}
