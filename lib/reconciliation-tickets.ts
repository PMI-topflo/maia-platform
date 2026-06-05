// =====================================================================
// lib/reconciliation-tickets.ts
//
// Daily reconciliation tickets (one per staffer per day) for the monthly
// report. Two staffers drive the reconciliation screen:
//   • Isabela (AP) ticks the Rec box on each ledger line, then clicks
//     "Done" → her day's ticket is stamped "X of Y lines reconciled" per
//     association.
//   • Jonathan (AR) marks EFT invoices Paid in the "To Pay in CINC" box,
//     which also reconciles them → his day's ticket reports paid counts.
//
// The counts are RECOMPUTED from bank_reconciliation_entries each time
// (reconciled_by / paid_by + the ET date) so the rollup is idempotent —
// clicking Done twice, or a mark-paid after Done, just rewrites the same
// ticket rather than double-counting.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

const RECON_CATEGORY = 'Financial & Billing'

/** Today's date in America/New_York as YYYY-MM-DD. */
export function easternDateStr(d: Date = new Date()): string {
  // en-CA gives YYYY-MM-DD; pin the zone so the "day" matches the team's.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

function etDateOf(iso: string): string {
  return easternDateStr(new Date(iso))
}

interface AssocCount { association_code: string; reconciled: number; paid: number }

/** Per-association reconciled + paid counts a staffer logged on `dateStr`
 *  (ET). Reads the ledger directly so it's always in sync with the boxes
 *  the staffer actually clicked. */
async function countsForStaffDay(staffEmail: string, dateStr: string): Promise<AssocCount[]> {
  // Bound the scan to a couple of days, then filter to the exact ET date.
  const sinceUtc = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
  const { data } = await supabaseAdmin
    .from('bank_reconciliation_entries')
    .select('association_code, reconciled_at, reconciled_by, paid_at, paid_by')
    .or(`reconciled_by.eq.${staffEmail},paid_by.eq.${staffEmail}`)
    .gte('updated_at', sinceUtc)
    .limit(5000)

  const byAssoc = new Map<string, AssocCount>()
  for (const r of data ?? []) {
    const assoc = (r.association_code as string) ?? '—'
    const recOk  = r.reconciled_by === staffEmail && r.reconciled_at && etDateOf(r.reconciled_at as string) === dateStr
    const paidOk = r.paid_by === staffEmail       && r.paid_at       && etDateOf(r.paid_at as string)       === dateStr
    if (!recOk && !paidOk) continue
    const cur = byAssoc.get(assoc) ?? { association_code: assoc, reconciled: 0, paid: 0 }
    if (recOk)  cur.reconciled++
    if (paidOk) cur.paid++
    byAssoc.set(assoc, cur)
  }
  return [...byAssoc.values()].sort((a, b) => a.association_code.localeCompare(b.association_code))
}

function buildSummary(counts: AssocCount[]): { subject: string; summary: string; totalRec: number; totalPaid: number } {
  const totalRec  = counts.reduce((s, c) => s + c.reconciled, 0)
  const totalPaid = counts.reduce((s, c) => s + c.paid, 0)
  const lines = counts.map(c => {
    const bits = [c.reconciled ? `${c.reconciled} reconciled` : '', c.paid ? `${c.paid} paid` : ''].filter(Boolean).join(' · ')
    return `• ${c.association_code}: ${bits}`
  })
  const summary = (lines.length ? lines.join('\n') : 'No transactions reconciled yet today.')
    + `\n\nTotal: ${totalRec} reconciled${totalPaid ? ` · ${totalPaid} paid` : ''} across ${counts.length} association(s).`
  return { subject: '', summary, totalRec, totalPaid }
}

/** Get-or-create the daily reconciliation ticket for a staffer/day.
 *  Idempotent via the (assignee_email, recon_date) partial unique index. */
export async function getOrCreateDailyReconTicket(opts: {
  staffEmail: string
  staffName?: string | null
  dateStr?:   string
}): Promise<{ id: number; ticket_number: string } | null> {
  const dateStr = opts.dateStr ?? easternDateStr()
  const { data: existing } = await supabaseAdmin
    .from('tickets')
    .select('id, ticket_number')
    .eq('assignee_email', opts.staffEmail)
    .eq('recon_date', dateStr)
    .limit(1)
    .maybeSingle()
  if (existing) return existing as { id: number; ticket_number: string }

  const niceDate = new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const { data, error } = await supabaseAdmin
    .from('tickets')
    .insert({
      type:            'ticket',
      status:          'open',
      priority:        'normal',
      channel_origin:  'internal',
      ticket_category: RECON_CATEGORY,
      assignee_email:  opts.staffEmail,
      recon_date:      dateStr,
      subject:         `Daily bank reconciliation — ${niceDate}`,
      summary:         'No transactions reconciled yet today.',
      created_by_maia: true,
    })
    .select('id, ticket_number')
    .single()
  if (error) {
    // Lost a create race against the unique index — fetch the winner.
    if (error.code === '23505') {
      const { data: row } = await supabaseAdmin
        .from('tickets').select('id, ticket_number')
        .eq('assignee_email', opts.staffEmail).eq('recon_date', dateStr).limit(1).maybeSingle()
      return (row as { id: number; ticket_number: string } | null) ?? null
    }
    console.error('[recon-tickets] create failed:', error.message)
    return null
  }
  return data as { id: number; ticket_number: string }
}

/** Recompute a staffer's per-association counts for the day and rewrite
 *  their daily ticket's summary. `resolve` marks it done (the "Done"
 *  button); mark-paid calls it with resolve=false to keep accumulating. */
export async function refreshReconTicketSummary(opts: {
  staffEmail: string
  staffName?: string | null
  dateStr?:   string
  resolve?:   boolean
}): Promise<{ ticketId: number; ticketNumber: string; totalRec: number; totalPaid: number; summary: string } | null> {
  const dateStr = opts.dateStr ?? easternDateStr()
  const ticket  = await getOrCreateDailyReconTicket({ staffEmail: opts.staffEmail, staffName: opts.staffName, dateStr })
  if (!ticket) return null

  const counts = await countsForStaffDay(opts.staffEmail, dateStr)
  const { summary, totalRec, totalPaid } = buildSummary(counts)

  await supabaseAdmin
    .from('tickets')
    .update({
      summary,
      ...(opts.resolve ? { status: 'resolved', resolved_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', ticket.id)

  return { ticketId: ticket.id, ticketNumber: ticket.ticket_number, totalRec, totalPaid, summary }
}
