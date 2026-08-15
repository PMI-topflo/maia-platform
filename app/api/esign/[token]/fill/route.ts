// POST /api/esign/[token]/fill   { pets?, vetName?, vetPhone?, questionnaire? }
// The applicant fills a fillable e-sign form (the Animal Information &
// Reasonable Accommodation Questionnaire) before signing. Saves the provided
// fields into the document payload. Token is the auth; the form must be
// fillable and not yet signed.
//
// TWO RULES ENFORCED HERE RATHER THAN IN THE UI:
//  1. The questionnaire is whitelisted field by field. There is no field for a
//     diagnosis, a condition, its severity, or medical records, so none can be
//     persisted even if a client posts one.
//  2. The certification text is DERIVED from the answers server-side, never
//     taken from the client — it is the binding attestation the applicant
//     signs, and a pet certification must never end up on an approved
//     assistance-animal request (or vice versa).

import { NextResponse } from 'next/server'
import { verifyEsignToken } from '@/lib/esign-token'
import { getEsignDoc, roleSigned, mergeEsignPayload } from '@/lib/esign'
import { isFillable, type Pet, type PetPayload } from '@/lib/esign-forms'
import {
  certificationFor, effectiveBranch, missingAnswers,
  type AnimalQuestionnaire, type AnimalRequestType, type YesNo, type Tri,
} from '@/lib/animal-questionnaire'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : '')
const fileRef = (v: unknown): { path: string; filename: string } | null => {
  if (v && typeof v === 'object' && typeof (v as { path?: unknown }).path === 'string') {
    const o = v as { path: string; filename?: string }
    return o.path.startsWith('esign/') ? { path: o.path, filename: str(o.filename) } : null
  }
  return null
}

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : undefined
const YN = ['yes', 'no'] as const
const TRI = ['yes', 'no', 'unsure'] as const

/** Whitelist the questionnaire. Anything not named here is discarded — that is
 *  the structural guarantee that MAIA cannot store a diagnosis. */
function cleanQuestionnaire(raw: unknown): AnimalQuestionnaire | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const q = raw as Record<string, Record<string, unknown> | undefined>
  const requestType = pick<AnimalRequestType>((q as Record<string, unknown>).requestType, ['pet', 'service', 'esa', 'unsure'] as const)
  if (!requestType) return undefined
  const sv = q.service ?? {}, e = q.esa ?? {}
  const prov = (e.provider ?? {}) as Record<string, unknown>
  const oos = (e.outOfState ?? {}) as Record<string, unknown>
  const out: AnimalQuestionnaire = {
    requestType,
    petVaccinated: pick<YesNo>((q as Record<string, unknown>).petVaccinated, YN),
    service: {
      isDog: pick<YesNo>(sv.isDog, YN),
      taskApparent: pick<YesNo>(sv.taskApparent, YN),
      requiredForDisability: pick<YesNo>(sv.requiredForDisability, YN),
      // The work or task ONLY. Length-capped like every other free-text field.
      taskDescription: typeof sv.taskDescription === 'string' ? sv.taskDescription.slice(0, 1000) : undefined,
      vaccinatedAndLicensed: pick<YesNo>(sv.vaccinatedAndLicensed, YN),
    },
    esa: {
      requestingAccommodation: pick<YesNo>(e.requestingAccommodation, YN),
      disabilityApparent: pick(e.disabilityApparent, ['yes', 'no', 'defer'] as const),
      needApparent: pick<Tri>(e.needApparent, TRI),
      animalCount: Math.min(20, Math.max(1, Number(e.animalCount) || 1)),
      documentation: pick(e.documentation, ['attached', 'separate', 'none', 'unnecessary'] as const),
      documentationFiles: (Array.isArray(e.documentationFiles) ? e.documentationFiles : [])
        .slice(0, 10).map(fileRef).filter((f): f is { path: string; filename: string } => !!f),
      provider: {
        name: str(prov.name), title: str(prov.title), licenseNumber: str(prov.licenseNumber),
        licenseState: str(prov.licenseState), contact: str(prov.contact),
      },
      onlineRegistryOnly: pick(e.onlineRegistryOnly, ['yes', 'no', 'na'] as const),
      outOfState: {
        licenseState: str(oos.licenseState),
        hasTreatedYou: pick<YesNo>(oos.hasTreatedYou, YN),
        inPersonAtLeastOnce: pick(oos.inPersonAtLeastOnce, ['yes', 'no', 'na'] as const),
      },
      vaccinatedAndLicensed: pick<YesNo>(e.vaccinatedAndLicensed, YN),
    },
  }
  return out
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyEsignToken(token)
  if (!t) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const doc = await getEsignDoc(t.docId)
  if (!doc) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (!isFillable(doc.kind)) return NextResponse.json({ error: 'This form is not fillable.' }, { status: 400 })
  if (doc.status === 'void' || roleSigned(doc, t.role)) return NextResponse.json({ error: 'This document can no longer be edited.' }, { status: 400 })

  let body: { pets?: unknown[]; vetName?: unknown; vetPhone?: unknown; questionnaire?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const questionnaire = cleanQuestionnaire(body.questionnaire)
  const branch = effectiveBranch(questionnaire)
  // The association's pet limit caps PETS. It must not cap assistance animals:
  // the number of those is governed by disability-related need, not by a
  // house rule, and silently truncating the list would drop an animal the
  // applicant is asking to be accommodated.
  const petLimit = Math.max(1, (doc.payload as PetPayload).petLimit ?? 2)
  const limit = (branch === 'service' || branch === 'esa')
    ? Math.max(petLimit, questionnaire?.esa?.animalCount ?? 1, 1)
    : petLimit
  const rawPets = Array.isArray(body.pets) ? body.pets : []
  const pets: Pet[] = rawPets.slice(0, limit).map((r) => {
    const p = (r ?? {}) as Record<string, unknown>
    return {
      type: str(p.type), name: str(p.name), breed: str(p.breed), color: str(p.color),
      weight: str(p.weight), age: str(p.age), sex: str(p.sex), altered: !!p.altered,
      license: str(p.license), rabiesDate: str(p.rabiesDate),
      serviceAnimal: !!p.serviceAnimal, vaccinationDoc: fileRef(p.vaccinationDoc), photo: fileRef(p.photo),
    }
  }).filter(p => (p.name ?? '').trim() || (p.type ?? '').trim())

  // "Not sure" is a legitimate stopping point — the applicant is telling us
  // they don't know which category applies, and management follows up. Every
  // other branch describes an actual animal.
  if (pets.length === 0 && branch !== 'unsure') {
    return NextResponse.json({ error: 'Please add at least one animal.' }, { status: 400 })
  }

  // Same completeness rule the form applies, enforced here so it cannot be
  // skipped by posting directly: an answer of "yes, vaccinated and licensed"
  // must come with the record, and a pet must carry a photo.
  if (questionnaire) {
    const gaps = missingAnswers(questionnaire, pets)
    if (gaps.length) return NextResponse.json({ error: `Still needed: ${gaps.join('; ')}` }, { status: 400 })
  }

  await mergeEsignPayload(t.docId, {
    pets, vetName: str(body.vetName), vetPhone: str(body.vetPhone),
    ...(questionnaire ? { questionnaire, rulesAck: certificationFor(questionnaire) } : {}),
  })
  return NextResponse.json({ ok: true, savedPets: pets.length, branch })
}
