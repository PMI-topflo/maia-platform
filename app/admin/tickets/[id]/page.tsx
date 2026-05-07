// =====================================================================
// app/admin/tickets/[id]/page.tsx
// Server component — single ticket with full message timeline + audit
// log. Loads work_order_details when applicable.
// =====================================================================

import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase-admin'
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

  const [{ data: ticket }, { data: messages }, { data: events }, { data: staff }] = await Promise.all([
    supabaseAdmin.from('tickets').select('*').eq('id', ticketId).single(),
    supabaseAdmin
      .from('ticket_messages')
      .select('id, direction, channel, from_addr, to_addr, subject, body, body_html, attachments, external_id, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('ticket_events')
      .select('id, actor_email, event_type, payload, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('pmi_staff')
      .select('name, email, role')
      .eq('active', true)
      .order('name'),
  ])

  if (!ticket) notFound()

  const workOrder = ticket.type === 'work_order'
    ? (await supabaseAdmin.from('work_order_details').select('*').eq('ticket_id', ticketId).maybeSingle()).data
    : null

  const data: TicketDetailData = {
    ticket,
    messages:   messages ?? [],
    events:     events   ?? [],
    workOrder,
    staff:      (staff ?? []) as Array<{ name: string; email: string; role: string | null }>,
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>
      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <TicketDetailClient data={data} />
      </main>
    </div>
  )
}
