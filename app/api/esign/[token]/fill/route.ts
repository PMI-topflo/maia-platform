// POST /api/esign/[token]/fill   { pets?, vetName?, vetPhone? }
// The applicant fills a fillable e-sign form (pet registration) before signing.
// Saves the provided fields into the document payload. Token is the auth; the
// form must be fillable and not yet signed. Pet count is capped at the
// association's pet_limit (snapshotted on the doc at creation).

import { NextResponse } from 'next/server'
import { verifyEsignToken } from '@/lib/esign-token'
import { getEsignDoc, roleSigned, mergeEsignPayload } from '@/lib/esign'
import { isFillable, type Pet, type PetPayload } from '@/lib/esign-forms'

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

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyEsignToken(token)
  if (!t) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const doc = await getEsignDoc(t.docId)
  if (!doc) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (!isFillable(doc.kind)) return NextResponse.json({ error: 'This form is not fillable.' }, { status: 400 })
  if (doc.status === 'void' || roleSigned(doc, t.role)) return NextResponse.json({ error: 'This document can no longer be edited.' }, { status: 400 })

  let body: { pets?: unknown[]; vetName?: unknown; vetPhone?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const limit = Math.max(1, (doc.payload as PetPayload).petLimit ?? 2)
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

  if (pets.length === 0) return NextResponse.json({ error: 'Please add at least one pet.' }, { status: 400 })

  await mergeEsignPayload(t.docId, { pets, vetName: str(body.vetName), vetPhone: str(body.vetPhone) })
  return NextResponse.json({ ok: true, savedPets: pets.length })
}
