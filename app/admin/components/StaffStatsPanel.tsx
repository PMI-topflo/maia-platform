// =====================================================================
// app/admin/components/StaffStatsPanel.tsx
//
// Server Component. Top-of-dashboard rollup of communications +
// tickets activity across every association, with a per-association
// table beneath. Reuses the same getAssociationStats backbone as the
// per-page widget so totals reconcile.
// =====================================================================
import { getStaffStats } from '@/lib/reports/staff-stats'
import type { AssociationStats } from '@/lib/reports/association-stats'

type Props = {
  windowDays?: number
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

function TopCard({
  icon, title, value, sub,
}: {
  icon: string; title: string; value: string; sub: string
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base" aria-hidden>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 [font-family:var(--font-mono)]">
          {title}
        </span>
      </div>
      <div className="text-2xl font-semibold leading-none" style={{ color: 'var(--navy)' }}>
        {value}
      </div>
      <div className="text-xs text-gray-500 mt-2 leading-snug">{sub}</div>
    </div>
  )
}

function statTotal(s: AssociationStats): number {
  return s.messagesReceived.total + s.messagesSent.total + s.tickets.opened + s.tickets.openNow
}

export default async function StaffStatsPanel({ windowDays = 30 }: Props) {
  const data = await getStaffStats({ windowDays })
  const t = data.totals

  // Sort table so the busiest associations float to the top.
  const rows = [...data.perAssoc].sort((a, b) => statTotal(b.stats) - statTotal(a.stats))

  const recvSub = `Email ${t.messagesReceived.byChannel.email} · SMS ${t.messagesReceived.byChannel.sms} · WhatsApp ${t.messagesReceived.byChannel.whatsapp} · Voice ${t.messagesReceived.byChannel.voice}`
  const sentSub = `Email ${t.messagesSent.byChannel.email} · SMS ${t.messagesSent.byChannel.sms} · WhatsApp ${t.messagesSent.byChannel.whatsapp} · Voice ${t.messagesSent.byChannel.voice}`
  const respSub = t.responseTime.threadsAnalyzed === 0
    ? 'No staff-replied threads yet'
    : `Median ${formatMinutes(t.responseTime.medianMinutes)} · ${t.responseTime.threadsAnalyzed} threads`
  const tickSub = `${t.tickets.resolved} resolved · ${t.tickets.openNow} open now${t.tickets.avgResolveHours !== null ? ` · avg ${formatHours(t.tickets.avgResolveHours)}` : ''}`

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide [font-family:var(--font-mono)]">
            Communications &amp; Tickets · last {data.windowDays} days
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Aggregated across every association</p>
        </div>
      </div>

      {/* Top metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <TopCard icon="📥" title="Received" value={String(t.messagesReceived.total)} sub={recvSub} />
        <TopCard icon="📤" title="Sent"     value={String(t.messagesSent.total)}     sub={sentSub} />
        <TopCard
          icon="⏱"
          title="Response Time"
          value={t.responseTime.avgMinutes !== null ? formatMinutes(t.responseTime.avgMinutes) : '—'}
          sub={respSub}
        />
        <TopCard icon="🎫" title="Tickets" value={String(t.tickets.opened)} sub={tickSub} />
      </div>

      {/* Per-association table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide [font-family:var(--font-mono)]">
            Per Association
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 [font-family:var(--font-mono)] border-b border-gray-100">
                <th className="px-4 py-2 font-semibold">Association</th>
                <th className="px-3 py-2 font-semibold text-right">Recv</th>
                <th className="px-3 py-2 font-semibold text-right">Sent</th>
                <th className="px-3 py-2 font-semibold text-right hidden md:table-cell">Avg Reply</th>
                <th className="px-3 py-2 font-semibold text-right">Open Tix</th>
                <th className="px-3 py-2 font-semibold text-right hidden md:table-cell">Opened/Resolved</th>
                <th className="px-3 py-2 font-semibold text-right hidden lg:table-cell">Avg Resolve</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    No associations found.
                  </td>
                </tr>
              ) : rows.map(row => (
                <tr key={row.code} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <div className="text-gray-800">{row.name}</div>
                    <div className="text-[10px] font-mono text-gray-400">{row.code}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.stats.messagesReceived.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.stats.messagesSent.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                    {formatMinutes(row.stats.responseTime.avgMinutes)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.stats.tickets.openNow > 0 ? (
                      <span className="font-semibold" style={{ color: 'var(--gold)' }}>{row.stats.tickets.openNow}</span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell text-gray-500">
                    {row.stats.tickets.opened}/{row.stats.tickets.resolved}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums hidden lg:table-cell text-gray-500">
                    {formatHours(row.stats.tickets.avgResolveHours)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
