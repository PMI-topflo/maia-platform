// GET  /api/admin/screening-provider?code=CODE  → the association's provider.
// POST /api/admin/screening-provider  { code, provider }  → set it. Staff-only.
// Where an approved Pre-Application intake hands off for the background check:
//   'tenant_evaluation' (current system) | 'maia_checkr' (MAIA's own + Checkr).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const code = new URL(req.url).searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })
  const { data } = await supabaseAdmin.from('associations').select('screening_provider').eq('association_code', code.toUpperCase()).maybeSingle()
  return NextResponse.json({ provider: (data?.screening_provider as string | null) ?? 'tenant_evaluation' })
}

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let b: { code?: string; provider?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const code = String(b.code ?? '').trim().toUpperCase()
  const provider = b.provider
  if (!code || (provider !== 'tenant_evaluation' && provider !== 'maia_checkr')) {
    return NextResponse.json({ error: 'code and a valid provider required' }, { status: 400 })
  }
  const { error } = await supabaseAdmin.from('associations').update({ screening_provider: provider }).eq('association_code', code)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, provider })
}
