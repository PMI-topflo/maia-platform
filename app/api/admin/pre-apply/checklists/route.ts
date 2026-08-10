// GET /api/admin/pre-apply/checklists?assoc=CODE
// The Pre-Application Compliance required-documents reference, per application
// type, for one association. Drives the "Required documents" panel on the staff
// Applications command center. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getIntakeChecklistAll, APPLICATION_TYPES, signTemplateUrls } from '@/lib/intake-documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const assoc = (new URL(req.url).searchParams.get('assoc') ?? '').trim().toUpperCase()
  if (!assoc) return NextResponse.json({ error: 'assoc required' }, { status: 400 })

  const all = await getIntakeChecklistAll(assoc)
  const exampleUrls = await signTemplateUrls(Object.values(all).flat())
  const checklists = APPLICATION_TYPES.map(t => ({
    type: t.key, label: t.label, blurb: t.blurb,
    items: (all[t.key] ?? []).map(d => ({ label: d.label, provided_by: d.provided_by, required: d.required, notarized: d.requires_notarization, exampleUrl: d.template_path ? exampleUrls.get(d.template_path) ?? null : null })),
  })).filter(t => t.items.length > 0)

  return NextResponse.json({ assoc, checklists })
}
