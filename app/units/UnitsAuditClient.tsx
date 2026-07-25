'use client'

import { useEffect, useMemo, useState } from 'react'
import type { AuditUnit } from '@/lib/association-audit'
import FloorPlanGrid from './FloorPlanGrid'

const OCC_LABEL: Record<string, string> = {
  owner_occupied: 'Owner-occupied', leased: 'Leased', vacant: 'Vacant',
}

export default function UnitsAuditClient({ assoc }: { assoc?: string }) {
  const [data, setData]     = useState<{ associationName: string; persona: string; units: AuditUnit[] } | null>(null)
  const [err, setErr]       = useState<string | null>(null)
  const [selected, setSel]  = useState<AuditUnit | null>(null)

  useEffect(() => {
    const q = assoc ? `?assoc=${encodeURIComponent(assoc)}` : ''
    fetch(`/api/units/audit${q}`, { credentials: 'include' })
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`); return r.json() })
      .then(setData)
      .catch(e => setErr(String(e.message ?? e)))
  }, [assoc])

  const stats = useMemo(() => {
    const u = data?.units ?? []
    return {
      total:    u.length,
      complete: u.filter(x => x.missingCount === 0).length,
      partial:  u.filter(x => x.missingCount > 0 && x.missingCount <= 2).length,
      missing:  u.filter(x => x.missingCount > 2).length,
      leased:   u.filter(x => x.occupancy === 'leased').length,
      vacant:   u.filter(x => x.occupancy === 'vacant').length,
      noOcc:    u.filter(x => !x.occupancy).length,
    }
  }, [data])

  if (err)  return <div style={{ padding: 24, color: '#991b1b', font: '500 14px system-ui' }}>Could not load units: {err}</div>
  if (!data) return <div style={{ padding: 24, color: '#6b7280', font: '500 14px system-ui' }}>Loading units…</div>

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px', font: '400 14px system-ui' }}>
      <h1 style={{ font: '700 22px system-ui', margin: '0 0 2px' }}>{data.associationName}</h1>
      <div style={{ color: '#6b7280', marginBottom: 16 }}>Unit audit — {stats.total} units</div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <Stat label="Docs complete" value={stats.complete} color="#166534" bg="#dcfce7" />
        <Stat label="1–2 missing"   value={stats.partial}  color="#854d0e" bg="#fef9c3" />
        <Stat label="3+ missing"    value={stats.missing}  color="#991b1b" bg="#fee2e2" />
        <Stat label="Leased"        value={stats.leased}   color="#5b21b6" bg="#ede9fe" />
        <Stat label="Vacant"        value={stats.vacant}   color="#374151" bg="#f3f4f6" />
        <Stat label="Occupancy not set" value={stats.noOcc} color="#374151" bg="#f3f4f6" />
      </div>

      <FloorPlanGrid units={data.units} selected={selected?.accountNumber ?? null} onSelect={setSel} />

      {selected && <UnitDrawer unit={selected} onClose={() => setSel(null)} />}
    </div>
  )
}

function Stat({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div style={{ background: bg, color, borderRadius: 10, padding: '8px 14px', minWidth: 92 }}>
      <div style={{ font: '700 20px system-ui' }}>{value}</div>
      <div style={{ font: '500 11px system-ui', opacity: 0.85 }}>{label}</div>
    </div>
  )
}

function UnitDrawer({ unit, onClose }: { unit: AuditUnit; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', justifyContent: 'flex-end', zIndex: 50 }} onClick={onClose}>
      <div style={{ width: 420, maxWidth: '92vw', height: '100%', background: '#fff', boxShadow: '-4px 0 16px rgba(0,0,0,0.12)', padding: 24, overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div>
            <div style={{ font: '700 20px system-ui' }}>Unit {unit.unit}</div>
            <div style={{ color: '#6b7280', font: '500 12px system-ui' }}>{unit.accountNumber}{unit.floor != null ? ` · Floor ${unit.floor}, line ${String(unit.line).padStart(2, '0')}` : ''}</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', font: '600 20px system-ui', cursor: 'pointer', color: '#6b7280' }}>×</button>
        </div>

        <Section title="Owner">{unit.ownerName || '—'}</Section>
        <Section title="Occupancy">{unit.occupancy ? OCC_LABEL[unit.occupancy] : <span style={{ color: '#b45309' }}>Not set</span>}</Section>
        {unit.occupancy === 'leased' && (
          <Section title="Tenant">{unit.tenantName || '—'}{unit.leaseEndDate ? ` · lease ends ${unit.leaseEndDate}` : ''}</Section>
        )}

        <Section title={`Documents on file (${unit.onFileKeys.length}/${unit.requiredKeys.length})`}>
          {unit.requiredKeys.length === 0 ? '—' : (
            <ul style={{ margin: '4px 0 0', paddingLeft: 0, listStyle: 'none' }}>
              {unit.requiredKeys.map(k => {
                const have = unit.onFileKeys.includes(k)
                const label = unit.missing.find(m => m.key === k)?.label ?? k
                return (
                  <li key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', font: '500 13px system-ui' }}>
                    <span style={{ color: have ? '#16a34a' : '#dc2626' }}>{have ? '✓' : '✕'}</span>
                    <span style={{ color: have ? '#374151' : '#991b1b' }}>{label}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <div style={{ marginTop: 20, padding: 12, background: '#f9fafb', borderRadius: 8, color: '#6b7280', font: '500 12px system-ui' }}>
          Balance / collections, occupancy editing, and document upload load here next.
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ font: '600 11px system-ui', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 4 }}>{title}</div>
      <div style={{ font: '500 14px system-ui', color: '#111827' }}>{children}</div>
    </div>
  )
}
