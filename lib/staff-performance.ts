// =====================================================================
// lib/staff-performance.ts
//
// Pure aggregations over ticket_events + tickets for the staff
// performance dashboard. No DB access here — the page handler fetches
// raw rows and passes them in. Keeps the logic testable and the
// shapes obvious.
//
// Three metrics per staff member, all attributed to the actor_email
// on each event:
//   - resolved_count           — distinct tickets the staff resolved
//                                or closed within the date range.
//   - avg_first_response_ms    — average time from ticket.created_at
//                                to the FIRST outbound/internal_note
//                                this staff sent on that ticket.
//   - avg_time_to_close_ms     — average time from ticket.created_at
//                                to when this staff resolved/closed it.
// =====================================================================

export interface RawTicket {
  id:          number
  created_at:  string
}

export interface RawTicketEvent {
  ticket_id:    number
  actor_email:  string | null
  event_type:   string
  payload:      Record<string, unknown> | null
  created_at:   string
}

export interface RawStaff {
  name:  string
  email: string
  role:  string | null
}

export interface StaffPerformanceRow {
  name:                       string
  email:                      string
  role:                       string | null
  resolved_count:             number
  avg_first_response_ms:      number | null
  avg_time_to_close_ms:       number | null
  first_response_sample_size: number
  close_sample_size:          number
}

const CLOSED_LIKE = new Set(['resolved', 'closed'])
const RESPONSE_DIRECTIONS = new Set(['outbound', 'internal_note'])

/**
 * Aggregate per-staff performance metrics from raw ticket + event rows.
 *
 * Events outside the date range are ignored entirely (no partial
 * credit). For "first response" and "time to close", a ticket counts
 * for a given staff if and only if THAT staff was the first to perform
 * the action on that ticket within the range.
 */
export function aggregateStaffPerformance(input: {
  tickets:    RawTicket[]
  events:     RawTicketEvent[]
  staff:      RawStaff[]
  rangeStart: Date | null  // null = all time
  rangeEnd:   Date | null  // null = now
}): StaffPerformanceRow[] {
  const { tickets, events, staff, rangeStart, rangeEnd } = input

  const startMs = rangeStart ? rangeStart.getTime() : -Infinity
  const endMs   = rangeEnd   ? rangeEnd.getTime()   : Infinity

  const ticketById = new Map<number, RawTicket>()
  for (const t of tickets) ticketById.set(t.id, t)

  // Track per-staff aggregates as we walk events.
  // resolvedTicketsByStaff: staff_email -> Set<ticket_id> they resolved in range
  // firstResponseDeltas:    staff_email -> ms[]   (one per ticket where staff was first responder)
  // closeDeltas:            staff_email -> ms[]   (one per ticket they resolved/closed)
  const resolvedTicketsByStaff = new Map<string, Set<number>>()
  const firstResponseDeltas    = new Map<string, number[]>()
  const closeDeltas            = new Map<string, number[]>()

  // For first-response and time-to-close: per ticket, who got there
  // first? We need to scan events sorted by created_at ascending. Track
  // which staff has already been credited for each (ticket, metric).
  const firstResponderByTicket: Map<number, string> = new Map()
  const firstResolverByTicket:  Map<number, string> = new Map()

  const sortedEvents = [...events].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  for (const ev of sortedEvents) {
    const evMs = new Date(ev.created_at).getTime()
    if (evMs < startMs || evMs > endMs) continue
    if (!ev.actor_email)                 continue

    const actor  = ev.actor_email.toLowerCase()
    const ticket = ticketById.get(ev.ticket_id)
    if (!ticket) continue

    const ticketCreatedMs = new Date(ticket.created_at).getTime()
    const deltaMs         = evMs - ticketCreatedMs
    if (deltaMs < 0) continue  // event before ticket — shouldn't happen, defensive

    // ── First response: earliest outbound/internal_note message_added
    if (ev.event_type === 'message_added') {
      const direction = typeof ev.payload?.direction === 'string' ? ev.payload.direction : ''
      if (RESPONSE_DIRECTIONS.has(direction) && !firstResponderByTicket.has(ev.ticket_id)) {
        firstResponderByTicket.set(ev.ticket_id, actor)
        const arr = firstResponseDeltas.get(actor) ?? []
        arr.push(deltaMs)
        firstResponseDeltas.set(actor, arr)
      }
    }

    // ── Resolved / closed: earliest status_changed → resolved|closed
    if (ev.event_type === 'status_changed') {
      const to = typeof ev.payload?.to === 'string' ? ev.payload.to : ''
      if (CLOSED_LIKE.has(to)) {
        const set = resolvedTicketsByStaff.get(actor) ?? new Set()
        set.add(ev.ticket_id)
        resolvedTicketsByStaff.set(actor, set)

        if (!firstResolverByTicket.has(ev.ticket_id)) {
          firstResolverByTicket.set(ev.ticket_id, actor)
          const arr = closeDeltas.get(actor) ?? []
          arr.push(deltaMs)
          closeDeltas.set(actor, arr)
        }
      }
    }
  }

  const avg = (arr: number[]): number | null =>
    arr.length === 0 ? null : Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)

  return staff.map(s => {
    const email = s.email.toLowerCase()
    const fr    = firstResponseDeltas.get(email) ?? []
    const cd    = closeDeltas.get(email)         ?? []
    return {
      name:                       s.name,
      email:                      s.email,
      role:                       s.role,
      resolved_count:             (resolvedTicketsByStaff.get(email) ?? new Set()).size,
      avg_first_response_ms:      avg(fr),
      avg_time_to_close_ms:       avg(cd),
      first_response_sample_size: fr.length,
      close_sample_size:          cd.length,
    }
  })
}

/** Compute the date range for a quick-switch key. Returns null start
 *  for 'all' (no lower bound). End is always "now". */
export function rangeForKey(key: '7d' | '30d' | '90d' | 'all'): { start: Date | null; end: Date } {
  const end = new Date()
  if (key === 'all') return { start: null, end }
  const days = key === '7d' ? 7 : key === '30d' ? 30 : 90
  const start = new Date(end)
  start.setDate(start.getDate() - days)
  return { start, end }
}

/** Render a millisecond duration as a short, human-friendly string.
 *  Returns "—" for null/zero. */
export function fmtDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return '—'
  const sec = Math.round(ms / 1000)
  if (sec < 60)              return `${sec}s`
  const min = Math.round(sec / 60)
  if (min < 60)              return `${min}m`
  const hr  = Math.round(min / 60)
  if (hr < 24)               return `${hr}h`
  const day = Math.round(hr / 24)
  return `${day}d`
}
