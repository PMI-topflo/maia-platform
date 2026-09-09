// POST /api/admin/pre-apply/[id]/send-payment-link
//
// Emails the primary applicant the same /apply?listingApp=... payment link
// app/pre-apply/[code]/page.tsx's ScreeningPaymentGate already shows her --
// for the case that gate was never shown at all: an application already had
// her pass through her checklist page before the gate existed for her (or
// before this association defaulted to Checkr), so payment was never in her
// workflow. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { sendApplicationPaymentLink } from '@/lib/application-payment-link'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const result = await sendApplicationPaymentLink(id, `staff:${session.displayName}`)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, sentTo: result.sentTo })
}
