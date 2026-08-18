// POST /api/admin/pre-apply/[id]/declarations   { vehicle?: boolean, animal?: boolean, animalKind?: 'pet'|'service'|'esa'|'unsure' }
//
// Staff record the vehicle/animal declaration on behalf of an applicant who
// answered by REPLY rather than through the self-serve link — e.g. the
// standard-reply draft (lib/application-standard-reply.ts) now asks "do you
// have a car?" in plain text before requesting registration, and someone
// has to write the answer down somewhere the rest of MAIA can read.
//
// Mirrors app/api/pre-apply/[token]/declare/route.ts exactly — same
// Declarations shape, same table — just staff-session-authed instead of
// token-authed, because the applicant answered by email, not by clicking a link.
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

  let b: { vehicle?: unknown; animal?: unknown; animalKind?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, application_type, declarations').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const now = new Date().toISOString()
  const next: Declarations = { ...parseDeclarations(app.declarations) }

  if (typeof b.vehicle === 'boolean') next.vehicle = { has: b.vehicle, at: now }
  if (typeof b.animal === 'boolean') {
    const kind = ANIMAL_KINDS.includes(b.animalKind as AnimalKind) ? b.animalKind as AnimalKind : null
    next.animal = { has: b.animal, kind: b.animal ? kind : null, at: now }
  }
  if (!('vehicle' in next) && !('animal' in next)) return NextResponse.json({ error: 'nothing to record' }, { status: 400 })

  const { error } = await supabaseAdmin.from('listing_applications')
    .update({ declarations: next, updated_at: now }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const type = String(app.application_type ?? '')
  const checklist = isApplicationType(type) ? await getIntakeChecklist(String(app.association_code), type) : []
  return NextResponse.json({
    ok: true, declarations: next,
    conditionalKeys: checklist.filter(c => c.condition_key).map(c => ({ doc_key: c.doc_key, condition_key: c.condition_key })),
  })
}
