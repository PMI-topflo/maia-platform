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

  const [{ data: ticket }, { data: messages }, { data: events }, staff, { data: assocList }] = await Promise.all([
    supabaseAdmin.from('tickets').select('*').eq('id', ticketId).single(),
    supabaseAdmin
      .from('ticket_messages')
      .select('id, direction, channel, from_addr, to_addr, subject, body, body_en, body_html, attachments, external_id, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('ticket_events')
      .select('id, actor_email, event_type, payload, happened_at, created_at')
      .eq('ticket_id', ticketId)
      .order('happened_at', { ascending: true }),
    fetchStaffList(),
    supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .order('association_name', { ascending: true }),
  ])

  if (!ticket) notFound()

  const [workOrder, associationName, siblingRows] = await Promise.all([
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
    // Prev/next pager: walk this ticket's siblings of the SAME type in the
    // same order the list shows them (updated_at DESC, non-archived). Lets
    // staff page through work orders / tickets without bouncing to the list.
    supabaseAdmin
      .from('tickets')
      .select('id')
      .eq('type', ticket.type)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(500)
      .then(r => r.data ?? []),
  ])

  // Locate the current ticket among its siblings to build the pager. If it
  // isn't in the set (e.g. it's archived), we simply don't show a pager.
  const siblingIds = (siblingRows as Array<{ id: number }>).map(s => s.id)
  const pagerIdx   = siblingIds.indexOf(ticketId)
  const pager = pagerIdx === -1 ? null : {
    prevId:   pagerIdx > 0 ? siblingIds[pagerIdx - 1] : null,
    nextId:   pagerIdx < siblingIds.length - 1 ? siblingIds[pagerIdx + 1] : null,
    position: pagerIdx + 1,
    total:    siblingIds.length,
  }

  const data: TicketDetailData = {
    ticket,
    messages:   messages ?? [],
    events:     events   ?? [],
    workOrder,
    staff,
    associationName,
    associations: ((assocList ?? []) as Array<{ association_code: string; association_name: string }>)
      .filter(a => a.association_code && a.association_name),
    pager,
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
      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <TicketDetailClient data={data} />
      </main>
    </div>
  )
}
