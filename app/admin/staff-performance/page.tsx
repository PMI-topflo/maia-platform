// =====================================================================
// app/admin/staff-performance/page.tsx
//
// Server component — fetches raw ticket_events + tickets + staff,
// runs aggregations via lib/staff-performance.ts, hands the rows to
// the client for charts + table + range switching.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchStaffList } from '@/lib/staff-list'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import {
  aggregateStaffPerformance,
  rangeForKey,
  type RawTicket,
  type RawTicketEvent,
} from '@/lib/staff-performance'
import StaffPerformanceClient from './StaffPerformanceClient'

export const dynamic = 'force-dynamic'

type RangeKey = '7d' | '30d' | '90d' | 'all'

function parseRangeKey(raw: string | undefined): RangeKey {
  if (raw === '7d' || raw === '30d' || raw === '90d' || raw === 'all') return raw
  return '30d'
}

interface SearchParams {
  range?: string
  type?:  string  // 'all' | 'ticket' | 'work_order'
}

export default async function StaffPerformancePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp        = await searchParams
  const rangeKey  = parseRangeKey(sp.range)
  const typeKey   = sp.type === 'ticket' || sp.type === 'work_order' ? sp.type : 'all'
  const range     = rangeForKey(rangeKey)

  // Pull events in window + tickets they reference + the staff list,
  // in parallel. We pull a bit more on the events side and filter
  // ticket_id sets in JS to avoid round-tripping.
  const eventsQuery = supabaseAdmin
    .from('ticket_events')
    .select('ticket_id, actor_email, event_type, payload, created_at')
    .gte('created_at', range.start ? range.start.toISOString() : '1970-01-01')
    .lte('created_at', range.end.toISOString())
    .order('created_at', { ascending: true })
    .limit(5000)

  const [{ data: events }, staff] = await Promise.all([
    eventsQuery,
    fetchStaffList(),
  ])

  const eventRows = (events ?? []) as RawTicketEvent[]
  const ticketIds = Array.from(new Set(eventRows.map(e => e.ticket_id)))

  let tickets: RawTicket[] = []
  if (ticketIds.length > 0) {
    let ticketsQuery = supabaseAdmin
      .from('tickets')
      .select('id, created_at, type')
      .in('id', ticketIds)

    if (typeKey !== 'all') ticketsQuery = ticketsQuery.eq('type', typeKey)
    const { data: tRows } = await ticketsQuery
    tickets = (tRows ?? []) as Array<RawTicket & { type: string }>

    // If a type filter is in play, drop events whose tickets were filtered out.
    if (typeKey !== 'all') {
      const keepIds = new Set(tickets.map(t => t.id))
      for (let i = eventRows.length - 1; i >= 0; i--) {
        if (!keepIds.has(eventRows[i].ticket_id)) eventRows.splice(i, 1)
      }
    }
  }

  const rows = aggregateStaffPerformance({
    tickets,
    events: eventRows,
    staff,
    rangeStart: range.start,
    rangeEnd:   range.end,
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>
      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <StaffPerformanceClient
          rows={rows}
          activeRange={rangeKey}
          activeType={typeKey}
          totalTicketsTouched={tickets.length}
          totalEvents={eventRows.length}
        />
      </main>
    </div>
  )
}
