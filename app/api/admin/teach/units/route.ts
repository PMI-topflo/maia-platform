// =====================================================================
// GET /api/admin/teach/units?association_code=CODE
// Returns the owner accounts/units for an association, to populate the
// "per unit / account" dropdown in the teach studio. Staff-only.
// Keyed by account_number (stable), labeled by unit + name.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireStaff(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}

export async function GET(req: NextRequest) {
  if (!(await requireStaff(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const code = req.nextUrl.searchParams.get('association_code')
  if (!code) return NextResponse.json({ units: [] })

  const { data, error } = await supabaseAdmin
    .from('owners')
    .select('account_number, unit_number, first_name, last_name, entity_name, status')
    .eq('association_code', code)
    .limit(2000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Dedupe by account_number; build a readable label.
  const seen = new Map<string, { account_number: string; unit_number: string | null; label: string }>()
  for (const o of data ?? []) {
    const acct = (o.account_number ?? '').toString().trim()
    if (!acct || seen.has(acct)) continue
    const name = (o.entity_name?.trim() || [o.first_name, o.last_name].filter(Boolean).join(' ').trim() || '')
    const unit = (o.unit_number ?? '').toString().trim()
    const label = [unit ? `Unit ${unit}` : `Acct ${acct}`, name].filter(Boolean).join(' — ')
    seen.set(acct, { account_number: acct, unit_number: unit || null, label })
  }

  const units = [...seen.values()].sort((a, b) =>
    (a.unit_number ?? a.account_number).localeCompare(b.unit_number ?? b.account_number, undefined, { numeric: true }),
  )
  return NextResponse.json({ units })
}
