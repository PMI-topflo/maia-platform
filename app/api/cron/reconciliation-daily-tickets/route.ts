// =====================================================================
// app/api/cron/reconciliation-daily-tickets/route.ts
//
// Opens the day's bank-reconciliation to-do ticket for each AP/AR staffer
// (Isabela = Accounts Payable, Jonathan = Accounts Receivable) so it's
// waiting for them when they start. They tick the Rec boxes / mark EFT
// invoices paid through the day, then click "Done" to stamp the per-
// association counts and resolve it.
//
// Target: 6:00 AM ET, Mon–Fri. DST-safe like daily-staff-news — the cron
// fires at 10:00 AND 11:00 UTC (vercel.json) and this route only acts when
// the Eastern hour === 6. Manual run: GET with Bearer CRON_SECRET + ?force=1.
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOrCreateDailyReconTicket, easternDateStr } from '@/lib/reconciliation-tickets'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

const OPEN_HOUR_ET = 6

function easternHour(): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date()))
}

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const force = new URL(req.url).searchParams.get('force') === '1'
  const hour  = easternHour()
  if (!force && hour !== OPEN_HOUR_ET) {
    return NextResponse.json({ skipped: true, reason: `not 6 AM ET (current ET hour ${hour})` })
  }

  // Reconciliation is driven by Accounts Payable + Accounts Receivable.
  const { data: staff } = await supabaseAdmin
    .from('pmi_staff')
    .select('email, name, role, active')
    .in('role', ['Accounts Payable', 'Accounts Receivable'])
    .eq('active', true)

  const dateStr = easternDateStr()
  const created: string[] = []
  for (const s of staff ?? []) {
    if (!s.email) continue
    const t = await getOrCreateDailyReconTicket({ staffEmail: String(s.email).toLowerCase(), staffName: s.name as string | null, dateStr })
    if (t) created.push(`${s.email} → ${t.ticket_number}`)
  }

  return NextResponse.json({ ok: true, date: dateStr, tickets: created })
}
