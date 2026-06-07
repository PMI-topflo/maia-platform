'use client'

import { useCallback, useEffect, useState } from 'react'

type TabKey = 'pending-agents' | 'pending-vendors' | 'all'

interface Agent {
  id: string; full_name: string; email: string | null; phone: string | null
  license_number: string | null; license_expiry: string | null; brokerage: string | null
  status: string; notes: string | null; created_at: string
}

interface Vendor {
  id: string; company_name: string; contact_name: string | null; email: string | null
  phone: string | null; service_type: string | null; license_number: string | null
  status: string; notes: string | null; coi_on_file: boolean; ach_on_file: boolean
  w9_on_file: boolean; created_at: string
}

interface Props { agents: Agent[]; vendors: Vendor[] }

const STATUS_COLORS: Record<string, string> = {
  pending:  '#f59e0b',
  active:   '#22c55e',
  rejected: '#ef4444',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '12px',
      fontSize: '0.6rem', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em',
      fontWeight: 600, background: `${STATUS_COLORS[status] ?? '#6b7280'}22`,
      color: STATUS_COLORS[status] ?? '#6b7280',
    }}>{status}</span>
  )
}

async function updateStatus(type: 'agent' | 'vendor', id: string, status: string) {
  await fetch(`/api/admin/registrations/update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, id, status }),
  })
  window.location.reload()
}

export default function RegistrationsDashboard({ agents, vendors }: Props) {
  const [tab, setTab] = useState<TabKey>('pending-agents')

  const pendingAgents  = agents.filter(a => a.status === 'pending')
  const pendingVendors = vendors.filter(v => v.status === 'pending')

  const tabs = [
    { key: 'pending-agents'  as TabKey, label: 'Pending Agents',  count: pendingAgents.length },
    { key: 'pending-vendors' as TabKey, label: 'Pending Vendors', count: pendingVendors.length },
    { key: 'all'             as TabKey, label: 'All Registrations' },
  ]

  return (
    <div>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid #e5e7eb', marginBottom: '1.5rem' }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '0.625rem 1.25rem', border: 'none', background: 'transparent', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em',
              color: tab === t.key ? '#f26a1b' : '#6b7280',
              borderBottom: tab === t.key ? '2px solid #f26a1b' : '2px solid transparent',
              marginBottom: '-2px', transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
            }}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span style={{ background: '#f26a1b', color: '#fff', borderRadius: '10px', padding: '1px 6px', fontSize: '0.6rem' }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Pending Agents */}
      {tab === 'pending-agents' && (
        <RegistrationList
          items={pendingAgents.map(a => ({
            id: a.id, type: 'agent' as const,
            title: a.full_name,
            sub:   [a.brokerage, a.license_number].filter(Boolean).join(' · '),
            email: a.email, phone: a.phone,
            meta:  a.notes ?? '', status: a.status,
            date:  new Date(a.created_at).toLocaleDateString(),
            badges: [],
          }))}
        />
      )}

      {/* Pending Vendors */}
      {tab === 'pending-vendors' && (
        <RegistrationList
          items={pendingVendors.map(v => ({
            id: v.id, type: 'vendor' as const,
            title: v.company_name,
            sub:   [v.contact_name, v.service_type].filter(Boolean).join(' · '),
            email: v.email, phone: v.phone,
            meta:  v.notes ?? '', status: v.status,
            date:  new Date(v.created_at).toLocaleDateString(),
            badges: [
              v.coi_on_file ? '✅ COI' : '❌ COI',
              v.ach_on_file ? '✅ ACH' : '❌ ACH',
              v.w9_on_file  ? '✅ W-9' : '❌ W-9',
            ],
          }))}
        />
      )}

      {/* All */}
      {tab === 'all' && (
        <div className="space-y-6">
          <div>
            <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6b7280', marginBottom: '0.75rem' }}>
              Real Estate Agents ({agents.length})
            </h3>
            <RegistrationList
              items={agents.map(a => ({
                id: a.id, type: 'agent' as const,
                title: a.full_name,
                sub: [a.brokerage, a.license_number].filter(Boolean).join(' · '),
                email: a.email, phone: a.phone,
                meta: a.notes ?? '', status: a.status,
                date: new Date(a.created_at).toLocaleDateString(),
                badges: [],
              }))}
            />
          </div>
          <div>
            <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6b7280', marginBottom: '0.75rem' }}>
              Vendors ({vendors.length})
            </h3>
            <RegistrationList
              items={vendors.map(v => ({
                id: v.id, type: 'vendor' as const,
                title: v.company_name,
                sub: [v.contact_name, v.service_type].filter(Boolean).join(' · '),
                email: v.email, phone: v.phone,
                meta: v.notes ?? '', status: v.status,
                date: new Date(v.created_at).toLocaleDateString(),
                badges: [v.coi_on_file ? '✅ COI' : '❌ COI', v.ach_on_file ? '✅ ACH' : '❌ ACH'],
              }))}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function RegistrationList({ items }: {
  items: Array<{ id: string; type: 'agent'|'vendor'; title: string; sub: string; email: string|null; phone: string|null; meta: string; status: string; date: string; badges: string[] }>
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  // In-card stepper: move the open registration to the prev/next item so
  // you can review them one at a time (←/→ keys work too).
  const openIdx = expanded ? items.findIndex(i => i.id === expanded) : -1

  const step = useCallback((delta: number) => {
    setExpanded(cur => {
      if (!cur) return cur
      const i = items.findIndex(it => it.id === cur)
      if (i === -1) return cur
      const next = i + delta
      if (next < 0 || next >= items.length) return cur
      return items[next].id
    })
  }, [items])

  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      if (e.key === 'ArrowLeft')  { e.preventDefault(); step(-1) }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, step])

  useEffect(() => {
    if (!expanded) return
    document.getElementById(`reg-row-${expanded}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [expanded])

  if (items.length === 0) {
    return <p style={{ color: '#9ca3af', fontSize: '0.875rem', textAlign: 'center', padding: '2rem' }}>No registrations in this category.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {items.map(item => (
        <div key={item.id} id={`reg-row-${item.id}`} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden' }}>
          <div
            onClick={() => setExpanded(expanded === item.id ? null : item.id)}
            style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.875rem 1rem', cursor: 'pointer' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: '#0d0d0d', fontSize: '0.875rem' }}>{item.title}</span>
                <StatusBadge status={item.status} />
              </div>
              <div style={{ fontSize: '0.72rem', color: '#9ca3af', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                {item.sub} {item.sub && '·'} {item.date}
              </div>
            </div>
            {item.badges.length > 0 && (
              <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {item.badges.map((b, i) => (
                  <span key={i} style={{ fontSize: '0.65rem', color: b.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{b}</span>
                ))}
              </div>
            )}
            <span style={{ color: '#9ca3af', flexShrink: 0 }}>{expanded === item.id ? '▲' : '▼'}</span>
          </div>

          {expanded === item.id && (
            <div style={{ borderTop: '1px solid #f3f4f6', padding: '1rem', background: '#f9fafb' }}>
              {/* Prev/next stepper — review registrations one at a time (←/→). */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.875rem' }}>
                <span style={{ fontSize: '0.68rem', color: '#9ca3af', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                  {openIdx + 1} of {items.length}
                </span>
                <div style={{ display: 'flex', gap: '0.375rem' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); step(-1) }}
                    disabled={openIdx <= 0}
                    title="Previous — ←"
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.68rem', border: '1px solid #d1d5db', borderRadius: '3px', background: '#fff', color: openIdx <= 0 ? '#d1d5db' : '#374151', cursor: openIdx <= 0 ? 'default' : 'pointer' }}
                  >‹ Prev</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); step(1) }}
                    disabled={openIdx >= items.length - 1}
                    title="Next — →"
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.68rem', border: '1px solid #d1d5db', borderRadius: '3px', background: '#fff', color: openIdx >= items.length - 1 ? '#d1d5db' : '#374151', cursor: openIdx >= items.length - 1 ? 'default' : 'pointer' }}
                  >Next ›</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem', fontSize: '0.8rem' }}>
                {item.email && <div><span style={{ color: '#9ca3af' }}>Email: </span><a href={`mailto:${item.email}`} style={{ color: '#f26a1b' }}>{item.email}</a></div>}
                {item.phone && <div><span style={{ color: '#9ca3af' }}>Phone: </span><a href={`tel:${item.phone}`} style={{ color: '#f26a1b' }}>{item.phone}</a></div>}
              </div>
              {item.meta && (
                <div style={{ fontSize: '0.75rem', color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '0.625rem', marginBottom: '1rem', whiteSpace: 'pre-line' }}>
                  {item.meta}
                </div>
              )}
              {item.status === 'pending' && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => updateStatus(item.type, item.id, 'active')}
                    style={{ padding: '0.5rem 1rem', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}
                  >
                    ✅ Approve
                  </button>
                  <button
                    onClick={() => updateStatus(item.type, item.id, 'rejected')}
                    style={{ padding: '0.5rem 1rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}
                  >
                    ❌ Reject
                  </button>
                  {item.email && (
                    <a
                      href={`mailto:${item.email}?subject=Your PMI Top Florida Registration&body=Hi, we need additional information about your registration.`}
                      style={{ padding: '0.5rem 1rem', background: '#f3f4f6', color: '#374151', textDecoration: 'none', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}
                    >
                      📧 Request Info
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
