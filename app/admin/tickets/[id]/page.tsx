// =====================================================================
// app/admin/tickets/[id]/page.tsx
// Server component — single ticket with full message timeline + audit
// log. Loads work_order_details when applicable.
// =====================================================================

import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchStaffList } from '@/lib/staff-list'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../components/AdminNav'
import TicketDetailClient, {
  type TicketDetailData,
} from './components/TicketDetailClient'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function TicketDetailPage(props: PageProps) {
  const { id } = await props.params
  const ticketId = Number(id)
  if (!Number.isFinite(ticketId)) notFound()

  const [{ data: ticket }, { data: messages }, { data: events }, staff] = await Promise.all([
    supabaseAdmin.from('tickets').select('*').eq('id', ticketId).single(),
    supabaseAdmin
      .from('ticket_messages')
      .select('id, direction, channel, from_addr, to_addr, subject, body, body_html, attachments, external_id, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('ticket_events')
      .select('id, actor_email, event_type, payload, happened_at, created_at')
      .eq('ticket_id', ticketId)
      .order('happened_at', { ascending: true }),
    fetchStaffList(),
  ])

  if (!ticket) notFound()

  const [workOrder, associationName] = await Promise.all([
    ticket.type === 'work_order'
      ? supabaseAdmin.from('work_order_details').select('*').eq('ticket_id', ticketId).maybeSingle().then(r => r.data)
      : Promise.resolve(null),
    ticket.association_code
      ? supabaseAdmin
          .from('associations')
          .select('association_name')
          .eq('association_code', ticket.association_code)
          .maybeSingle()
          .then(r => r.data?.association_name as string | undefined ?? null)
      : Promise.resolve(null),
  ])

  const data: TicketDetailData = {
    ticket,
    messages:   messages ?? [],
    events:     events   ?? [],
    workOrder,
    staff,
    associationName,
  }

  // Work-order detail pages share the /admin/tickets/[id] route, so
  // override the AdminNav highlight to keep "Work Orders" lit when the
  // ticket type is work_order.
  const navOverride = ticket.type === 'work_order' ? '/admin/work-orders' : '/admin/tickets'

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav activeOverride={navOverride} />
      </SiteHeader>
      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <TicketDetailClient data={data} />
      </main>
    </div>
  )
}
