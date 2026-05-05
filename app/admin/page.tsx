import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from './components/AdminNav'
import Link from 'next/link'

export const metadata = { title: 'Overview — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function OverviewPage() {
  const [
    { count: unidentified },
    { count: pendingApps },
    { count: pendingAgents },
    { count: pendingVendors },
    { count: totalTickets },
    { count: maiaErrors },
    { count: ownerCount },
    { count: tenantCount },
    { count: complianceCount },
    { count: ownershipTransfers },
    { count: totalConvs },
    { data: recentCommands },
  ] = await Promise.all([
    supabaseAdmin.from('general_conversations').select('id', { count: 'exact', head: true }).eq('status', 'unidentified'),
    supabaseAdmin.from('applications').select('id', { count: 'exact', head: true }).eq('board_approval_status', 'pending').eq('stripe_payment_status', 'paid'),
    supabaseAdmin.from('real_estate_agents').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabaseAdmin.from('vendors').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabaseAdmin.from('board_tickets').select('id', { count: 'exact', head: true }).neq('status', 'resolved').neq('status', 'closed'),
    supabaseAdmin.from('maia_email_commands').select('id', { count: 'exact', head: true }).eq('status', 'error'),
    supabaseAdmin.from('owners').select('id', { count: 'exact', head: true }).or('status.neq.previous,status.is.null'),
    supabaseAdmin.from('association_tenants').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabaseAdmin.from('compliance_alerts').select('id', { count: 'exact', head: true }).is('resolved_at', null),
    supabaseAdmin.from('owners').select('id', { count: 'exact', head: true }).eq('status', 'previous'),
    supabaseAdmin.from('general_conversations').select('id', { count: 'exact', head: true }),
    supabaseAdmin
      .from('maia_email_commands')
      .select('id, reference_code, record_type, status, created_at, error_message, sender_email')
      .order('created_at', { ascending: false })
      .limit(6),
  ])

  const pendingReg = (pendingAgents ?? 0) + (pendingVendors ?? 0)

  const alerts = [
    unidentified  && { key: 'unidentified', label: 'Unidentified visitors waiting for review',   count: unidentified,  href: '/admin/pending-approvals', urgent: true  },
    pendingApps   && { key: 'apps',         label: 'Applications awaiting board approval',        count: pendingApps,   href: '/admin/applications',      urgent: true  },
    maiaErrors    && { key: 'maia',         label: 'MAIA command errors',                         count: maiaErrors,    href: '/admin/communications',    urgent: true  },
    pendingReg    && { key: 'reg',          label: 'Agent / vendor registrations pending',        count: pendingReg,    href: '/admin/registrations',     urgent: false },
    totalTickets  && { key: 'tickets',      label: 'Open support tickets',                        count: totalTickets,  href: '/admin/communications',    urgent: false },
    complianceCount && { key: 'compliance', label: 'Unresolved compliance alerts',                count: complianceCount, href: '/admin/audit',            urgent: false },
  ].filter(Boolean) as Array<{ key: string; label: string; count: number; href: string; urgent: boolean }>

  const sections = [
    {
      label: 'Owners',
      href: '/admin/owners',
      badge: null,
      stats: [`${ownerCount ?? 0} active owners`],
    },
    {
      label: 'Applications',
      href: '/admin/applications',
      badge: pendingApps || null,
      stats: [`${pendingApps ?? 0} pending board vote`],
    },
    {
      label: 'Registrations',
      href: '/admin/registrations',
      badge: pendingReg || null,
      stats: [`${pendingAgents ?? 0} agents · ${pendingVendors ?? 0} vendors pending`],
    },
    {
      label: 'Pending Approvals',
      href: '/admin/pending-approvals',
      badge: unidentified || null,
      stats: [`${unidentified ?? 0} unidentified visitors`],
    },
    {
      label: 'Communications',
      href: '/admin/communications',
      badge: totalTickets || null,
      stats: [`${totalTickets ?? 0} open tickets`],
    },
    {
      label: 'Omnichannel',
      href: '/admin/omnichannel',
      badge: null,
      stats: [`${tenantCount ?? 0} active tenants`, `${totalConvs ?? 0} conversations`],
    },
    {
      label: 'Ownership History',
      href: '/admin/ownership-history',
      badge: null,
      stats: [`${ownershipTransfers ?? 0} past transfers`],
    },
    {
      label: 'Compliance',
      href: '/admin/audit',
      badge: complianceCount || null,
      stats: [`${complianceCount ?? 0} unresolved alerts`],
    },
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
              {alerts.length > 0
                ? `${alerts.length} item${alerts.length !== 1 ? 's' : ''} need attention`
                : 'All clear — no pending actions'}
            </p>
          </div>
        </div>

        {/* Alerts */}
        {alerts.length > 0 && (
          <div className="mb-6 bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-amber-50 border-b border-amber-100 px-4 py-2.5">
              <span className="text-xs font-semibold text-amber-800 uppercase tracking-wide">
                Needs Attention
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
