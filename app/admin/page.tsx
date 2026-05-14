import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from './components/AdminNav'
import Link from 'next/link'

export const metadata = { title: 'Overview — PMI Top Florida' }
export const dynamic = 'force-dynamic'

const STATUS_STYLES: Record<string, string> = {
  open:             'bg-green-100 text-green-800',
  pending:          'bg-yellow-100 text-yellow-800',
  waiting_external: 'bg-blue-100 text-blue-800',
  resolved:         'bg-slate-100 text-slate-700',
  closed:           'bg-gray-200 text-gray-600',
}

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800',
  high:   'bg-orange-100 text-orange-800',
  normal: 'bg-slate-100 text-slate-700',
  low:    'bg-gray-100 text-gray-600',
}

function dueLabel(due: string | null): { text: string; tone: 'overdue' | 'today' | 'soon' | 'later' | 'none' } {
  if (!due) return { text: 'No due date', tone: 'none' }
  const d   = new Date(due)
  const now = new Date()
  const startOfToday = new Date(now); startOfToday.setHours(0,0,0,0)
  const endOfToday   = new Date(startOfToday); endOfToday.setDate(endOfToday.getDate() + 1)
  if (d.getTime() < startOfToday.getTime()) return { text: `Overdue · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, tone: 'overdue' }
  if (d.getTime() < endOfToday.getTime())   return { text: `Due today · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`, tone: 'today' }
  const inDays = Math.ceil((d.getTime() - now.getTime()) / 86_400_000)
  if (inDays <= 3) return { text: `In ${inDays}d · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, tone: 'soon' }
  return { text: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), tone: 'later' }
}

interface TicketRow {
  id:               number
  ticket_number:    string
  type:             string
  status:           string
  priority:         string
  subject:          string | null
  due_at:           string | null
  assignee_email:   string | null
  association_code: string | null
  contact_name:     string | null
}

