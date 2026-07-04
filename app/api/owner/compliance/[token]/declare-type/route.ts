// =====================================================================
// POST /api/owner/compliance/[token]/declare-type   { itemKey, declaredType }
// (token-gated; no session)
// Owner self-reports which insurance policy type they carry for a missing
// item (e.g. HO-6 vs HO-3 vs "None currently"). Stored on compliance_records
// without disturbing document-review status — declaring a type is intent,
// not proof.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyOwnerComplianceToken } from '@/lib/owner-portal-token'
import { getUnitComplianceState, setDeclaredType, INSURANCE_TYPE_OPTIONS } from '@/lib/unit-required-docs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyOwnerComplianceToken(token)
  if (!t) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let body: { itemKey?: string; declaredType?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const itemKey = String(body.itemKey ?? '')
  const declaredType = String(body.declaredType ?? '')
  const options = INSURANCE_TYPE_OPTIONS[itemKey]
  if (!options) return NextResponse.json({ error: 'unknown item' }, { status: 400 })
  if (!options.includes(declaredType)) return NextResponse.json({ error: 'invalid declared type' }, { status: 400 })

  await setDeclaredType(t.assoc, t.account, itemKey, declaredType, 'owner')
  const { missing } = await getUnitComplianceState(t.assoc, t.account)
  return NextResponse.json({ ok: true, missing })
}
