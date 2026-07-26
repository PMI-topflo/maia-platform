import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import UnitsAuditClient from './UnitsAuditClient'

export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['board', 'building_manager', 'unit_manager', 'staff'])

export default async function UnitsPage(props: { searchParams: Promise<{ assoc?: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || !ALLOWED.has(session.persona)) redirect('/')

  // Staff may target any association via ?assoc=; board/managers are bound to
  // their own (the API re-resolves + enforces this — the param is only a hint).
  const { assoc } = await props.searchParams
  const forStaff = session.persona === 'staff' ? (assoc?.toUpperCase() || undefined) : undefined

  if (session.persona === 'staff' && !forStaff) {
    return (
      <div style={{ maxWidth: 640, margin: '60px auto', padding: 24, font: '400 15px system-ui', color: '#374151' }}>
        <h1 style={{ font: '700 20px system-ui' }}>Unit audit</h1>
        <p>Add <code>?assoc=CODE</code> to view an association (e.g. <a href="/units?assoc=MANXI">/units?assoc=MANXI</a>).</p>
      </div>
    )
  }

  return <UnitsAuditClient assoc={forStaff} />
}
