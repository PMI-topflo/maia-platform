// =====================================================================
// app/admin/tickets/components/renderTicketsList.tsx
// Shared server-side renderer for /admin/tickets and /admin/work-orders.
// Both pages call this with the same shape; only the lockTypeTo flag
// differs.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../components/AdminNav'
import TicketListClient, { type TicketRow } from './TicketListClient'

export interface TicketsListSearchParams {
  status?:      string
  priority?:    string
  channel?:     string
  association?: string
  assignee?:    string
  q?:           string
  type?:        string
}

export async function renderTicketsList(
  sp:          TicketsListSearchParams,
  defaultType: 'ticket' | 'work_order' | 'all',
) {
  let query = supabaseAdmin
    .from('tickets')
    .select('id, ticket_number, type, status, priority, channel_origin, association_code, persona, contact_name, contact_email, contact_phone, subject, summary, assignee_email, due_at, gmail_thread_id, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(200)

  const typeFilter = sp.type ?? (defaultType === 'all' ? undefined : defaultType)
  if (typeFilter) query = query.eq('type', typeFilter)

  if (sp.status && sp.status !== 'all') {
    if (sp.status === 'open_any') {
      query = query.in('status', ['open', 'pending', 'waiting_external'])
    } else {
      query = query.eq('status', sp.status)
    }
  } else if (!sp.status) {
    query = query.in('status', ['open', 'pending', 'waiting_external'])
  }

  if (sp.priority)    query = query.eq('priority',         sp.priority)
  if (sp.channel)     query = query.eq('channel_origin',   sp.channel)
  if (sp.association) query = query.eq('association_code', sp.association)
  if (sp.assignee)    query = query.eq('assignee_email',   sp.assignee.toLowerCase())
  if (sp.q) {
    const needle = sp.q.replace(/[%_]/g, ch => `\\${ch}`)
    query = query.or(`subject.ilike.%${needle}%,summary.ilike.%${needle}%,contact_name.ilike.%${needle}%,contact_email.ilike.%${needle}%,ticket_number.ilike.%${needle}%`)
  }

  const [{ data: tickets }, { data: associations }, { data: counts }] = await Promise.all([
    query,
    supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .eq('active', true)
      .order('association_name'),
    supabaseAdmin
      .from('tickets')
      .select('status, type'),
  ])

  const countsByStatus: Record<string, number> = {
    open_any: 0, open: 0, pending: 0, waiting_external: 0, resolved: 0, closed: 0,
  }
  for (const t of (counts ?? []) as Array<{ status: string; type: string }>) {
    if (typeFilter && t.type !== typeFilter) continue
    countsByStatus[t.status] = (countsByStatus[t.status] ?? 0) + 1
    if (t.status === 'open' || t.status === 'pending' || t.status === 'waiting_external') {
      countsByStatus.open_any += 1
    }
  }

  const rows: TicketRow[] = ((tickets ?? []) as TicketRow[]).map(t => ({
    id:                 t.id,
    ticket_number:      t.ticket_number,
    type:               t.type,
    status:             t.status,
    priority:           t.priority,
    channel_origin:     t.channel_origin,
    association_code:   t.association_code,
    persona:            t.persona,
    contact_name:       t.contact_name,
    contact_email:      t.contact_email,
    contact_phone:      t.contact_phone,
    subject:            t.subject,
    summary:            t.summary,
    assignee_email:     t.assignee_email,
    due_at:             t.due_at,
    created_at:         t.created_at,
    updated_at:         t.updated_at,
  }))

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>
      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <TicketListClient
          rows={rows}
          associations={associations ?? []}
          countsByStatus={countsByStatus}
          baseHref={'/admin/tickets'}
          showWorkOrderColumns={defaultType === 'work_order'}
          lockTypeTo={defaultType === 'all' ? null : defaultType}
          activeFilters={{
            status:      sp.status      ?? 'open_any',
            priority:    sp.priority    ?? '',
            channel:     sp.channel     ?? '',
            association: sp.association ?? '',
            assignee:    sp.assignee    ?? '',
            q:           sp.q           ?? '',
            type:        sp.type        ?? '',
          }}
        />
      </main>
    </div>
  )
}
