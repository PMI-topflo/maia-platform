// =====================================================================
// app/admin/help/page.tsx
// Server component — staff help page. Quick-access link grid at the top,
// then the full ticket-management procedure broken into sections.
// =====================================================================

import Link from 'next/link'
import type { ReactNode } from 'react'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'

export const metadata = { title: 'Help — PMI Top Florida' }

// ─────────────────────────────────────────────────────────────────────
// Quick-access link tiles — what staff use most.
// ─────────────────────────────────────────────────────────────────────
const QUICK_LINKS: Array<{ label: string; href: string; desc: string; emoji: string; external?: boolean }> = [
  { emoji: '🎫', label: 'Tickets',           href: '/admin/tickets',            desc: 'Open tickets, triage, reply' },
  { emoji: '🔧', label: 'Work Orders',       href: '/admin/work-orders',        desc: 'Vendor work orders' },
  { emoji: '📊', label: 'Overview',          href: '/admin',                    desc: 'All-up dashboard' },
  { emoji: '👥', label: 'Owners',            href: '/admin/owners',             desc: 'Owner directory' },
  { emoji: '✅', label: 'Approvals',         href: '/admin/pending-approvals',  desc: 'Items awaiting board' },
  { emoji: '📋', label: 'Applications',      href: '/admin/applications',       desc: 'Lease + purchase apps' },
  { emoji: '🆔', label: 'Registrations',     href: '/admin/registrations',      desc: 'Pending agents + vendors' },
  { emoji: '🔁', label: 'Ownership History', href: '/admin/ownership-history',  desc: 'Past transfers' },
  { emoji: '🏠', label: 'Tenancy History',   href: '/admin/tenancy-history',    desc: 'Past tenant moves' },
  { emoji: '🔐', label: 'Login History',     href: '/admin/login-history',      desc: 'Staff login audit' },
  { emoji: '🛠',  label: 'Tools',             href: '/admin/tools',              desc: 'Connect Gmail accounts' },
  { emoji: '💬', label: 'Communications',    href: '/admin/communications',     desc: 'Legacy view' },
]

