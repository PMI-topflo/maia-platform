// GET/POST /api/lease-packet/[token]
// The login-free lease-packet e-signature endpoint. GET returns the packet
// summary for the token's role (owner | tenant). POST records that role's
// electronic signature (typed name + drawn PNG + IP evidence). When both
// parties have signed, the Agreement is filed as the unit's compliance item.

import { NextResponse } from 'next/server'
import { verifyLeasePacketToken } from '@/lib/lease-packet-token'
import {
  getLeasePacket, roleSigned, recordLeaseSignature,
  roleEmail, rolePhone, rolePhoneRequired, roleVerification, setRoleVerification,
} from '@/lib/lease-packet'
import { maskEmail, maskPhone, signatureBlockReason, type SignGeo } from '@/lib/lease-packet-verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyLeasePacketToken(token)
  if (!t) return NextResponse.json({ error: 'This signing link has expired or is invalid.' }, { status: 401 })
  const p = await getLeasePacket(t.packetId)
  if (!p) return NextResponse.json({ error: 'This lease packet could not be found.' }, { status: 404 })

  return NextResponse.json({
    role: t.role,
    associationLegalName: p.association_legal_name ?? p.association_code,
    unit: p.unit_number ?? p.unit_ref,
    ownerName: p.owner_name,
    tenantName: p.tenant_name,
    leaseStart: p.lease_start,
    leaseEnd: p.lease_end,
    signerName: t.role === 'owner' ? p.owner_name : p.tenant_name,
    signerEmail: roleEmail(p, t.role),
    // Verified-signature layer: masked contacts + which factors are required /
    // already verified, so the signing page can drive the verification step.
    signerEmailMasked: maskEmail(roleEmail(p, t.role)),
    signerPhoneMasked: rolePhone(p, t.role) ? maskPhone(rolePhone(p, t.role)) : null,
    phoneRequired: rolePhoneRequired(p, t.role),
    emailVerified: !!roleVerification(p, t.role)?.emailVerifiedAt,
    phoneVerified: !!roleVerification(p, t.role)?.phoneVerifiedAt,
    alreadySigned: roleSigned(p, t.role),
    otherPartySigned: t.role === 'owner' ? !!p.tenant_signed_at : !!p.owner_signed_at,
    status: p.status,
    voided: p.status === 'void',
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyLeasePacketToken(token)
  if (!t) return NextResponse.json({ error: 'This signing link has expired or is invalid.' }, { status: 401 })

  let b: { name?: string; signatureImage?: string; agreed?: boolean; geo?: SignGeo | null }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (!b.agreed) return NextResponse.json({ error: 'Please check the box to consent and sign.' }, { status: 400 })
  const name = String(b.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Please type your full legal name.' }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent') ?? null

  // Verified-signature gate: email OTP always, phone OTP when a mobile is on
  // file. The signer verifies via /verify-otp first (which stamps the packet).
  const p = await getLeasePacket(t.packetId)
  if (!p) return NextResponse.json({ error: 'This lease packet could not be found.' }, { status: 404 })
  const blocked = signatureBlockReason(roleVerification(p, t.role), rolePhoneRequired(p, t.role))
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 })

  // Capture geolocation + device onto the verification certificate.
  const geo = (b.geo && typeof b.geo.lat === 'number' && typeof b.geo.lon === 'number')
    ? { lat: b.geo.lat, lon: b.geo.lon, accuracy_meters: typeof b.geo.accuracy_meters === 'number' ? b.geo.accuracy_meters : 0, timestamp_ms: typeof b.geo.timestamp_ms === 'number' ? b.geo.timestamp_ms : Date.now() }
    : { denied: true as const }
  await setRoleVerification(t.packetId, t.role, { geo, ip, ua })

  const res = await recordLeaseSignature(t.packetId, t.role, {
    name, image: (b.signatureImage && b.signatureImage.startsWith('data:image')) ? b.signatureImage : null, ip,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, bothSigned: res.bothSigned })
}
