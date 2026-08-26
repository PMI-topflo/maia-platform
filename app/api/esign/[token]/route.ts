// GET/POST /api/esign/[token]
// The login-free association e-sign endpoint (shared engine). GET returns the
// document summary + verification state for the token's role; POST records the
// signature after the verified-signature gate passes. Token is the auth.

import { NextResponse } from 'next/server'
import { verifyEsignToken } from '@/lib/esign-token'
import {
  getEsignDoc, signerOf, roleSigned, recordEsignSignature,
  roleEmail, rolePhone, rolePhoneRequired, roleVerification, setEsignVerification,
} from '@/lib/esign'
import { maskEmail, maskPhone, signatureBlockReason, type SignGeo } from '@/lib/esign-verify'
import { getFormDef, requiredRoles, isFillable } from '@/lib/esign-forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Has the signer already given this form what it exists to collect? Per form,
 *  because "filled" means different things: an animal form needs an animal, an
 *  emergency contact list needs somebody to call. */
function hasBeenFilled(kind: string, payload: Record<string, unknown>): boolean {
  const arr = (k: string) => Array.isArray(payload[k]) ? (payload[k] as unknown[]).length > 0 : false
  if (kind === 'emergency_contact_list') return arr('contacts')
  if (kind === 'military_service_disclosure') return payload.isServiceMember === 'yes' || payload.isServiceMember === 'no'
  return arr('pets')
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyEsignToken(token)
  if (!t) return NextResponse.json({ error: 'This signing link has expired or is invalid.' }, { status: 401 })
  const doc = await getEsignDoc(t.docId)
  if (!doc) return NextResponse.json({ error: 'This document could not be found.' }, { status: 404 })
  const def = getFormDef(doc.kind)
  const me = signerOf(doc, t.role)
  const roles = requiredRoles(doc.kind)

  return NextResponse.json({
    kind: doc.kind,
    formLabel: def?.label ?? doc.kind,
    title: doc.title,
    role: t.role,
    roleLabel: def?.roleLabel(t.role) ?? t.role,
    associationCode: doc.association_code,
    unitRef: doc.unit_ref,
    payload: doc.payload,
    fillable: isFillable(doc.kind),
    // A fillable form still needs the signer's data before signing. What counts
    // as "filled" differs by form: the animal form is filled once it lists an
    // animal, the emergency contact list once it names someone to call.
    needsFill: isFillable(doc.kind) && !hasBeenFilled(doc.kind, doc.payload),
    signerName: me?.name ?? null,
    signerEmailMasked: maskEmail(roleEmail(doc, t.role)),
    signerPhoneMasked: rolePhone(doc, t.role) ? maskPhone(rolePhone(doc, t.role)) : null,
    phoneRequired: rolePhoneRequired(doc, t.role),
    emailVerified: !!roleVerification(doc, t.role)?.emailVerifiedAt,
    phoneVerified: !!roleVerification(doc, t.role)?.phoneVerifiedAt,
    alreadySigned: roleSigned(doc, t.role),
    othersSigned: roles.filter(r => r !== t.role).map(r => ({ role: r, label: def?.roleLabel(r) ?? r, signed: roleSigned(doc, r) })),
    status: doc.status,
    voided: doc.status === 'void',
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyEsignToken(token)
  if (!t) return NextResponse.json({ error: 'This signing link has expired or is invalid.' }, { status: 401 })

  let b: { name?: string; signatureImage?: string; agreed?: boolean; geo?: SignGeo | null }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (!b.agreed) return NextResponse.json({ error: 'Please check the box to consent and sign.' }, { status: 400 })
  const name = String(b.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Please type your full legal name.' }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent') ?? null

  const doc = await getEsignDoc(t.docId)
  if (!doc) return NextResponse.json({ error: 'This document could not be found.' }, { status: 404 })
  const blocked = signatureBlockReason(roleVerification(doc, t.role), rolePhoneRequired(doc, t.role))
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 })

  const geo = (b.geo && typeof b.geo.lat === 'number' && typeof b.geo.lon === 'number')
    ? { lat: b.geo.lat, lon: b.geo.lon, accuracy_meters: typeof b.geo.accuracy_meters === 'number' ? b.geo.accuracy_meters : 0, timestamp_ms: typeof b.geo.timestamp_ms === 'number' ? b.geo.timestamp_ms : Date.now() }
    : { denied: true as const }
  await setEsignVerification(t.docId, t.role, { geo, ip, ua })

  const res = await recordEsignSignature(t.docId, t.role, {
    name, image: (b.signatureImage && b.signatureImage.startsWith('data:image')) ? b.signatureImage : null, ip,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, complete: res.complete })
}
