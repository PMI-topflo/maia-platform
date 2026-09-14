// =====================================================================
// app/api/admin/reconciliation/supersede/route.ts
//
// POST (staff) — close every still-open daily reconciliation ticket from
// BEFORE today for each active AP/AR staffer, as superseded. The 6 AM cron
// does this every weekday after it opens the day's ticket; this route is
// the manual/one-time version (2026-09-14: 146 leftovers since June).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { supersedeOlderReconTickets, easternDateStr } from '@/lib/reconciliation-tickets'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data: staff } = await supabaseAdmin
    .from('pmi_staff').select('email').in('role', ['Accounts Payable', 'Accounts Receivable']).eq('active', true)
  const dateStr = easternDateStr()
  const result: Record<string, number> = {}
  for (const s of staff ?? []) {
    if (!s.email) continue
    const email = String(s.email).toLowerCase()
    const r = await supersedeOlderReconTickets({ staffEmail: email, dateStr })
    result[email] = r.superseded
  }
  return NextResponse.json({ ok: true, date: dateStr, superseded: result })
}
