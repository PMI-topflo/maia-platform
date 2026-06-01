import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveStaffByLoginEmail, staffCandidateEmails } from '@/lib/staff-lookup'
import { policyTypeLabel } from '@/lib/association-insurance'
import { inspectionTypeLabel } from '@/lib/association-safety'
import { currentReportYear, dueDate, sunbizStatus, statusNeedsAttention as sunbizNeedsAttention } from '@/lib/sunbiz'
import { getWeeklyCoverage } from '@/lib/service-visits'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from './components/AdminNav'
import StaffStatsPanel from './components/StaffStatsPanel'
import ControlPanel, {
  type TicketRow,
  type InvoiceDraftRow,
  type ComplianceItem,
  type TeamAlert,
  type MaiaCommandRow,
} from './components/ControlPanel'

export const metadata = { title: 'Control Panel — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function OverviewPage() {
  // ── Auth: only staff. Middleware will normally redirect non-staff,
  //    but pulling the session here gives us the email to filter "my
  //    tasks" by assignee_email.
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  // Resolve every email that could legitimately be on assignee_email for
  // the current staff member (exact match + name-derived alias) so we
  // don't miss tasks because @assign used a different form of the address.
  const loginEmail = typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : ''

  let staffLookupHint: 'none' | 'matched' | 'no_match' = 'none'
  const candidateEmails = new Set<string>()
  if (loginEmail) {
    candidateEmails.add(loginEmail)
    const row = await resolveStaffByLoginEmail(loginEmail)
    if (row) {
      staffLookupHint = 'matched'
      for (const e of staffCandidateEmails(row, loginEmail)) candidateEmails.add(e)
    } else {
      staffLookupHint = 'no_match'
    }
  }
  const candidateList = Array.from(candidateEmails)

  // Recurring-service weekly reporting health (own multi-query rollup —
  // kick it off in parallel with the dashboard's big Promise.all below).
  const coveragePromise = getWeeklyCoverage().catch(
    () => ({ week_of: '', rows: [], total: 0, complete: 0, late: 0, missed: 0, sev: 'nominal' as const }),
  )

  // 120-day expiry horizon for the documents + permits instrument.
  const horizon = new Date()
  horizon.setDate(horizon.getDate() + 120)
  const horizonISO = horizon.toISOString().slice(0, 10)
  // Inspections schedule months out — surface a wider 180-day window.
  const inspHorizon = new Date()
  inspHorizon.setDate(inspHorizon.getDate() + 180)
  const inspHorizonISO = inspHorizon.toISOString().slice(0, 10)

  const [
    { count: unidentified },
    { count: pendingApps },
    { count: pendingAgents },
    { count: pendingVendors },
    { count: totalTickets },
    { count: maiaErrors },
    { count: ownerCount },
    { count: complianceCount },
    { count: ownershipTransfers },
    { data: recentCommandsRaw },
    { data: myTasksRaw },
    { data: workOrdersRaw },
    { data: invoiceDraftsRaw },
    { count: pendingInvoiceCount },
    { data: expInsuranceRaw },
    { data: expPermitsRaw },
    { data: expDocsRaw },
    { data: inspectionsRaw },
    { data: leasesRaw },
    { data: unitInsRaw },
    { data: violationsRaw },
    { data: sunbizAssocsRaw },
    { data: sunbizFilingsRaw },
  ] = await Promise.all([
    supabaseAdmin.from('general_conversations').select('id', { count: 'exact', head: true }).eq('status', 'unidentified'),
    supabaseAdmin.from('applications').select('id', { count: 'exact', head: true }).eq('board_approval_status', 'pending').eq('stripe_payment_status', 'paid'),
    supabaseAdmin.from('real_estate_agents').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabaseAdmin.from('vendors').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabaseAdmin.from('tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'pending', 'waiting_external']),
    supabaseAdmin.from('maia_email_commands').select('id', { count: 'exact', head: true }).eq('status', 'error'),
    supabaseAdmin.from('owners').select('id', { count: 'exact', head: true }).or('status.neq.previous,status.is.null'),
    supabaseAdmin.from('compliance_alerts').select('id', { count: 'exact', head: true }).is('resolved_at', null),
    supabaseAdmin.from('owners').select('id', { count: 'exact', head: true }).eq('status', 'previous'),
    supabaseAdmin
      .from('maia_email_commands')
      .select('id, reference_code, record_type, status, created_at, error_message, sender_email')
      .order('created_at', { ascending: false })
      .limit(8),
    candidateList.length > 0
      ? supabaseAdmin
          .from('tickets')
          .select('id, ticket_number, type, status, priority, subject, due_at, assignee_email, association_code, contact_name')
          .in('assignee_email', candidateList)
          .in('status', ['open', 'pending', 'waiting_external'])
          .order('due_at', { ascending: true, nullsFirst: false })
          .limit(25)
      : Promise.resolve({ data: [] as TicketRow[] }),
    supabaseAdmin
      .from('tickets')
      .select('id, ticket_number, type, status, priority, subject, due_at, assignee_email, association_code, contact_name')
      .eq('type', 'work_order')
      .not('status', 'in', '("resolved","closed")')
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(25),
    supabaseAdmin
      .from('invoice_intake_drafts')
      .select('id, matched_vendor_name, matched_vendor_short_name, extracted_vendor_name, extracted_amount, extracted_association_code, extracted_invoice_number, status, created_at')
      .in('status', ['pending_review', 'needs_vendor', 'duplicate_in_cinc'])
      .order('created_at', { ascending: false })
      .limit(15)
      .then(r => r, () => ({ data: [] as InvoiceDraftRow[], error: null })),
    supabaseAdmin
      .from('invoice_intake_drafts')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending_review', 'needs_vendor', 'duplicate_in_cinc'])
      .then(r => r, () => ({ count: 0, error: null })),
    // ── Expiring documents & permits (fault-tolerant: the insurance
    //    table may not be migrated on every environment yet) ──────────
    supabaseAdmin
      .from('association_insurance_policies')
      .select('id, association_code, policy_type, carrier, expiration_date, coi_storage_path, drive_url')
      .is('archived_at', null)
      .eq('waived', false)
      .not('expiration_date', 'is', null)
      .lte('expiration_date', horizonISO)
      .order('expiration_date', { ascending: true })
      .then(r => r, () => ({ data: [] as Record<string, unknown>[], error: null })),
    supabaseAdmin
      .from('unit_certificate_of_use')
      .select('id, association_code, account_number, city, certificate_number, expiration_date, source_pdf_url')
      .not('expiration_date', 'is', null)
      .lte('expiration_date', horizonISO)
      .order('expiration_date', { ascending: true })
      .then(r => r, () => ({ data: [] as Record<string, unknown>[], error: null })),
    supabaseAdmin
      .from('association_documents')
      .select('id, association_code, category, filename, expiry_date, storage_path, drive_url')
      .is('archived_at', null)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', horizonISO)
      .order('expiry_date', { ascending: true })
      .then(r => r, () => ({ data: [] as Record<string, unknown>[], error: null })),
    supabaseAdmin
      .from('association_safety_inspections')
      .select('id, association_code, inspection_type, building_label, next_due_date, report_storage_path, drive_url')
      .is('archived_at', null)
      .eq('waived', false)
      .not('next_due_date', 'is', null)
      .lte('next_due_date', inspHorizonISO)
      .order('next_due_date', { ascending: true })
      .then(r => r, () => ({ data: [] as Record<string, unknown>[], error: null })),
    // ── Unit-level (per-unit, Drive-tracked) expiring items ──────────
    supabaseAdmin
      .from('unit_leases')
      .select('id, association_code, account_number, tenant_name, lease_end_date, source_pdf_url')
      .in('application_status', ['active', 'approved', 'renewed'])
      .not('lease_end_date', 'is', null)
      .lte('lease_end_date', horizonISO)
      .order('lease_end_date', { ascending: true })
      .then(r => r, () => ({ data: [] as Record<string, unknown>[], error: null })),
    supabaseAdmin
      .from('unit_insurance')
      .select('id, association_code, account_number, carrier, expiration_date, source_pdf_url')
      .not('expiration_date', 'is', null)
      .lte('expiration_date', horizonISO)
      .order('expiration_date', { ascending: true })
      .then(r => r, () => ({ data: [] as Record<string, unknown>[], error: null })),
    supabaseAdmin
      .from('unit_violations')
      .select('id, association_code, account_number, violation_type, resolution_due_date, source_pdf_url')
      .in('status', ['open', 'in_progress', 'escalated'])
      .not('resolution_due_date', 'is', null)
      .lte('resolution_due_date', horizonISO)
      .order('resolution_due_date', { ascending: true })
      .then(r => r, () => ({ data: [] as Record<string, unknown>[], error: null })),
    // Sunbiz: active associations + current-year filings (I8).
    supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .eq('active', true)
      .then(r => r, () => ({ data: [] as Record<string, unknown>[], error: null })),
    supabaseAdmin
      .from('association_annual_reports')
      .select('association_code, filed_date')
      .eq('report_year', currentReportYear())
      .then(r => r, () => ({ data: [] as Record<string, unknown>[], error: null })),
  ])

  const weeklyCoverage = await coveragePromise

  const myTasks       = (myTasksRaw       ?? []) as TicketRow[]
  const workOrders    = (workOrdersRaw    ?? []) as TicketRow[]
  const invoiceDrafts = (invoiceDraftsRaw ?? []) as InvoiceDraftRow[]
  const recentCommands = (recentCommandsRaw ?? []) as MaiaCommandRow[]
  const invoicesCount = pendingInvoiceCount ?? invoiceDrafts.length
  const pendingReg    = (pendingAgents ?? 0) + (pendingVendors ?? 0)

  const srcOf = (storage: unknown, drive: unknown): 'system' | 'drive' | 'none' =>
    storage ? 'system' : drive ? 'drive' : 'none'
  const byDate = (a: { date: string }, b: { date: string }) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

  // 🏢 BUILDING compliance — association / common-area (CINC scope).
  // Master insurance + structural-safety inspections + dated governing
  // & financial documents. These are the 📦 in-system files.
  const buildingItems: ComplianceItem[] = [
    ...((expInsuranceRaw ?? []) as Array<{ association_code: string; policy_type: string; carrier: string | null; expiration_date: string; coi_storage_path: string | null; drive_url: string | null }>).map(p => ({
      scope: 'building' as const, kind: 'insurance' as const,
      label: `${policyTypeLabel(p.policy_type)} insurance${p.carrier ? ` · ${p.carrier}` : ''}`,
      association_code: p.association_code, date: p.expiration_date,
      source: srcOf(p.coi_storage_path, p.drive_url),
      href: `/admin/cinc-sync/${p.association_code}/insurance`,
    })),
    ...((inspectionsRaw ?? []) as Array<{ association_code: string; inspection_type: string; building_label: string | null; next_due_date: string; report_storage_path: string | null; drive_url: string | null }>).map(i => ({
      scope: 'building' as const, kind: 'inspection' as const,
      label: `${inspectionTypeLabel(i.inspection_type)}${i.building_label ? ` · ${i.building_label}` : ''}`,
      association_code: i.association_code, date: i.next_due_date,
      source: srcOf(i.report_storage_path, i.drive_url),
      href: `/admin/cinc-sync/${i.association_code}/safety`,
    })),
    ...((expDocsRaw ?? []) as Array<{ association_code: string; category: string; filename: string; expiry_date: string; storage_path: string | null; drive_url: string | null }>).map(d => ({
      scope: 'building' as const, kind: 'document' as const,
      label: d.filename,
      association_code: d.association_code, date: d.expiry_date,
      source: srcOf(d.storage_path, d.drive_url),
      href: `/admin/cinc-sync/${d.association_code}/documents`,
    })),
    // Sunbiz annual reports — surface associations whose current-year
    // filing needs attention (due soon / overdue / dissolution risk).
    // 📝 metadata source (no document; the confirmation # is the artifact).
    ...(() => {
      const yr = currentReportYear()
      const filed = new Map<string, string | null>()
      for (const f of (sunbizFilingsRaw ?? []) as Array<{ association_code: string; filed_date: string | null }>) {
        filed.set(f.association_code, f.filed_date)
      }
      return ((sunbizAssocsRaw ?? []) as Array<{ association_code: string; association_name: string | null }>)
        .filter(a => sunbizNeedsAttention(sunbizStatus(yr, filed.get(a.association_code) ?? null)))
        .map(a => ({
          scope: 'building' as const, kind: 'sunbiz' as const,
          label: `Sunbiz ${yr} annual report${a.association_name ? ` · ${a.association_name}` : ''}`,
          association_code: a.association_code, date: dueDate(yr),
          source: 'metadata' as const,
          href: `/admin/sunbiz`,
        }))
    })(),
  ].sort(byDate)

  // 🏠 UNIT compliance — per-unit (Drive-tracked). Leases, HO-6
  // insurance, city permits (Certificate of Use), violations.
  const unitItems: ComplianceItem[] = [
    ...((leasesRaw ?? []) as Array<{ association_code: string; account_number: string | null; tenant_name: string | null; lease_end_date: string; source_pdf_url: string | null }>).map(l => ({
      scope: 'unit' as const, kind: 'lease' as const,
      label: `Lease${l.tenant_name ? ` · ${l.tenant_name}` : ''}${l.account_number ? ` · ${l.account_number}` : ''}`,
      association_code: l.association_code, date: l.lease_end_date,
      source: srcOf(null, l.source_pdf_url),
      href: `/admin/cinc-sync/${l.association_code}`,
    })),
    ...((unitInsRaw ?? []) as Array<{ association_code: string; account_number: string | null; carrier: string | null; expiration_date: string; source_pdf_url: string | null }>).map(u => ({
      scope: 'unit' as const, kind: 'unit_insurance' as const,
      label: `Unit insurance${u.carrier ? ` · ${u.carrier}` : ''}${u.account_number ? ` · ${u.account_number}` : ''}`,
      association_code: u.association_code, date: u.expiration_date,
      source: srcOf(null, u.source_pdf_url),
      href: `/admin/cinc-sync/${u.association_code}`,
    })),
    ...((expPermitsRaw ?? []) as Array<{ association_code: string; account_number: string | null; city: string | null; expiration_date: string; source_pdf_url: string | null }>).map(c => ({
      scope: 'unit' as const, kind: 'permit' as const,
      label: `${c.city ?? 'City'} Certificate of Use${c.account_number ? ` · ${c.account_number}` : ''}`,
      association_code: c.association_code, date: c.expiration_date,
      source: srcOf(null, c.source_pdf_url),
      href: `/admin/cinc-sync/${c.association_code}`,
    })),
    ...((violationsRaw ?? []) as Array<{ association_code: string; account_number: string | null; violation_type: string | null; resolution_due_date: string; source_pdf_url: string | null }>).map(v => ({
      scope: 'unit' as const, kind: 'violation' as const,
      label: `Violation${v.violation_type ? ` · ${v.violation_type}` : ''}${v.account_number ? ` · ${v.account_number}` : ''}`,
      association_code: v.association_code, date: v.resolution_due_date,
      source: srcOf(null, v.source_pdf_url),
      href: `/admin/cinc-sync/${v.association_code}`,
    })),
  ].sort(byDate)

  // Server component renders once per request; "now" at request time is
  // the correct semantic, not a stale captured value.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now()
  const overdueCount = myTasks.filter(t => t.due_at && new Date(t.due_at).getTime() < nowMs).length

  // Team-wide attention items surfaced as their own instrument drawer.
  const teamAlerts: TeamAlert[] = [
    unidentified    && { key: 'unidentified', label: 'Unidentified visitors waiting for review', count: unidentified,    href: '/admin/pending-approvals', urgent: true  },
    pendingApps     && { key: 'apps',         label: 'Applications awaiting board approval',      count: pendingApps,     href: '/admin/applications',      urgent: true  },
    maiaErrors      && { key: 'maia',         label: 'MAIA command errors',                       count: maiaErrors,      href: '/admin/communications',    urgent: true  },
    pendingReg      && { key: 'reg',          label: 'Agent / vendor registrations pending',      count: pendingReg,      href: '/admin/registrations',     urgent: false },
    complianceCount && { key: 'compliance',   label: 'Unresolved compliance alerts',              count: complianceCount, href: '/admin/audit',             urgent: false },
  ].filter(Boolean) as TeamAlert[]

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <ControlPanel
          counts={{
            myTasks:            myTasks.length,
            overdue:            overdueCount,
            workOrders:         workOrders.length,
            invoices:           invoicesCount,
            applications:       pendingApps ?? 0,
            registrations:      pendingReg,
            unidentified:       unidentified ?? 0,
            tickets:            totalTickets ?? 0,
            compliance:         complianceCount ?? 0,
            maiaErrors:         maiaErrors ?? 0,
            owners:             ownerCount ?? 0,
            ownershipTransfers: ownershipTransfers ?? 0,
            building:           buildingItems.length,
            unit:               unitItems.length,
          }}
          myTasks={myTasks}
          workOrders={workOrders}
          invoiceDrafts={invoiceDrafts}
          buildingItems={buildingItems}
          unitItems={unitItems}
          teamAlerts={teamAlerts}
          recentCommands={recentCommands}
          candidateList={candidateList}
          staffLookupHint={staffLookupHint}
          recurring={{
            total:  weeklyCoverage.total,
            late:   weeklyCoverage.late,
            missed: weeklyCoverage.missed,
            sev:    weeklyCoverage.sev,
          }}
        />

        {/* Activity analytics — secondary, below the live instruments. */}
        <div className="mt-8">
          <StaffStatsPanel />
        </div>
      </main>
    </div>
  )
}
