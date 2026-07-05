// =====================================================================
// GET /api/apply/by-session/[sessionId]   (public — no session)
// The /apply/success page only has the Stripe checkout session_id in its
// URL (Stripe's {CHECKOUT_SESSION_ID} placeholder), not the application's
// own id. Resolves it once the Stripe webhook has processed (candidate
// creation runs async right after payment, so this can 404 briefly —
// the success page polls). Public by design, same convention as the rest
// of the token-free /apply pipeline (knowing the opaque session id is the
// access control, same as knowing an application id elsewhere in /apply).
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await ctx.params
  const { data: app } = await supabaseAdmin.from('applications')
    .select('id, screening_status').eq('stripe_session_id', sessionId).maybeSingle()
  if (!app) return NextResponse.json({ ready: false }, { status: 404 })

  const { data: subjects } = await supabaseAdmin.from('screening_subjects')
    .select('id, name, status, checkr_candidate_id').eq('application_id', app.id).order('subject_index')

  return NextResponse.json({
    ready: true, applicationId: app.id, screeningStatus: app.screening_status,
    subjects: (subjects ?? []).map(s => ({ id: s.id, name: s.name, status: s.status, candidateId: s.checkr_candidate_id })),
  })
}