export default async function OverviewPage() {
  // ── Auth: only staff. Middleware will normally redirect non-staff,
  //    but pulling the session here gives us the email to filter "my
  //    tasks" by assignee_email.
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  // Resolve the canonical PMI work email even when the staffer signed in
  // via their personal_email (so the "my tasks" filter matches the
  // assignee_email that other staff use in @assign commands).
  const loginEmail = typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : ''
  let canonicalEmail = loginEmail
  if (loginEmail) {
    const { data: staffRow } = await supabaseAdmin
      .from('pmi_staff')
      .select('email')
      .or(`email.ilike.${loginEmail},personal_email.ilike.${loginEmail}`)
      .limit(1)
      .maybeSingle()
    if (staffRow?.email) canonicalEmail = staffRow.email.toLowerCase()
  }

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
    { data: recentCommands },
    { data: myTasksRaw },
    { data: workOrdersRaw },
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
      .limit(6),
    canonicalEmail
      ? supabaseAdmin
          .from('tickets')
          .select('id, ticket_number, type, status, priority, subject, due_at, assignee_email, association_code, contact_name')
          .eq('assignee_email', canonicalEmail)
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
      .limit(15),
  ])

  const myTasks    = (myTasksRaw    ?? []) as TicketRow[]
  const workOrders = (workOrdersRaw ?? []) as TicketRow[]

  const pendingReg = (pendingAgents ?? 0) + (pendingVendors ?? 0)
  // Server component renders once per request; "current time" is the
  // correct semantic at request time, not a stale captured value.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now()
  const overdueCount = myTasks.filter(t => t.due_at && new Date(t.due_at).getTime() < nowMs).length

  const alerts = [
    unidentified  && { key: 'unidentified', label: 'Unidentified visitors waiting for review',   count: unidentified,  href: '/admin/pending-approvals', urgent: true  },
    pendingApps   && { key: 'apps',         label: 'Applications awaiting board approval',        count: pendingApps,   href: '/admin/applications',      urgent: true  },
    maiaErrors    && { key: 'maia',         label: 'MAIA command errors',                         count: maiaErrors,    href: '/admin/communications',    urgent: true  },
    pendingReg    && { key: 'reg',          label: 'Agent / vendor registrations pending',        count: pendingReg,    href: '/admin/registrations',     urgent: false },
    complianceCount && { key: 'compliance', label: 'Unresolved compliance alerts',                count: complianceCount, href: '/admin/audit',            urgent: false },
  ].filter(Boolean) as Array<{ key: string; label: string; count: number; href: string; urgent: boolean }>

  const sections = [
    { label: 'Tickets',          href: '/admin/tickets',          badge: totalTickets || null, stats: [`${totalTickets ?? 0} open tickets`] },
    { label: 'Work Orders',      href: '/admin/work-orders',      badge: null,                 stats: [`${workOrders.length} active`] },
    { label: 'Owners',           href: '/admin/owners',           badge: null,                 stats: [`${ownerCount ?? 0} active owners`] },
    { label: 'Applications',     href: '/admin/applications',     badge: pendingApps || null,  stats: [`${pendingApps ?? 0} pending board vote`] },
    { label: 'Registrations',    href: '/admin/registrations',    badge: pendingReg || null,   stats: [`${pendingAgents ?? 0} agents · ${pendingVendors ?? 0} vendors pending`] },
    { label: 'Pending Approvals',href: '/admin/pending-approvals',badge: unidentified || null, stats: [`${unidentified ?? 0} unidentified visitors`] },
    { label: 'Ownership History',href: '/admin/ownership-history',badge: null,                 stats: [`${ownershipTransfers ?? 0} past transfers`] },
    { label: 'Compliance',       href: '/admin/audit',            badge: complianceCount || null, stats: [`${complianceCount ?? 0} unresolved alerts`] },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Control Panel</h1>
            <p className="text-sm text-gray-500 mt-1">
              {myTasks.length > 0
                ? `${myTasks.length} task${myTasks.length === 1 ? '' : 's'} assigned to you${overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}`
                : alerts.length > 0
                  ? `${alerts.length} item${alerts.length !== 1 ? 's' : ''} need attention`
                  : 'All clear — no pending actions'}
            </p>
          </div>
        </div>

        {/* My tasks for the day */}
        <div className="mb-6 bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-[#f26a1b]/5 border-b border-gray-100 px-4 py-2.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-[#f26a1b] uppercase tracking-wide [font-family:var(--font-mono)]">
              My Tasks {overdueCount > 0 && <span className="text-red-600 ml-1">· {overdueCount} overdue</span>}
            </span>
            <Link href="/admin/tickets" className="text-[0.6rem] font-mono text-gray-400 hover:text-gray-600 uppercase tracking-wide">View all →</Link>
          </div>
          {myTasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Nothing assigned to you. Open <Link href="/admin/tickets" className="text-[#f26a1b] hover:underline">/admin/tickets</Link> to pick something up.
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {myTasks.map(t => {
                const due = dueLabel(t.due_at)
                const dueClass =
                  due.tone === 'overdue' ? 'text-red-600 font-medium' :
                  due.tone === 'today'   ? 'text-amber-700 font-medium' :
                  due.tone === 'soon'    ? 'text-gray-700' :
                  'text-gray-400'
                return (
                  <Link
                    key={t.id}
                    href={`/admin/tickets/${t.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 group"
                  >
                    <span className="font-mono text-[10px] text-gray-400 shrink-0 w-[110px]">{t.ticket_number}</span>
                    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase shrink-0 ${STATUS_STYLES[t.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {t.status.replace('_', ' ')}
                    </span>
                    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase shrink-0 ${PRIORITY_STYLES[t.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                      {t.priority}
                    </span>
                    {t.type === 'work_order' && (
                      <span className="bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase shrink-0">WO</span>
                    )}
                    <span className="text-sm text-gray-800 flex-1 truncate group-hover:text-gray-900">
                      {t.subject ?? '(no subject)'}
                    </span>
                    {t.association_code && (
                      <span className="text-[10px] font-mono text-gray-400 shrink-0 hidden md:inline">{t.association_code}</span>
                    )}
                    <span className={`text-[10px] shrink-0 ${dueClass} hidden sm:inline`}>{due.text}</span>
                    <span className="text-gray-300 group-hover:text-[#f26a1b] shrink-0">→</span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Active work orders */}
        <div className="mb-6 bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-purple-50 border-b border-purple-100 px-4 py-2.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-purple-800 uppercase tracking-wide [font-family:var(--font-mono)]">
              Active Work Orders <span className="text-purple-600">· {workOrders.length}</span>
            </span>
            <Link href="/admin/work-orders" className="text-[0.6rem] font-mono text-gray-400 hover:text-gray-600 uppercase tracking-wide">View all →</Link>
          </div>
          {workOrders.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">No active work orders.</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {workOrders.map(t => {
                const due = dueLabel(t.due_at)
                const dueClass =
                  due.tone === 'overdue' ? 'text-red-600 font-medium' :
                  due.tone === 'today'   ? 'text-amber-700 font-medium' :
                  'text-gray-500'
                const isMine = canonicalEmail && t.assignee_email?.toLowerCase() === canonicalEmail
                return (
                  <Link
                    key={t.id}
                    href={`/admin/tickets/${t.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 group"
                  >
                    <span className="font-mono text-[10px] text-gray-400 shrink-0 w-[110px]">{t.ticket_number}</span>
                    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase shrink-0 ${STATUS_STYLES[t.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {t.status.replace('_', ' ')}
                    </span>
                    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase shrink-0 ${PRIORITY_STYLES[t.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                      {t.priority}
                    </span>
                    <span className="text-sm text-gray-800 flex-1 truncate group-hover:text-gray-900">
                      {t.subject ?? '(no subject)'}
                    </span>
                    {t.association_code && (
                      <span className="text-[10px] font-mono text-gray-400 shrink-0 hidden md:inline">{t.association_code}</span>
                    )}
                    {isMine ? (
                      <span className="text-[10px] font-mono text-[#f26a1b] shrink-0 hidden md:inline">mine</span>
                    ) : t.assignee_email ? (
                      <span className="text-[10px] font-mono text-gray-400 shrink-0 hidden md:inline truncate max-w-[140px]">{t.assignee_email}</span>
                    ) : (
                      <span className="text-[10px] font-mono text-gray-300 shrink-0 hidden md:inline">unassigned</span>
                    )}
                    <span className={`text-[10px] shrink-0 ${dueClass} hidden sm:inline`}>{due.text}</span>
                    <span className="text-gray-300 group-hover:text-[#f26a1b] shrink-0">→</span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Cross-team alerts */}
        {alerts.length > 0 && (
          <div className="mb-6 bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-amber-50 border-b border-amber-100 px-4 py-2.5">
              <span className="text-xs font-semibold text-amber-800 uppercase tracking-wide [font-family:var(--font-mono)]">
                Needs Attention (team)
              </span>
            </div>
            <div className="divide-y divide-gray-50">
              {alerts.map(a => (
                <Link
                  key={a.key}
                  href={a.href}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 group"
                >
                  <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold shrink-0 ${a.urgent ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                    {a.count}
                  </div>
                  <span className="text-sm text-gray-700 group-hover:text-gray-900">{a.label}</span>
                  <span className="ml-auto text-gray-300 group-hover:text-[#f26a1b]">→</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Section cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {sections.map(s => (
            <Link
              key={s.label}
              href={s.href}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 hover:shadow-sm transition-all group relative"
            >
              {s.badge !== null && s.badge > 0 && (
                <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-[#f26a1b] text-white text-[10px] font-bold flex items-center justify-center">
                  {s.badge > 99 ? '99+' : s.badge}
                </span>
              )}
              <div className="text-[0.6rem] font-semibold text-gray-400 uppercase tracking-[0.08em] mb-2 [font-family:var(--font-mono)]">
                {s.label}
              </div>
              {s.stats.map(stat => (
                <div key={stat} className="text-sm text-gray-700 leading-snug">{stat}</div>
              ))}
              <div className="mt-3 text-[0.6rem] font-mono text-gray-300 group-hover:text-[#f26a1b] uppercase tracking-wide transition-colors">
                View →
              </div>
            </Link>
          ))}
        </div>

        {/* Recent MAIA activity */}
        {recentCommands && recentCommands.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide [font-family:var(--font-mono)]">
                Recent MAIA Activity
              </span>
              <Link href="/admin/communications" className="text-[0.6rem] font-mono text-gray-400 hover:text-gray-600 uppercase tracking-wide">
                View all →
              </Link>
            </div>
            <div className="divide-y divide-gray-50">
              {recentCommands.map(cmd => (
                <div key={cmd.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    cmd.status === 'error'     ? 'bg-red-400' :
                    cmd.status === 'processed' ? 'bg-green-400' :
                    'bg-gray-300'
                  }`} />
                  <span className="text-[0.6rem] font-mono text-gray-400 shrink-0">
                    {cmd.reference_code || cmd.id.slice(0, 8).toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-700 flex-1 truncate">
                    {cmd.record_type || cmd.sender_email}
                  </span>
                  {cmd.status === 'error' && cmd.error_message && (
                    <span className="text-[10px] text-red-500 truncate max-w-xs hidden md:block">
                      {cmd.error_message}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-300 shrink-0">
                    {new Date(cmd.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
