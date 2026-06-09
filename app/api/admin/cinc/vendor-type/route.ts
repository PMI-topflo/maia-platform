// PATCH /api/admin/cinc/vendor-type
// Set a vendor's trade/type. Either assign an existing CINC type (pushed to
// CINC via VendorTypeID, mirrored locally) or set a MAIA-local trade CINC
// lacks. Staff-only.
// Body: { vendor_id, cinc_type_id?, cinc_type_name?, local_trade? }
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { updateVendorRecord } from '@/lib/integrations/cinc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actor = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null

  let body: { vendor_id?: unknown; cinc_type_id?: unknown; cinc_type_name?: unknown; local_trade?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const vendorId = Number(body.vendor_id)
  if (!Number.isFinite(vendorId)) return NextResponse.json({ error: 'vendor_id is required' }, { status: 400 })

  const cincTypeId   = typeof body.cinc_type_id === 'string' && body.cinc_type_id.trim() ? body.cinc_type_id.trim() : null
  const cincTypeName = typeof body.cinc_type_name === 'string' ? body.cinc_type_name.trim() : ''
  const localTrade   = typeof body.local_trade === 'string' ? body.local_trade.trim() : ''

  let trade: string
  let source: 'cinc' | 'local'
  if (cincTypeId) {
    // Assign an existing CINC type — push it, then mirror locally.
    try { await updateVendorRecord(vendorId, { VendorTypeID: cincTypeId }) }
    catch (e) { return NextResponse.json({ error: `CINC update failed: ${(e as Error).message}` }, { status: 502 }) }
    trade = cincTypeName || 'Assigned'; source = 'cinc'
  } else if (localTrade) {
    trade = localTrade; source = 'local'
  } else {
    return NextResponse.json({ error: 'provide a CINC type or a local trade' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('vendor_trade_overrides').upsert({
    vendor_id: vendorId, trade, cinc_type_id: cincTypeId, source, updated_by: actor, updated_at: new Date().toISOString(),
  }, { onConflict: 'vendor_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, trade, source, pushed_to_cinc: source === 'cinc' })
}
