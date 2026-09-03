// POST /api/admin/pre-apply/[id]/request-screening
// Staff-facing manual trigger for the real Checkr order-creation flow
// (app/api/trigger-screening/route.ts) -- that route is internal-secret
// gated (called automatically by the Stripe webhook once payment clears),
// with no staff-session-authenticated way to fire it by hand. Real gap:
// MANXI 912 (Querline Pinckney) sat with "Missing required: Background /
// Credit Reports" and no order on file, with no way for staff to start one
// without waiting on -- or debugging -- the automatic path. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveScreeningProvider } from '@/lib/preapply'
import { logOutboundCommunication } from '@/lib/application-comm-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label, detailed_application_id, screening_provider').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const detailedId = app.detailed_application_id as string | null
  if (!detailedId) {
    // reason: 'payment_pending' lets the UI offer "send her the payment
    // link" instead of a dead-end error -- staff report, 2026-09-03 (MANXI
    // 912): payment was never in her workflow because Checkr wasn't her
    // provider when she went through her own pre-apply checklist, so she
    // was never shown app/pre-apply/[code]/page.tsx's ScreeningPaymentGate.
    return NextResponse.json({ error: 'Payment hasn’t been completed yet — Checkr screening starts automatically once the applicant pays. Nothing to request until then.', reason: 'payment_pending' }, { status: 400 })
  }

  // The application's OWN snapshotted provider (set at creation), not
  // associations.screening_provider live — an application already in
  // flight when the association flips to Checkr stays on whatever it
  // started under. See lib/preapply.ts's resolveScreeningProvider.
  if (resolveScreeningProvider(app.screening_provider as string | null) !== 'maia_checkr') {
    return NextResponse.json({ error: 'This application started on Tenant Evaluation, not Checkr — it keeps that provider even if the association has since switched. Use the Rentvine fallback or upload the report directly instead.' }, { status: 400 })
  }

  // Same call the Stripe webhook itself makes on payment (see
  // app/api/webhooks/stripe/route.ts) — reused as-is rather than
  // duplicating trigger-screening's order-creation logic here.
  let j: { ok?: boolean; error?: string; subjects?: number; succeeded?: number; failed?: number; errors?: string[] }
  try {
    const r = await fetch(`${APP}/api/trigger-screening`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_API_SECRET || '' },
      body: JSON.stringify({ applicationId: detailedId }),
    })
    j = await r.json()
    if (!r.ok) return NextResponse.json({ error: j.error || 'Checkr order creation failed.' }, { status: r.status })
  } catch (err) {
    return NextResponse.json({ error: `Could not reach the screening service: ${(err as Error).message}` }, { status: 502 })
  }

  // Staff report, 2026-09-03 (MANXI 912 again): this ran but left no trace
  // anywhere staff could see it happened, or when -- same gap the Rentvine
  // fallback and declaration-reminder sends were already fixed for.
  await logOutboundCommunication({
    applicationId: id, associationCode: String(app.association_code), unitLabel: (app.unit_label as string | null) ?? null,
    subject: 'Requested background check via Checkr',
    body: `Requested ${j.succeeded ?? 0}/${j.subjects ?? 0} Checkr order${j.subjects === 1 ? '' : 's'}.${j.failed ? ` ${j.failed} failed.` : ''}${j.errors?.length ? ` ${j.errors.join(' · ')}` : ''}`,
    loggedBy: `staff:${session.displayName}`,
  })

  return NextResponse.json(j)
}
