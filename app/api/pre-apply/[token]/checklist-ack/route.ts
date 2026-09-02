// POST /api/pre-apply/[token]/checklist-ack   { name, signatureImage? }
// Phase 2 of the Checkr-first pipeline redesign (docs/ROADMAP.md's Phasing
// item 2): before the primary applicant reaches the payment/screening
// button on ScreeningPaymentGate, they e-sign an acknowledgment covering
// (a) the full document checklist they were just shown, and (b) the
// 45-day-from-screening-completion deadline. Distinct from the rules
// acknowledgment signed later (POST .../submit) -- its own signature, its
// own columns (lib/preapply.ts's signChecklistAck).
//
// Same eligibility as ScreeningPaymentGate itself (app/pre-apply/[code]/
// page.tsx's screeningGateActive): only a role='applicant' stakeholder on
// a lease/purchase/additional_occupant application signs this. Re-checked
// server-side rather than trusted to the client.

import { NextResponse } from 'next/server'
import { getIntake, resolveToken, signChecklistAck } from '@/lib/preapply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GATED_TYPES = new Set(['lease', 'purchase', 'additional_occupant'])

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await resolveToken(token)
  if (!r) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const intake = await getIntake(r.applicationId)
  if (!intake) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const me = r.stakeholder

  if (me.role !== 'applicant' || !GATED_TYPES.has(intake.type)) {
    return NextResponse.json({ error: 'This acknowledgment does not apply to you.' }, { status: 400 })
  }

  let b: { name?: string; signatureImage?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const name = String(b.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Please type your name to sign.' }, { status: 400 })
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const sig = (b.signatureImage && b.signatureImage.startsWith('data:image')) ? b.signatureImage : null

  await signChecklistAck(me.id, { name, signature: sig, ip })

  return NextResponse.json({ ok: true })
}
