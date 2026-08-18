// POST /api/request/[token]/declare   { vehicle?: boolean } | { animal?: boolean, animalKind?: string }
//
// The vehicle/animal yes-or-no, answered on the SAME secure link already
// sent — not by replying to an email that a human then has to read and
// transcribe. User direction, 2026-08-18: "why is he replying to the
// questions by email? ... why the card link don't make these questions and
// save in Maia?" This is the fix — a real control, on the real link,
// writing directly into declarations. The email now only points here.
//
// Mirrors app/api/pre-apply/[token]/declare/route.ts's write (same
// Declarations shape, same column) but resolves via the REQUEST token
// (document_requests / loadRequest), not the original intake token — this
// link was sent by the standard-reply feature, days or weeks after the
// applicant's own intake link, and does not carry that token.
//
// Answering "yes" does more than write the flag: it re-reads the live
// checklist (getReviewState — the same single source of truth every other
// screen reads) and, for whatever just became newly relevant, either APPENDS
// the upload item to THIS SAME request row (so it shows up on the page the
// applicant is already looking at, no new link needed) or sends the
// esign-backed form immediately (Pet Registration), exactly as every other
// path in this codebase already sends it — never a second, different way.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadRequest } from '../route'
import { getReviewState } from '@/lib/board-review'
import { isEsignItem, sendEsignFormsForItems } from '@/lib/application-esign-forms'
import { getIntakeChecklist, isApplicationType, parseDeclarations, pendingDeclarations, providedByOkForRole, type Declarations } from '@/lib/intake-documents'
import { type AnimalKind } from '@/lib/animal-accommodation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ANIMAL_KINDS: AnimalKind[] = ['pet', 'service', 'esa', 'unsure']
const DECLARE_KEYS = new Set(['__declare_vehicle__', '__declare_animal__'])

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await loadRequest(token)
  if (!r) return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 401 })

  let b: { vehicle?: unknown; animal?: unknown; animalKind?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const appId = String(r.req.application_id)
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label, application_type, declarations').eq('id', appId).maybeSingle()
  if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 })

  const now = new Date().toISOString()
  const next: Declarations = { ...parseDeclarations(app.declarations) }
  if (typeof b.vehicle === 'boolean') next.vehicle = { has: b.vehicle, at: now }
  if (typeof b.animal === 'boolean') {
    const kind = ANIMAL_KINDS.includes(b.animalKind as AnimalKind) ? b.animalKind as AnimalKind : null
    next.animal = { has: b.animal, kind: b.animal ? kind : null, at: now }
  }
  if (!('vehicle' in next) && !('animal' in next)) return NextResponse.json({ error: 'nothing to record' }, { status: 400 })

  const { error } = await supabaseAdmin.from('listing_applications').update({ declarations: next, updated_at: now }).eq('id', appId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // What's newly relevant, straight from the single source of truth — never
  // re-derived by hand here, so this can never disagree with what the
  // checklist itself says applies once "yes" is on file.
  //
  // Two guards, both required — an earlier version of this route had
  // neither and, live-verified against MANXI 613, dumped the WHOLE
  // outstanding checklist onto the applicant's page the moment they answered
  // one question:
  //   1. condition_key must be set at all — this route only ever surfaces
  //      items a DECLARATION unlocks (car_registration, pet_registration,
  //      assistance_animal_documentation). A plain checklist item
  //      (drivers_license, board_approval_letter) isn't this route's call to
  //      add; that's draftStandardReply's or the admin Request panel's job.
  //   2. providedByOkForRole — background_credit has no condition_key so
  //      guard 1 alone already excludes it, but this stays as the same
  //      defense-in-depth every other surface uses, in case a future
  //      staff-only item is ever declaration-gated too.
  //   3. still gated by the OTHER, still-unanswered declaration (e.g.
  //      answering "yes" to vehicle must not surface
  //      assistance_animal_documentation while the animal question is
  //      untouched) stays excluded.
  const state = await getReviewState(appId)
  const type = String(app.application_type ?? '')
  const checklist = isApplicationType(type) ? await getIntakeChecklist(String(app.association_code), type) : []
  const pendingAfter = pendingDeclarations(checklist, next)
  const docKeyCondition = new Map(checklist.map(c => [c.doc_key, c.condition_key]))
  const stillGated = (docKey: string): boolean => {
    const ck = docKeyCondition.get(docKey)
    if (ck === 'vehicle') return pendingAfter.includes('vehicle')
    if (ck === 'pet' || ck === 'assistance_animal') return pendingAfter.includes('animal')
    return false
  }

  // state.rows has one row PER APPLICANT for a per-applicant item (that's
  // how "Car Registration — Mark" and "Car Registration — Kimberly" are two
  // rows on the staff checklist) — but this link, like draftStandardReply,
  // can only ever request one, undifferentiated "Car Registration" upload;
  // /api/request/[token]/upload has no way to route an upload to a specific
  // applicant. Deduping by doc_key here avoids appending the same item
  // twice (which duplicated the React key and rendered two identical rows).
  const already = new Set(r.mine.map(i => i.doc_key))
  const relevant = state
    ? state.rows.filter(row =>
        row.state === 'waiting' && !already.has(row.docKey) && !DECLARE_KEYS.has(row.docKey) &&
        !!docKeyCondition.get(row.docKey) && providedByOkForRole(r.role, row.providedBy) && !stillGated(row.docKey))
    : []
  const relevantDocKeys = [...new Set(relevant.map(row => row.docKey))]

  const sentForms: string[] = []
  const newUploadItems: { doc_key: string; label: string; recipient: 'owner' | 'tenant' }[] = []
  for (const docKey of relevantDocKeys) {
    const row = relevant.find(x => x.docKey === docKey)!
    if (isEsignItem(docKey)) {
      const result = await sendEsignFormsForItems(appId, [docKey], `token:request/${token}`)
      if (result.sent.length) sentForms.push(docKey)
    } else {
      newUploadItems.push({ doc_key: docKey, label: row.label, recipient: r.role })
    }
  }

  if (newUploadItems.length) {
    const items = (Array.isArray(r.req.items) ? r.req.items : []) as unknown[]
    await supabaseAdmin.from('document_requests').update({ items: [...items, ...newUploadItems] }).eq('id', r.req.id)
  }

  return NextResponse.json({ ok: true, declarations: next, newUploadItems: newUploadItems.map(i => i.label), sentForms })
}
