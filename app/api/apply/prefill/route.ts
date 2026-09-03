// GET /api/apply/prefill?listingApp=<listing_applications.id>
//
// Applicant-facing (no session) — the /apply wizard's ?listingApp= hand-off
// (components/ApplicationForm.tsx) previously only carried the association
// + unit; the applicant re-typed her own name/email/phone from scratch, and
// re-uploaded/re-signed things already on file from her pre-apply checklist,
// even though staff already had it all (a real gap surfaced showing a
// preview of this flow, 2026-09-03). Returns just enough to prefill and to
// mark those items already-done — never dob/ssn (not collected anywhere in
// application_stakeholders, and too sensitive to hand back from an
// unauthenticated, id-only lookup like this one) or anything else about the
// application's documents/status.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const listingApp = new URL(req.url).searchParams.get('listingApp')
  if (!listingApp) return NextResponse.json({ error: 'listingApp required' }, { status: 400 })

  const [{ data: sh }, { data: la }, { data: doc }, { data: reviewRows }] = await Promise.all([
    supabaseAdmin.from('application_stakeholders')
      .select('name, email, phone').eq('application_id', listingApp).eq('role', 'applicant').eq('is_primary', true).maybeSingle(),
    supabaseAdmin.from('listing_applications').select('rules_ack').eq('id', listingApp).maybeSingle(),
    supabaseAdmin.from('application_documents')
      .select('id').eq('application_id', listingApp).eq('doc_key', 'marriage_cert').limit(1).maybeSingle(),
    supabaseAdmin.from('application_document_reviews')
      .select('decision').eq('application_id', listingApp).eq('scope_key', 'marriage_cert')
      .order('decided_at', { ascending: false }).limit(1),
  ])

  const rulesAck = la?.rules_ack as { name?: string; at?: string } | null
  const marriageCert = doc ? { uploaded: true, approved: reviewRows?.[0]?.decision === 'approved' } : null

  return NextResponse.json({
    name: (sh?.name as string | null) ?? null,
    email: (sh?.email as string | null) ?? null,
    phone: (sh?.phone as string | null) ?? null,
    rulesAck: rulesAck?.name ? { name: rulesAck.name, at: rulesAck.at ?? null } : null,
    marriageCert,
  })
}
