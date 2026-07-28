// POST /api/units/documents/[id]/review  { decision: 'approve'|'reject', note? }
// Staff/board approve or reject a pending manager upload. Approve files it
// into compliance_records (so the unit's audit status updates); reject
// records the reason. Only board + staff may review.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'

export const dynamic = 'force-dynamic'

// NOTE: compliance_records.status is constrained to
// current|expiring|pending|missing|non_compliant|na — 'expired' is NOT a
// valid value (writing it errored the upsert). An already-expired or
// soon-expiring doc is stored as 'expiring'; the true expired-vs-expiring
// distinction is derived from expiry_date at read time (lib/association-audit).
function statusFromExpiry(exp: string | null): string {
  if (!exp) return 'current'
  const d = new Date(exp), now = new Date()
  if (d < now) return 'expiring'
  return (d.getTime() - now.getTime()) / 86_400_000 <= 45 ? 'expiring' : 'current'
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  let body: { decision?: string; note?: string; assoc?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const auth = await resolveUnitsAuth(body.assoc ?? null)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.canReview) return NextResponse.json({ error: 'only board or staff may approve' }, { status: 403 })

  const decision = body.decision === 'approve' ? 'approve' : body.decision === 'reject' ? 'reject' : null
  if (!decision) return NextResponse.json({ error: 'decision must be approve or reject' }, { status: 400 })

  const { data: sub } = await supabaseAdmin.from('unit_document_submissions')
    .select('id, association_code, unit_ref, item_key, scope, storage_key, ai_expiration_date, status').eq('id', id).maybeSingle()
  if (!sub) return NextResponse.json({ error: 'submission not found' }, { status: 404 })
  if (sub.association_code !== auth.assoc) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (sub.status !== 'pending') return NextResponse.json({ error: `already ${sub.status}` }, { status: 409 })

  const reviewer = `${auth.persona}:${auth.name}`

  if (decision === 'approve') {
    const { error: cErr } = await supabaseAdmin.from('compliance_records').upsert({
      scope:            sub.scope,
      association_code: auth.assoc,
      unit_ref:         sub.unit_ref,
      item_key:         sub.item_key,
      applicable:       true,
      status:           statusFromExpiry(sub.ai_expiration_date as string | null),
      expiry_date:      sub.ai_expiration_date,
      source_path:      sub.storage_key,
      updated_by:       reviewer,
    }, { onConflict: 'scope,association_code,unit_ref,item_key' })
    if (cErr) return NextResponse.json({ error: `could not file compliance record: ${cErr.message}` }, { status: 500 })
  }

  const { error: uErr } = await supabaseAdmin.from('unit_document_submissions').update({
    status:      decision === 'approve' ? 'approved' : 'rejected',
    reviewed_by: reviewer,
    reviewed_at: new Date().toISOString(),
    review_note: body.note ?? null,
  }).eq('id', id)
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, status: decision === 'approve' ? 'approved' : 'rejected' })
}
