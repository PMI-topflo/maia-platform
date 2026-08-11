// GET /api/admin/pre-apply/owner-lookup?assoc=MANXI&unit=613
// The owner name + email(s) on file for a unit (from CINC-synced owners), so
// staff see who the owner is when generating an application link. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const assoc = (url.searchParams.get('assoc') ?? '').trim().toUpperCase()
  const unit = (url.searchParams.get('unit') ?? '').trim()
  if (!assoc || !unit) return NextResponse.json({ owners: [] })

  const { data } = await supabaseAdmin.from('owners')
    .select('first_name, last_name, entity_name, emails, phone')
    .eq('association_code', assoc).or(`unit_number.eq.${unit},account_number.eq.${assoc}${unit}`).or('status.neq.previous,status.is.null')

  const owners = (data ?? []).map(o => ({
    name: (String(o.entity_name ?? '').trim() || `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim()) || null,
    emails: String(o.emails ?? '').split(',').map(s => s.trim()).filter(e => e.includes('@')),
    phone: (o.phone as string | null) ?? null,
  })).filter(o => o.name || o.emails.length)

  return NextResponse.json({ owners })
}
