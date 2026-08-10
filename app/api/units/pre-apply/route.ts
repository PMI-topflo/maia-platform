// GET /api/units/pre-apply?assoc=CODE
// The submitted Pre-Application intakes for a board member's / on-site manager's
// association, for them to review + approve (the dual-approval stage). Scoped to
// the caller's association by resolveUnitsAuth.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { getIntakeChecklistAll, APPLICATION_TYPES, signTemplateUrls } from '@/lib/intake-documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await resolveUnitsAuth(new URL(req.url).searchParams.get('assoc'))
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: apps } = await supabaseAdmin.from('listing_applications')
    .select('id, application_type, unit_label, status, submitted_at, audited_at, reviewed_at, approved_by_role')
    .eq('association_code', auth.assoc).not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false }).limit(200)

  const ids = (apps ?? []).map(a => a.id)
  const [{ data: sh }, { data: docs }] = await Promise.all([
    ids.length ? supabaseAdmin.from('application_stakeholders').select('application_id, name').eq('role', 'applicant').in('application_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? supabaseAdmin.from('application_documents').select('application_id').in('application_id', ids) : Promise.resolve({ data: [] }),
  ])
  const nameBy = new Map((sh ?? []).map(s => [s.application_id, s.name as string | null]))
  const docCount = new Map<string, number>()
  for (const d of docs ?? []) docCount.set(d.application_id as string, (docCount.get(d.application_id as string) ?? 0) + 1)

  // The required-documents reference, per application type, for this association.
  // Items with a template get a signed link so reviewers can preview the example form.
  const all = await getIntakeChecklistAll(auth.assoc)
  const exampleUrls = await signTemplateUrls(Object.values(all).flat())
  const checklists = APPLICATION_TYPES.map(t => ({
    type: t.key, label: t.label, blurb: t.blurb,
    items: (all[t.key] ?? []).map(d => ({ label: d.label, provided_by: d.provided_by, required: d.required, notarized: d.requires_notarization, exampleUrl: d.template_path ? exampleUrls.get(d.template_path) ?? null : null })),
  })).filter(t => t.items.length > 0)

  return NextResponse.json({
    checklists,
    canApprove: auth.persona === 'board' || auth.persona === 'building_manager' || auth.persona === 'staff',
    approverRole: auth.persona === 'board' ? 'board' : auth.persona === 'building_manager' ? 'onsite_manager' : 'staff',
    applications: (apps ?? []).map(a => ({
      id: a.id, type: a.application_type, unit: a.unit_label, status: a.status,
      submittedAt: a.submitted_at, audited: !!a.audited_at, decided: !!a.reviewed_at, approvedByRole: a.approved_by_role,
      applicant: nameBy.get(a.id) ?? null, docCount: docCount.get(a.id) ?? 0,
    })),
  })
}
