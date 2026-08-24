// =====================================================================
// app/admin/tickets/components/renderTicketsList.tsx
// Shared server-side renderer for /admin/tickets and /admin/work-orders.
// Both pages call this with the same shape; only the lockTypeTo flag
// differs.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchStaffList } from '@/lib/staff-list'
import SiteHeader from '@/components/SiteHeader'
import ResyncWorkOrdersButton from '../../components/ResyncWorkOrdersButton'
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
  wo_type?:     string  // CINC WorkOrderType filter ("Plumbing", "HVAC", …)
  category?:    string  // ticket_category filter — the 17 staff buckets
  archived?:    string  // '1' to include archived rows in results
}

export async function renderTicketsList(
  sp:          TicketsListSearchParams,
  defaultType: 'ticket' | 'work_order' | 'all',
) {
  const typeFilter = sp.type ?? (defaultType === 'all' ? undefined : defaultType)

  // User direction, 2026-08-24: scope this list to the last 12 months —
  // years of resolved/closed history was inflating counts (and the list)
  // with tickets nobody's acting on anymore. Applied uniformly (all
  // statuses) via created_at, same as every other filter here.
  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setUTCFullYear(twelveMonthsAgo.getUTCFullYear() - 1)
  const sinceIso = twelveMonthsAgo.toISOString()

  // Every filter EXCEPT status — shared by the list query and the tab-count
  // query below, so the counts on Pending/Waiting/Resolved/Closed always
  // describe the same slice of tickets the list itself is showing. Applied
  // as a function (not a shared builder instance) so each query gets its
  // own independent chain. skipDate lets the "All" tab (and its count)
  // opt out of the 12-month window — user direction 2026-08-24: "All"
  // should mean all time, not "last 12 months, unfiltered by status."
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function applyCommonFilters(q: any, opts?: { skipDate?: boolean; skipArchived?: boolean }): any {
    if (!opts?.skipDate) q = q.gte('created_at', sinceIso)
    if (typeFilter)  q = q.eq('type',                 typeFilter)
    if (sp.wo_type)  q = q.eq('work_order_type_name', sp.wo_type)
    if (!opts?.skipArchived && sp.archived !== '1') q = q.is('archived_at', null)
    if (sp.priority)    q = q.eq('priority',         sp.priority)
    if (sp.channel)     q = q.eq('channel_origin',   sp.channel)
    if (sp.association) q = q.eq('association_code', sp.association)
    if (sp.assignee)    q = q.eq('assignee_email',   sp.assignee.toLowerCase())
    if (sp.category)    q = q.eq('ticket_category',  sp.category)
    if (sp.q) {
      const needle = sp.q.replace(/[%_]/g, ch => `\\${ch}`)
      q = q.or(`subject.ilike.%${needle}%,summary.ilike.%${needle}%,contact_name.ilike.%${needle}%,contact_email.ilike.%${needle}%,ticket_number.ilike.%${needle}%,cinc_workorder_id.ilike.%${needle}%`)
    }
    return q
  }

  const isAllTimeTab   = sp.status === 'all'
  // User direction, 2026-08-24: archived work orders should still show up
  // (and count) under the Resolved tab without needing "Show archived"
  // checked — archiving is for keeping old history out of the *active*
  // views (Open/Pending/Waiting/default), not for hiding completed work
  // from its own completed-work log.
  const isResolvedTab  = sp.status === 'resolved'

  let query = applyCommonFilters(
    supabaseAdmin
      .from('tickets')
      .select('id, ticket_number, type, status, priority, channel_origin, association_code, persona, contact_name, contact_email, contact_phone, subject, summary, assignee_email, due_at, gmail_thread_id, work_order_type_name, ticket_category, cinc_workorder_id, archived_at, created_at, updated_at'),
    { skipDate: isAllTimeTab, skipArchived: isResolvedTab },
  ).order('updated_at', { ascending: false }).limit(200)

  if (sp.status && sp.status !== 'all') {
    if (sp.status === 'open_any') {
      query = query.in('status', ['open', 'pending', 'waiting_external'])
    } else {
      query = query.eq('status', sp.status)
    }
  } else if (!sp.status) {
    query = query.in('status', ['open', 'pending', 'waiting_external'])
  }

  // Distinct WorkOrderType names across CINC tickets — drives the
  // Motive filter dropdown. Cheap (limit 500, only when we'd actually
  // render the filter). null values + non-WO rows are skipped.
  const woTypesQuery = (defaultType === 'work_order' || defaultType === 'all')
    ? supabaseAdmin
        .from('tickets')
        .select('work_order_type_name')
        .eq('type', 'work_order')
        .not('work_order_type_name', 'is', null)
        .limit(500)
    : Promise.resolve({ data: [] as Array<{ work_order_type_name: string | null }> })

  // Same filters as the list query, minus status itself (we need counts
  // broken out BY status) — so the tab counts (Pending/Waiting/Resolved/
  // Closed) describe the same association/priority/channel/etc. slice the
  // list is actually showing, not the whole tickets table. Real bug this
  // fixes: a Galleria Village + Pending filter showed "Pending 13" (the
  // portfolio-wide count across every association) while the list below
  // correctly found zero GVH rows and rendered empty — the counts and the
  // list were answering two different questions.
  const countsQuery = applyCommonFilters(
    supabaseAdmin.from('tickets').select('status'),
  )
  // The "All" tab's own count needs to be a true all-time total (it
  // ignores the 12-month window when selected), independent of the
  // 12-month-scoped per-status counts above.
  const allTimeCountQuery = applyCommonFilters(
    supabaseAdmin.from('tickets').select('id', { count: 'exact', head: true }),
    { skipDate: true },
  )
  // Same reasoning as isResolvedTab above: the Resolved tab's own badge
  // count must include archived rows too, regardless of which tab is
  // currently selected or whether "Show archived" is checked.
  const resolvedCountQuery = applyCommonFilters(
    supabaseAdmin.from('tickets').select('id', { count: 'exact', head: true }).eq('status', 'resolved'),
    { skipArchived: true },
  )

  const [{ data: tickets }, { data: associations }, { data: counts }, staff, { data: woTypeRows }, { count: allTimeCount }, { count: resolvedCount }] = await Promise.all([
    query,
    supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .eq('active', true)
      .order('association_name'),
    countsQuery,
    fetchStaffList(),
    woTypesQuery,
    allTimeCountQuery,
    resolvedCountQuery,
  ])

  const woTypes = Array.from(new Set(
    ((woTypeRows ?? []) as Array<{ work_order_type_name: string | null }>)
      .map(r => r.work_order_type_name)
      .filter((n): n is string => !!n)
  )).sort()

  const countsByStatus: Record<string, number> = {
    open_any: 0, open: 0, pending: 0, waiting_external: 0, resolved: 0, canceled: 0, all: 0,
  }
  for (const t of (counts ?? []) as Array<{ status: string }>) {
    countsByStatus[t.status] = (countsByStatus[t.status] ?? 0) + 1
    if (t.status === 'open' || t.status === 'pending' || t.status === 'waiting_external') {
      countsByStatus.open_any += 1
    }
  }
  // Override with the true all-time total — the loop above only saw the
  // 12-month-scoped counts query.
  countsByStatus.all = allTimeCount ?? 0
  // Override with the archived-inclusive total — the loop above only saw
  // the default-excludes-archived counts query.
  countsByStatus.resolved = resolvedCount ?? 0

  const rows: TicketRow[] = ((tickets ?? []) as TicketRow[]).map(t => ({
    id:                   t.id,
    ticket_number:        t.ticket_number,
    type:                 t.type,
    status:               t.status,
    priority:             t.priority,
    channel_origin:       t.channel_origin,
    association_code:     t.association_code,
    persona:              t.persona,
    contact_name:         t.contact_name,
    contact_email:        t.contact_email,
    contact_phone:        t.contact_phone,
    subject:              t.subject,
    summary:              t.summary,
    assignee_email:       t.assignee_email,
    due_at:               t.due_at,
    work_order_type_name: t.work_order_type_name,
    ticket_category:      t.ticket_category,
    cinc_workorder_id:    t.cinc_workorder_id,
    archived_at:          t.archived_at,
    created_at:           t.created_at,
    updated_at:           t.updated_at,
  }))

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>
      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        {defaultType === 'work_order' && (
          <div className="mb-3 flex justify-end">
            <ResyncWorkOrdersButton />
          </div>
        )}
        <TicketListClient
          rows={rows}
          associations={associations ?? []}
          staff={staff}
          countsByStatus={countsByStatus}
          sinceLabel={twelveMonthsAgo.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })}
          baseHref={'/admin/tickets'}
          showWorkOrderColumns={defaultType === 'work_order'}
          lockTypeTo={defaultType === 'all' ? null : defaultType}
          woTypes={woTypes}
          activeFilters={{
            status:      sp.status      ?? 'open_any',
            priority:    sp.priority    ?? '',
            channel:     sp.channel     ?? '',
            association: sp.association ?? '',
            assignee:    sp.assignee    ?? '',
            q:           sp.q           ?? '',
            type:        sp.type        ?? '',
            wo_type:     sp.wo_type     ?? '',
            category:    sp.category    ?? '',
            archived:    sp.archived    ?? '',
          }}
        />
      </main>
    </div>
  )
}
