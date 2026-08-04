// GET /api/admin/pre-apply  → the Pre-Application audit queue: submitted intakes
// with applicant, unit, type, and document count. Staff-only. (Slice 3 adds the
// per-application audit + dual-approval actions.)

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: apps } = await supabaseAdmin.from('listing_applications')
    .select('id, association_code, application_type, unit_label, status, submitted_at, rules_ack')
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false })
    .limit(200)

  const ids = (apps ?? []).map(a => a.id)
  const [{ data: sh }, { data: docs }] = await Promise.all([
    ids.length ? supabaseAdmin.from('application_stakeholders').select('application_id, name, email').eq('role', 'applicant').in('application_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? supabaseAdmin.from('application_documents').select('application_id').in('application_id', ids) : Promise.resolve({ data: [] }),
  ])
  const nameByApp = new Map((sh ?? []).map(s => [s.application_id, { name: s.name as string | null, email: s.email as string | null }]))
  const docCount = new Map<string, number>()
  for (const d of docs ?? []) docCount.set(d.application_id as string, (docCount.get(d.application_id as string) ?? 0) + 1)

  return NextResponse.json({
    applications: (apps ?? []).map(a => ({
      id: a.id, associationCode: a.association_code, type: a.application_type, unit: a.unit_label,
      status: a.status, submittedAt: a.submitted_at,
      applicant: nameByApp.get(a.id) ?? null, docCount: docCount.get(a.id) ?? 0,
      signed: !!(a.rules_ack as { name?: string } | null)?.name,
    })),
  })
}
