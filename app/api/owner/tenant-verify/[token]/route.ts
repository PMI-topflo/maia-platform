// =====================================================================
// GET /api/owner/tenant-verify/[token]   (token-gated; no session)
// Returns context for the owner tenant-verification confirm page: who
// self-identified as the tenant, which unit, and what's still missing.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyTenantVerifyToken } from '@/lib/tenant-verification-token'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const verificationId = await verifyTenantVerifyToken(token)
  if (!verificationId) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  const { data: v } = await supabaseAdmin.from('tenant_verifications')
    .select('id, association_name, unit_number, tenant_name, email, phone, lease_path, board_letter_path, owner_confirmed, status')
    .eq('id', verificationId).maybeSingle()
  if (!v) return NextResponse.json({ error: 'not found' }, { status: 404 })

  return NextResponse.json({
    associationName: v.association_name, unit: v.unit_number,
    tenantName: v.tenant_name, tenantEmail: v.email, tenantPhone: v.phone,
    hasLease: !!v.lease_path, hasBoardLetter: !!v.board_letter_path,
    ownerConfirmed: v.owner_confirmed, status: v.status,
  })
}
