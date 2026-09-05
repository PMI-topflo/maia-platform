// POST /api/admin/pre-apply/[id]/declarations
//   { vehicle?: boolean, animal?: boolean, animalKind?: 'pet'|'service'|'esa'|'unsure', taxReturns?: boolean, stakeholderId?: string }
//
// Staff record the vehicle/animal/tax-returns declaration on behalf of an
// applicant who answered by REPLY rather than through the self-serve link —
// e.g. the standard-reply draft (lib/application-standard-reply.ts) now asks
// "do you have a car?" in plain text before requesting registration, and
// someone has to write the answer down somewhere the rest of MAIA can read.
//
// Vehicle and tax-returns are answered PER STAKEHOLDER (each applicant/buyer
// answers their own) — stakeholderId picks which one; omitted defaults to
// the primary applicant, same as before this existed. Animal stays a single,
// application-level answer, written straight to listing_applications.declarations
// same as app/api/pre-apply/[token]/declare/route.ts.
// Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { getIntakeChecklist, isApplicationType, parseDeclarations, type Declarations } from '@/lib/intake-documents'
import { type AnimalKind } from '@/lib/animal-accommodation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ANIMAL_KINDS: AnimalKind[] = ['pet', 'service', 'esa', 'unsure']

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let b: { vehicle?: unknown; animal?: unknown; animalKind?: unknown; taxReturns?: unknown; stakeholderId?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (typeof b.vehicle !== 'boolean' && typeof b.animal !== 'boolean' && typeof b.taxReturns !== 'boolean') {
    return NextResponse.json({ error: 'nothing to record' }, { status: 400 })
  }

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, application_type, declarations').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const now = new Date().toISOString()
  const next: Declarations = { ...parseDeclarations(app.declarations) }

  if (typeof b.vehicle === 'boolean' || typeof b.taxReturns === 'boolean') {
    let stakeholderId = typeof b.stakeholderId === 'string' ? b.stakeholderId : null
    if (!stakeholderId) {
      const { data: primary } = await supabaseAdmin.from('application_stakeholders')
        .select('id').eq('application_id', id).eq('role', 'applicant').eq('is_primary', true).maybeSingle()
      stakeholderId = primary ? String(primary.id) : null
    }
    if (!stakeholderId) return NextResponse.json({ error: 'No applicant on file to record this against.' }, { status: 400 })

    const update: { vehicle_has?: boolean; vehicle_declared_at?: string; tax_returns_has?: boolean; tax_returns_declared_at?: string } = {}
    if (typeof b.vehicle === 'boolean') { update.vehicle_has = b.vehicle; update.vehicle_declared_at = now }
    if (typeof b.taxReturns === 'boolean') { update.tax_returns_has = b.taxReturns; update.tax_returns_declared_at = now }
    const { error } = await supabaseAdmin.from('application_stakeholders').update(update).eq('id', stakeholderId).eq('application_id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (typeof b.animal === 'boolean') {
    const kind = ANIMAL_KINDS.includes(b.animalKind as AnimalKind) ? b.animalKind as AnimalKind : null
    next.animal = { has: b.animal, kind: b.animal ? kind : null, at: now }
    const { error } = await supabaseAdmin.from('listing_applications')
      .update({ declarations: next, updated_at: now }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const type = String(app.application_type ?? '')
  const checklist = isApplicationType(type) ? await getIntakeChecklist(String(app.association_code), type) : []
  return NextResponse.json({
    ok: true, declarations: next,
    conditionalKeys: checklist.filter(c => c.condition_key).map(c => ({ doc_key: c.doc_key, condition_key: c.condition_key })),
  })
}
