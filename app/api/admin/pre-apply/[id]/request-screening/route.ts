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

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, detailed_application_id, screening_provider').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const detailedId = app.detailed_application_id as string | null
  if (!detailedId) {
    return NextResponse.json({ error: 'Payment hasn’t been completed yet — Checkr screening starts automatically once the applicant pays. Nothing to request until then.' }, { status: 400 })
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

  return NextResponse.json(j)
}
