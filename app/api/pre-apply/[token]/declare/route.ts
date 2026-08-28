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
import { getIntakeChecklist, parseDeclarations, type Declarations } from '@/lib/intake-documents'
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

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('declarations').eq('id', r.applicationId).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const now = new Date().toISOString()
  const next: Declarations = { ...parseDeclarations(app.declarations) }

  if (typeof b.vehicle === 'boolean') next.vehicle = { has: b.vehicle, at: now }
  if (typeof b.usTaxReturns === 'boolean') next.taxReturns = { has: b.usTaxReturns, at: now }

  if (typeof b.animal === 'boolean') {
    const kind = ANIMAL_KINDS.includes(b.animalKind as AnimalKind) ? b.animalKind as AnimalKind : null
    // "Yes" without a kind is incomplete, not an error — the UI asks the kind
    // as a second step, and until it is answered BOTH animal paths stay open
    // rather than MAIA guessing which one the applicant meant.
    next.animal = { has: b.animal, kind: b.animal ? kind : null, at: now }
  }

  const { error } = await supabaseAdmin.from('listing_applications')
    .update({ declarations: next, updated_at: now }).eq('id', r.applicationId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Echo back which conditional items are now live so the page can re-render
  // without a second round trip.
  const checklist = await getIntakeChecklist(intake.associationCode, intake.type)
  return NextResponse.json({
    ok: true,
    declarations: next,
    conditionalKeys: checklist.filter(c => c.condition_key).map(c => ({ doc_key: c.doc_key, condition_key: c.condition_key })),
  })
}