const EXTERNAL_LINKS: Array<{ label: string; href: string; desc: string; emoji: string }> = [
  { emoji: '📨', label: 'Inbox: maia@pmitop.com',  href: 'https://mail.google.com/',                 desc: 'Forward / BCC to open tickets' },
  { emoji: '🏦', label: 'CINC Owner Portal',       href: 'https://pmitfp.cincwebaxis.com/',          desc: 'Financials, invoices' },
  { emoji: '🏠', label: 'Owner Self-Service',      href: '/my-account',                              desc: 'Customer-facing' },
  { emoji: '🪟', label: 'Embed Widget',            href: '/widget',                                  desc: 'AI chat for partner sites' },
]

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-lg mx-auto px-6 py-6">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Staff Help</h1>
          <p className="text-sm text-gray-500 mt-1">
            How to manage tickets — start in Gmail, work in the dashboard. All your tools in one place.
          </p>
        </div>

        {/* Quick links grid */}
        <Section title="Quick access">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {QUICK_LINKS.map(l => (
              <Link
                key={l.href}
                href={l.href}
                className="bg-white border border-gray-200 rounded-lg p-3 hover:border-[#f26a1b] hover:shadow-sm transition-all"
              >
                <div className="text-xl mb-1">{l.emoji}</div>
                <div className="text-sm font-medium text-gray-900">{l.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{l.desc}</div>
              </Link>
            ))}
          </div>
        </Section>

        <Section title="External links">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {EXTERNAL_LINKS.map(l => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="bg-white border border-gray-200 rounded-lg p-3 hover:border-[#f26a1b] hover:shadow-sm transition-all block"
              >
                <div className="text-xl mb-1">{l.emoji}</div>
                <div className="text-sm font-medium text-gray-900">{l.label} <span className="text-xs text-gray-400">↗</span></div>
                <div className="text-xs text-gray-500 mt-0.5">{l.desc}</div>
              </a>
            ))}
          </div>
        </Section>

        {/* How tickets are born */}
        <Section title="1 · How tickets are created">
          <p className="text-sm text-gray-700 mb-3">
            Tickets are created automatically — staff never open them by hand. Every inbound message arrives, the
            system tries to thread it onto an existing open ticket, and otherwise creates a new one with a
            <code className="bg-gray-100 px-1 rounded text-xs ml-1">TKT-2026-NNNN</code> number.
          </p>
          <Table
            head={['Channel', 'Inbound address', 'What happens']}
            rows={[
              ['📧 Email',     <code key="e" className="bg-gray-100 px-1 rounded">maia@pmitop.com</code>, 'Gmail Pub/Sub fires → ticket created or appended by Gmail thread ID'],
              ['📱 SMS',       'Your Twilio SMS number', 'Threaded by phone within a 14-day window'],
              ['💬 WhatsApp',  'Your Twilio WhatsApp number', 'Same as SMS, channel="whatsapp"'],
              ['📞 Phone',     'Your Twilio voice number', 'Voice transcript logged as channel="phone"'],
              ['🌐 Web',       <Link key="w" href="/widget" className="text-[#f26a1b] hover:underline">/widget</Link>, 'AI chat widget on partner sites'],
            ]}
          />
          <Callout>
            <strong>Auto-threading order:</strong> 1) Gmail thread ID match → append · 2) Same email/phone +
            association, open status, within 14 days → append · 3) Otherwise create a new ticket.
          </Callout>
        </Section>

        {/* Gmail procedures */}
        <Section title="2 · Opening a ticket from Gmail">
          <p className="text-sm text-gray-700 mb-3">
            Tickets are created only when a staff member sends an email from a PMI domain
            (<code className="bg-gray-100 px-1 rounded">@topfloridaproperties.com</code>,
            <code className="bg-gray-100 px-1 rounded ml-1">@pmitop.com</code>,
            <code className="bg-gray-100 px-1 rounded ml-1">@mypmitop.com</code>) <strong>and</strong> the body contains
            one of the trigger phrases below. External emails are logged but never auto-create tickets — staff promote
            them by forwarding from a PMI inbox with a trigger.
          </p>

          <h3 className="text-sm font-semibold text-gray-900 mt-4 mb-2">Trigger phrases — any one of these creates a ticket</h3>
          <CodeBlock>
{`@maia ticket
@maia create ticket
@maia open ticket
@maia ct
@ticket`}
          </CodeBlock>

          <h3 className="text-sm font-semibold text-gray-900 mt-5 mb-2">Inline modifiers (anywhere in the body)</h3>
          <Table
            head={['Modifier', 'Effect']}
            rows={[
              [<code className="bg-gray-100 px-1 rounded">@assign jane@pmitop.com</code>, 'Sets the assignee. Sends a courtesy notification email to the new assignee with a link to the ticket.'],
              [<code className="bg-gray-100 px-1 rounded">@priority urgent</code>, 'Sets priority (urgent / high / normal / low). Recomputes the SLA due_at.'],
              [<code className="bg-gray-100 px-1 rounded">@workorder</code>, 'Creates as a work order instead of a ticket.'],
            ]}
          />

          <h3 className="text-sm font-semibold text-gray-900 mt-5 mb-2">Example — ticket assigned to a teammate</h3>
          <CodeBlock>
{`Subject: Plumbing leak — Serenity Place IV unit 6

@maia ticket @assign jane@pmitop.com @priority high

Tenant called about a leak under the kitchen sink.
Needs vendor dispatched by tomorrow morning.`}
          </CodeBlock>
          <p className="text-sm text-gray-700 mt-2">
            → Ticket created with that subject, priority=high, assigned to Jane. Jane receives an email
            <em> "You've been assigned TKT-XXXX"</em> with a button to open it.
          </p>

          <h3 className="text-sm font-semibold text-gray-900 mt-5 mb-2">Threading</h3>
          <ul className="text-sm text-gray-700 space-y-1 list-disc pl-5">
            <li>Replying in an existing ticket thread <strong>always</strong> appends to that ticket — no trigger needed.</li>
            <li>If you send a new <code className="bg-gray-100 px-1 rounded">@maia ticket</code> with the same subject as an open ticket from the same contact within 30 days, it appends instead of creating a duplicate.</li>
          </ul>

          <h3 className="text-sm font-semibold text-gray-900 mt-5 mb-2">DB-update commands (separate from tickets)</h3>
          <p className="text-sm text-gray-700 mb-2">
            These are existing MAIA commands for owner / tenant / board changes — they update the database, they don't create tickets.
          </p>
          <CodeBlock>
{`@maia add owner
@maia add tenant
@maia add board member
@maia add agent
@maia add vendor
@maia update owner / @maia update unit / @maia update db`}
          </CodeBlock>

          <Callout>
            <strong>No trigger? No ticket.</strong> Forwarding or BCCing <code className="bg-blue-100 px-1 rounded">maia@pmitop.com</code> without
            one of the trigger phrases just logs the email — it doesn't open a ticket. Add <code className="bg-blue-100 px-1 rounded">@maia ticket</code> to the body to capture it.
          </Callout>
        </Section>

        {/* Dashboard daily flow */}
        <Section title="3 · Daily triage in the dashboard">
          <Steps items={[
            <>Open <Link href="/admin/tickets" className="text-[#f26a1b] hover:underline">/admin/tickets</Link>. The default landing tab is <strong>Open</strong> (Open + Pending + Waiting combined).</>,
            <>Look for red <span className="bg-red-100 text-red-800 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase">overdue</span> badges — anything past its <code className="bg-gray-100 px-1 rounded">due_at</code> SLA.</>,
            <>Click a row → opens the detail page with a full timeline (messages + audit events).</>,
            <>In the right sidebar, set <strong>Status</strong>, <strong>Priority</strong>, and <strong>Assignee</strong>. All changes are audited in the timeline.</>,
            <>In the reply box, pick a channel tab (<strong>✉️ Email</strong>, <strong>📱 SMS</strong>, <strong>💬 WhatsApp</strong>, or <strong>📝 Internal note</strong>) and send. Disabled tabs mean the ticket has no contact field for that channel.</>,
          ]} />
        </Section>

        {/* Status / SLA */}
        <Section title="4 · Statuses and SLAs">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">What each status means</h3>
          <Table
            head={['Status', 'Meaning']}
            rows={[
              [<Badge cls="bg-green-100 text-green-800">open</Badge>,             'Fresh, awaiting first response'],
              [<Badge cls="bg-yellow-100 text-yellow-800">pending</Badge>,        'Staff is actively working it'],
              [<Badge cls="bg-blue-100 text-blue-800">waiting external</Badge>,   "Ball is in the customer's or vendor's court"],
              [<Badge cls="bg-slate-100 text-slate-700">resolved</Badge>,         'Work done, awaiting customer confirmation'],
              [<Badge cls="bg-gray-200 text-gray-600">closed</Badge>,             'Done and confirmed'],
            ]}
          />

          <h3 className="text-sm font-semibold text-gray-900 mt-5 mb-2">SLA targets (auto-set by priority)</h3>
          <Table
            head={['Priority', 'Default due_at']}
            rows={[
              [<Badge cls="bg-red-100 text-red-800">urgent</Badge>,    '+4 hours'],
              [<Badge cls="bg-orange-100 text-orange-800">high</Badge>, '+24 hours'],
              [<Badge cls="bg-slate-100 text-slate-700">normal</Badge>, '+72 hours (3 days)'],
              [<Badge cls="bg-gray-100 text-gray-600">low</Badge>,      '+168 hours (7 days)'],
            ]}
          />
          <p className="text-xs text-gray-500 mt-2">
            Changing priority recalculates <code className="bg-gray-100 px-1 rounded">due_at</code> automatically.
          </p>
        </Section>

        {/* Work orders */}
        <Section title="5 · Work orders">
          <p className="text-sm text-gray-700 mb-3">
            <Link href="/admin/work-orders" className="text-[#f26a1b] hover:underline">/admin/work-orders</Link> is the same list, locked to <code className="bg-gray-100 px-1 rounded">type=work_order</code>, with extra columns reserved for vendor and scheduled date.
          </p>
          <p className="text-sm text-gray-700">
            To convert a ticket into a work order: open it, change the <strong>Type</strong> dropdown to <em>work_order</em>. The ticket keeps its number and full message history.
          </p>
        </Section>

        {/* Known gaps */}
        <Section title="6 · Known gaps">
          <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5">
            <li><strong>Rentvine sync:</strong> waiting on Rentvine support for the actual API endpoint names. The outbox table queues syncs in the meantime.</li>
            <li><strong>CINC sync:</strong> stubbed behind <code className="bg-gray-100 px-1 rounded">CINC_SYNC_ENABLED</code>; will wire when credentials arrive.</li>
            <li><strong>Tenant lease cron</strong> (<code className="bg-gray-100 px-1 rounded">/api/cron/sync-rentvine-tenants</code>) is hitting the wrong base URL; will fix when the Rentvine docs land.</li>
            <li><strong>Inline <code className="bg-gray-100 px-1 rounded">@maia close</code></strong> from Gmail isn't wired yet — use the dashboard to close tickets. (<code className="bg-gray-100 px-1 rounded">@assign</code> and <code className="bg-gray-100 px-1 rounded">@priority</code> work today at create time.)</li>
            <li><strong>Vendor portal:</strong> vendors get email and reply via email; no magic-link portal yet.</li>
            <li><strong>Assignee:</strong> free-text email today; no avatar picker.</li>
          </ul>
        </Section>

        <p className="text-xs text-gray-400 text-center mt-8 mb-4">
          Last updated 2026-05-07 · branch <code>claude/gmail-ticket-management-p049V</code>
        </p>
      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Building blocks
// ─────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-gray-900 mb-3">{title}</h2>
      {children}
    </section>
  )
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="border border-gray-200 rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            {head.map(h => (
              <th key={h} className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-gray-100">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 text-gray-700 align-top">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="text-sm text-gray-700 space-y-2 list-decimal pl-5">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ol>
  )
}

function Callout({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  const cls = tone === 'warn'
    ? 'bg-yellow-50 border-yellow-200 text-yellow-900'
    : 'bg-blue-50 border-blue-200 text-blue-900'
  return (
    <div className={`mt-3 border rounded p-3 text-sm ${cls}`}>{children}</div>
  )
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-gray-900 text-gray-100 rounded p-3 text-xs overflow-x-auto whitespace-pre">
{children}
    </pre>
  )
}

function Badge({ cls, children }: { cls: string; children: ReactNode }) {
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${cls}`}>{children}</span>
  )
}
