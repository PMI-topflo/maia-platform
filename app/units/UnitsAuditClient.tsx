'use client'

import { useEffect, useMemo, useState } from 'react'
import FloorPlanGrid, { type AuditUnitEnriched } from './FloorPlanGrid'

export default function UnitsAuditClient({ assoc }: { assoc?: string }) {
  const [data, setData] = useState<{ associationName: string; persona: string; units: AuditUnitEnriched[] } | null>(null)
  const [err, setErr]   = useState<string | null>(null)

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
      total:       u.length,
      complete:    u.filter(x => x.missingCount === 0).length,
      partial:     u.filter(x => x.missingCount > 0 && x.missingCount <= 2).length,
      missing:     u.filter(x => x.missingCount > 2).length,
      leased:      u.filter(x => x.occupancy === 'leased').length,
      vacant:      u.filter(x => x.occupancy === 'vacant').length,
      collections: u.filter(x => x.inCollections).length,
    }
  }, [data])

  if (err)   return <div style={{ padding: 24, color: '#991b1b', font: '500 14px system-ui' }}>Could not load units: {err}</div>
  if (!data) return <div style={{ padding: 24, color: '#6b7280', font: '500 14px system-ui' }}>Loading units…</div>

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px', font: '400 14px system-ui' }}>
      <h1 style={{ font: '700 22px system-ui', margin: '0 0 2px' }}>{data.associationName}</h1>
      <div style={{ color: '#6b7280', marginBottom: 16 }}>Unit audit — {stats.total} units · click any unit to open its full record in a new tab</div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <Stat label="Docs complete"  value={stats.complete}    color="#166534" bg="#dcfce7" />
        <Stat label="1–2 missing"    value={stats.partial}     color="#854d0e" bg="#fef9c3" />
        <Stat label="3+ missing"     value={stats.missing}     color="#991b1b" bg="#fee2e2" />
        <Stat label="Leased"         value={stats.leased}      color="#5b21b6" bg="#ede9fe" />
        <Stat label="Vacant"         value={stats.vacant}      color="#374151" bg="#f3f4f6" />
        <Stat label="In collections" value={stats.collections} color="#991b1b" bg="#fee2e2" />
      </div>

      <FloorPlanGrid units={data.units} />
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
