// GET /api/admin/cinc/vendor-types
// CINC's vendor-type catalog (read-only) + any MAIA-local trades already in
// use — for the vendor type picker. Staff-only.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listVendorTypes } from '@/lib/integrations/cinc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [cincTypes, { data: overrides }] = await Promise.all([
    listVendorTypes().catch(() => []),
    supabaseAdmin.from('vendor_trade_overrides').select('trade').eq('source', 'local'),
  ])
  const localTypes = Array.from(new Set((overrides ?? []).map(o => String(o.trade).trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  return NextResponse.json({ cincTypes, localTypes })
}
