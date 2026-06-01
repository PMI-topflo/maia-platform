// =====================================================================
// GET /api/addon/associations
//
// The Gmail add-on calls this to show staff the list of association
// codes so they can tag emails with "#CODE" (e.g. "@maia upload this
// invoice #ONE"). Returns active associations sorted by code.
//
// Auth: add-on bearer token (lib/addon-token.ts). Not session-gated.
// =====================================================================

import { NextResponse } from 'next/server'
import { addonStaffEmail } from '@/lib/addon-token'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const staff = await addonStaffEmail(req)
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name')
    .eq('active', true)
    .order('association_code')

  const associations = (data ?? []).map((r: Record<string, unknown>) => ({
    code: String(r.association_code ?? ''),
    name: String(r.association_name ?? ''),
  }))
  return NextResponse.json({ associations })
}
