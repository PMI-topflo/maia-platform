// =====================================================================
// GET /api/addon/staff
//
// Active staff (name + email) for the add-on's "Assign to" picker, so a
// ticket/work order created from Gmail can be assigned to anyone, not
// just the caller.
//
// Auth: add-on bearer token.
// =====================================================================

import { NextResponse } from 'next/server'
import { addonStaffEmail } from '@/lib/addon-token'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const staff = await addonStaffEmail(req)
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin
    .from('pmi_staff')
    .select('name, email')
    .eq('active', true)
    .order('name')

  const list = (data ?? [])
    .filter((s): s is { name: string | null; email: string } => !!(s as { email?: string }).email)
    .map(s => ({ name: String(s.name ?? s.email), email: String(s.email).toLowerCase() }))

  return NextResponse.json({ staff: list })
}
