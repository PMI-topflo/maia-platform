// =====================================================================
// components/AssociationStatsWidget.tsx
//
// Server Component. Renders a single card showing Communications &
// Tickets activity for one association over a window (default 30 days).
//
// Visibility: only board members of THIS association and PMI staff see
// the widget. Owners and tenants see nothing (returns null). The
// AssociationPortalGate is a client component and doesn't differentiate
// roles, so we do that check here against the maia_session cookie.
// =====================================================================
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getAssociationStats, type AssociationStats } from '@/lib/reports/association-stats'

type Props = {
  associationCode: string
  windowDays?:     number
}

function formatMinutes(min: number | null): string {
  if (min === null) return '—'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function formatHours(h: number | null): string {
  if (h === null) return '—'
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  const rem = h % 24
  return rem === 0 ? `${d}d` : `${d}d ${rem}h`
}

function MetricBlock({
  icon, title, value, lines,
}: {
  icon:  string
  title: string
  value: string
  lines: string[]
}) {
  return (
    <div className="border-t border-gray-100 first:border-t-0 px-5 py-3.5">
      <div className="flex items-baseline gap-2">
        <span className="text-base shrink-0" aria-hidden>{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 [font-family:var(--font-mono)]">
          {title}
        </span>
        <span className="ml-auto text-lg font-semibold" style={{ color: 'var(--navy)' }}>
          {value}
        </span>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="text-xs text-gray-600 mt-1 ml-7 leading-relaxed">{l}</div>
      ))}
    </div>
  )
}

export default async function AssociationStatsWidget({ associationCode, windowDays = 30 }: Props) {
  // ── Role gate ─────────────────────────────────────────────────────
  // Only board members of this association (or PMI staff) see this card.
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session) return null
  const allowedAsStaff = session.persona === 'staff'
  const allowedAsBoard = session.persona === 'board'
    && session.associationCode.toUpperCase() === associationCode.toUpperCase()
  if (!allowedAsStaff && !allowedAsBoard) return null

  // ── Data ──────────────────────────────────────────────────────────
  let stats: AssociationStats
  try {
    stats = await getAssociationStats(associationCode, { windowDays })
  } catch (err) {
    console.error('[AssociationStatsWidget] getAssociationStats failed:', err)
    return null
  }

  const r = stats.messagesReceived
  const s = stats.messagesSent
  const rChannelLine = `Email ${r.byChannel.email} · SMS ${r.byChannel.sms} · WhatsApp ${r.byChannel.whatsapp} · Voice ${r.byChannel.voice}`
  const rContactLine = `Board ${r.byContact.board} · Owners ${r.byContact.owner} · Tenants ${r.byContact.tenant} · Other ${r.byContact.other}`
  const sChannelLine = `Email ${s.byChannel.email} · SMS ${s.byChannel.sms} · WhatsApp ${s.byChannel.whatsapp} · Voice ${s.byChannel.voice}`
  const sContactLine = `Board ${s.byContact.board} · Owners ${s.byContact.owner} · Tenants ${s.byContact.tenant} · Other ${s.byContact.other}`

  const ticketSummary = `${stats.tickets.opened} opened · ${stats.tickets.resolved} resolved · ${stats.tickets.openNow} open now`
  const ticketResolve = stats.tickets.avgResolveHours !== null
    ? `Avg time to resolve: ${formatHours(stats.tickets.avgResolveHours)}`
    : 'No resolution data in window'

  const respLine = stats.responseTime.threadsAnalyzed === 0
    ? 'No staff-replied email threads in window'
    : `Avg first reply: ${formatMinutes(stats.responseTime.avgMinutes)} · Median: ${formatMinutes(stats.responseTime.medianMinutes)} (${stats.responseTime.threadsAnalyzed} threads)`

  return (
    <section className="section">
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div
          className="flex items-center justify-between px-5 py-3 border-b border-gray-100"
          style={{ background: 'rgba(242,106,27,0.05)' }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider [font-family:var(--font-mono)]" style={{ color: 'var(--gold)' }}>
            Communications &amp; Tickets — last {stats.windowDays} days
          </span>
          <span className="text-[10px] font-mono text-gray-400">{associationCode.toUpperCase()}</span>
        </div>

        <MetricBlock
          icon="📥"
          title="Received"
          value={String(r.total)}
          lines={[rChannelLine, rContactLine]}
        />
        <MetricBlock
          icon="📤"
          title="Sent"
          value={String(s.total)}
          lines={[sChannelLine, sContactLine]}
        />
        <MetricBlock
          icon="⏱"
          title="Response Time"
          value={stats.responseTime.avgMinutes !== null ? formatMinutes(stats.responseTime.avgMinutes) : '—'}
          lines={[respLine]}
        />
        <MetricBlock
          icon="🎫"
          title="Tickets"
          value={String(stats.tickets.opened)}
          lines={[ticketSummary, ticketResolve]}
        />
      </div>
    </section>
  )
}
