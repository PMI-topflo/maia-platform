// POST /api/pre-apply/[token]/declare   { vehicle?: boolean, animal?: boolean, animalKind?: 'pet'|'service'|'esa', usTaxReturns?: boolean }
//
// The applicant answers the yes/no gates themselves. Before this existed, the
// vehicle and pet items were unconditionally required, so an applicant with no
// car could never complete their application — only staff could clear it by
// hand. Token auth: the person holding the link answers for the application.
//
// Answering "no" retires the matching documents. Answering "yes" to an animal
// also asks WHAT KIND, because a service animal and an emotional support
// animal have different documentation rules from each other and from a pet,
// and an association that permits no pets must still consider a reasonable
// accommodation for either. See lib/animal-accommodation.ts.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getIntake, resolveToken } from '@/lib/preapply'
import { getIntakeChecklist, parseDeclarations, stakeholderVehicleAnswer, stakeholderTaxReturnsAnswer, type Declarations } from '@/lib/intake-documents'
import { type AnimalKind } from '@/lib/animal-accommodation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ANIMAL_KINDS: AnimalKind[] = ['pet', 'service', 'esa', 'unsure']

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await resolveToken(token)
  if (!r) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const intake = await getIntake(r.applicationId)
  if (!intake) return NextResponse.json({ error: 'This application could not be found.' }, { status: 404 })
  if (intake.submittedAt) return NextResponse.json({ error: 'This application has already been submitted.' }, { status: 400 })

  let b: { vehicle?: unknown; animal?: unknown; animalKind?: unknown; usTaxReturns?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (typeof b.vehicle !== 'boolean' && typeof b.animal !== 'boolean' && typeof b.usTaxReturns !== 'boolean') {
    return NextResponse.json({ error: 'nothing to record' }, { status: 400 })
  }

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('declarations').eq('id', r.applicationId).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const now = new Date().toISOString()
  const sharedDeclarations = parseDeclarations(app.declarations)
  const next: Declarations = { ...sharedDeclarations }

  // Vehicle and tax-returns are answered PER STAKEHOLDER now (each
  // applicant/buyer answers their own) — written to this stakeholder's own
  // row, never the shared application-level column. Animal stays a single,
  // application-level answer.
  const me = r.stakeholder
  const stakeholderUpdate: { vehicle_has?: boolean; vehicle_declared_at?: string; tax_returns_has?: boolean; tax_returns_declared_at?: string } = {}
  if (typeof b.vehicle === 'boolean') { stakeholderUpdate.vehicle_has = b.vehicle; stakeholderUpdate.vehicle_declared_at = now }
  if (typeof b.usTaxReturns === 'boolean') { stakeholderUpdate.tax_returns_has = b.usTaxReturns; stakeholderUpdate.tax_returns_declared_at = now }
  if (Object.keys(stakeholderUpdate).length) {
    const { error } = await supabaseAdmin.from('application_stakeholders').update(stakeholderUpdate).eq('id', me.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (typeof b.animal === 'boolean') {
    const kind = ANIMAL_KINDS.includes(b.animalKind as AnimalKind) ? b.animalKind as AnimalKind : null
    // "Yes" without a kind is incomplete, not an error — the UI asks the kind
    // as a second step, and until it is answered BOTH animal paths stay open
    // rather than MAIA guessing which one the applicant meant.
    next.animal = { has: b.animal, kind: b.animal ? kind : null, at: now }
    const { error } = await supabaseAdmin.from('listing_applications')
      .update({ declarations: next, updated_at: now }).eq('id', r.applicationId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Echo back THIS stakeholder's own view (vehicle/taxReturns just written,
  // or their existing answer if this call only touched animal) plus which
  // conditional items are now live, so the page can re-render without a
  // second round trip.
  const myVehicle = typeof b.vehicle === 'boolean' ? { has: b.vehicle, at: now } : stakeholderVehicleAnswer({ id: me.id, is_primary: me.isPrimary, vehicle_has: me.vehicleHas, vehicle_declared_at: me.vehicleDeclaredAt }, sharedDeclarations)
  const myTaxReturns = typeof b.usTaxReturns === 'boolean' ? { has: b.usTaxReturns, at: now } : stakeholderTaxReturnsAnswer({ id: me.id, is_primary: me.isPrimary, tax_returns_has: me.taxReturnsHas, tax_returns_declared_at: me.taxReturnsDeclaredAt }, sharedDeclarations)
  const myDeclarations: Declarations = { ...next, vehicle: myVehicle, taxReturns: myTaxReturns }

  const checklist = await getIntakeChecklist(intake.associationCode, intake.type)
  return NextResponse.json({
    ok: true,
    declarations: myDeclarations,
    conditionalKeys: checklist.filter(c => c.condition_key).map(c => ({ doc_key: c.doc_key, condition_key: c.condition_key })),
  })
}
