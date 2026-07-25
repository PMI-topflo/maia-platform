'use client'

// Building floor-plan grid: floors as rows (top floor at the top, like the
// real building), lines as columns. Each cell is a unit, colored by audit
// completeness with an occupancy dot. Units whose number isn't floor×100+line
// (no floor/line) are listed below the grid as an "Other units" row.

import type { AuditUnit } from '@/lib/association-audit'

const OCC_DOT: Record<string, string> = {
  owner_occupied: '#2563eb', // blue
  leased:         '#7c3aed', // purple
  vacant:         '#9ca3af', // gray
}
const OCC_LABEL: Record<string, string> = {
  owner_occupied: 'Owner-occupied', leased: 'Leased', vacant: 'Vacant',
}

function cellColor(missing: number): { bg: string; fg: string } {
  if (missing === 0) return { bg: '#dcfce7', fg: '#166534' } // green — complete
  if (missing <= 2)  return { bg: '#fef9c3', fg: '#854d0e' } // amber — partial
  return { bg: '#fee2e2', fg: '#991b1b' }                    // red — many missing
}

export default function FloorPlanGrid({
  units, selected, onSelect,
}: {
  units: AuditUnit[]
  selected: string | null
  onSelect: (u: AuditUnit) => void
}) {
  const placed = units.filter(u => u.floor != null && u.line != null)
  const other  = units.filter(u => u.floor == null || u.line == null)

  const floors = [...new Set(placed.map(u => u.floor as number))].sort((a, b) => b - a) // desc
  const lines  = [...new Set(placed.map(u => u.line as number))].sort((a, b) => a - b)
  const byFL = new Map<string, AuditUnit>()
  for (const u of placed) byFL.set(`${u.floor}-${u.line}`, u)

  const Cell = ({ u }: { u: AuditUnit | undefined }) => {
    if (!u) return <div style={{ width: 62, height: 46 }} />
    const { bg, fg } = cellColor(u.missingCount)
    const isSel = selected === u.accountNumber
    return (
      <button
        onClick={() => onSelect(u)}
        title={`Unit ${u.unit} · ${u.ownerName || 'owner —'} · ${u.occupancy ? OCC_LABEL[u.occupancy] : 'occupancy not set'} · ${u.missingCount} doc(s) missing`}
        style={{
          width: 62, height: 46, borderRadius: 8, background: bg, color: fg,
          border: isSel ? '2px solid #111827' : '1px solid rgba(0,0,0,0.08)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', font: '600 13px system-ui', padding: 0, position: 'relative',
        }}
      >
        <span>{u.unit}</span>
        <span style={{ fontSize: 10, fontWeight: 500 }}>{u.missingCount === 0 ? '✓' : `${u.missingCount}✕`}</span>
        {u.occupancy && (
          <span style={{ position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: '50%', background: OCC_DOT[u.occupancy] ?? '#9ca3af' }} />
        )}
      </button>
    )
  }

  return (
    <div>
      <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <table style={{ borderSpacing: 6, borderCollapse: 'separate' }}>
          <thead>
            <tr>
              <th style={{ width: 38 }} />
              {lines.map(l => (
                <th key={l} style={{ font: '600 11px system-ui', color: '#6b7280', textAlign: 'center' }}>
                  {String(l).padStart(2, '0')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {floors.map(f => (
              <tr key={f}>
                <td style={{ font: '600 12px system-ui', color: '#6b7280', textAlign: 'right', paddingRight: 4, whiteSpace: 'nowrap' }}>
                  Fl {f}
                </td>
                {lines.map(l => (
                  <td key={l}><Cell u={byFL.get(`${f}-${l}`)} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {other.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ font: '600 11px system-ui', color: '#6b7280', marginBottom: 6 }}>Other units</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {other.map(u => <Cell key={u.accountNumber} u={u} />)}
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14, font: '500 12px system-ui', color: '#374151' }}>
        <Legend sw="#dcfce7" label="Docs complete" />
        <Legend sw="#fef9c3" label="1–2 missing" />
        <Legend sw="#fee2e2" label="3+ missing" />
        <span style={{ width: 1, background: '#e5e7eb' }} />
        <LegendDot c={OCC_DOT.owner_occupied} label="Owner-occupied" />
        <LegendDot c={OCC_DOT.leased} label="Leased" />
        <LegendDot c={OCC_DOT.vacant} label="Vacant" />
      </div>
    </div>
  )
}

function Legend({ sw, label }: { sw: string; label: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 14, borderRadius: 4, background: sw, border: '1px solid rgba(0,0,0,0.08)' }} />{label}</span>
}
function LegendDot({ c, label }: { c: string; label: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />{label}</span>
}
