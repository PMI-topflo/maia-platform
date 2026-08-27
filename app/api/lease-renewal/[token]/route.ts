// GET/POST /api/lease-renewal/[token]
// Public, token-gated (no OTP — matches /request/[token]'s precedent for
// this class of action): the owner or tenant reporting what's actually
// happening with an ending lease, from the link the "Lease expiring in N
// days" cron now sends. GET loads context for the page; POST records the
// answer and triggers the matching side effect (lib/lease-renewal-check.ts).

import { NextResponse } from 'next/server'
import { loadCheckByToken, recordOwnerResponse, recordTenantResponse, type OwnerOccupancy, type OwnerResponse, type TenantResponse } from '@/lib/lease-renewal-check'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OWNER_OCC = new Set(['owner_occupied', 'leased', 'vacant'])
const OWNER_RESP = new Set(['renew', 'signed'])
const TENANT_RESP = new Set(['renew', 'vacating', 'vacated', 'signed', 'apply'])

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const found = await loadCheckByToken(token)
  if (!found) return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 404 })
  const { check, role } = found
  return NextResponse.json({
    role, unitLabel: check.unit_label, associationCode: check.association_code, leaseEnd: check.lease_end,
    ownerOccupancy: check.owner_occupancy, ownerResponse: check.owner_response, ownerRespondedAt: check.owner_responded_at,
    tenantResponse: check.tenant_response, tenantRespondedAt: check.tenant_responded_at,
    name: role === 'owner' ? check.owner_name : check.tenant_name,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const found = await loadCheckByToken(token)
  if (!found) return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 404 })
  const { check, role } = found

  let b: { occupancy?: string; response?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  if (role === 'owner') {
    const occupancy = b.occupancy && OWNER_OCC.has(b.occupancy) ? (b.occupancy as OwnerOccupancy) : null
    const response = b.response && OWNER_RESP.has(b.response) ? (b.response as OwnerResponse) : null
    if (!occupancy && !response) return NextResponse.json({ error: 'Pick an option.' }, { status: 400 })
    if (response === 'renew' && occupancy && occupancy !== 'leased') return NextResponse.json({ error: 'Renewing a lease only applies when the unit is leased.' }, { status: 400 })
    const result = await recordOwnerResponse(check, occupancy, response)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const response = b.response && TENANT_RESP.has(b.response) ? (b.response as TenantResponse) : null
  if (!response) return NextResponse.json({ error: 'Pick an option.' }, { status: 400 })
  const result = await recordTenantResponse(check, response)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
