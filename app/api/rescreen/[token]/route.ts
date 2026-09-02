// GET  /api/rescreen/[token]  — the page's data: unit/association + status.
// POST /api/rescreen/[token]  — create the Stripe Checkout session for the
//   flat $150 re-screening charge (docs/ROADMAP.md's "Re-screening charge"
//   section) and return its redirect URL. token is the entire auth for this
//   route — same pattern as /api/lease-renewal/[token].

import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' })
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

async function loadContext(token: string) {
  const { data: payment } = await supabaseAdmin.from('rescreening_payments')
    .select('id, listing_application_id, status, paid_at').eq('token', token).maybeSingle()
  if (!payment) return null
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label').eq('id', payment.listing_application_id).maybeSingle()
  const { data: assoc } = app
    ? await supabaseAdmin.from('associations').select('association_name').eq('association_code', app.association_code as string).maybeSingle()
    : { data: null }
  return {
    payment, unit: (app?.unit_label as string | null) ?? '—',
    assoc: (assoc?.association_name as string | null) ?? (app?.association_code as string | null) ?? '—',
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const found = await loadContext(token)
  if (!found) return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 404 })
  return NextResponse.json({
    status: found.payment.status, paidAt: found.payment.paid_at,
    unit: found.unit, association: found.assoc,
  })
}

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const found = await loadContext(token)
  if (!found) return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 404 })
  if (found.payment.status === 'paid') return NextResponse.json({ error: 'This has already been paid.' }, { status: 400 })

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRICE_RESCREENING!, quantity: 1 }],
      metadata: { purpose: 'rescreening', rescreeningPaymentId: found.payment.id, listingApplicationId: found.payment.listing_application_id },
      success_url: `${APP}/rescreen/${token}?paid=1`,
      cancel_url: `${APP}/rescreen/${token}`,
    })
    await supabaseAdmin.from('rescreening_payments').update({ stripe_session_id: session.id }).eq('id', found.payment.id)
    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[rescreen checkout]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
