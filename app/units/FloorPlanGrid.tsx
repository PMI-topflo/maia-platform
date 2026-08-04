'use client'

// Building floor-plan grid: floors as rows (top floor at the top, like the
// real building), lines as columns. Each cell is a unit showing occupancy
// (O/L/V), balance, and a collections flag, colored by audit completeness.
// Clicking a cell opens the full unit page in a NEW TAB.

import type { AuditUnit } from '@/lib/association-audit'
import { formatBalance, balanceColor } from '@/lib/format-currency'

export type AuditUnitEnriched = AuditUnit & { balance: number | null; inCollections: boolean }

const OCC_TEXT: Record<string, string> = { owner_occupied: 'Owner', leased: 'Leased', vacant: 'Vacant' }

function cellColor(missing: number): { bg: string; fg: string } {
  if (missing === 0) return { bg: '#dcfce7', fg: '#166534' } // green — complete
  if (missing <= 2)  return { bg: '#fef9c3', fg: '#854d0e' } // yellow — partial
  return { bg: '#fee2e2', fg: '#991b1b' }                    // pink/red — many missing
}

// Compact whole-dollar CINC formatting for the tight grid tiles.
const money = (n: number | null): string => formatBalance(n, 0)

export default function FloorPlanGrid({ units }: { units: AuditUnitEnriched[] }) {
  const placed = units.filter(u => u.floor != null && u.line != null)
  const other  = units.filter(u => u.floor == null || u.line == null)

  const floors = [...new Set(placed.map(u => u.floor as number))].sort((a, b) => b - a)
  const lines  = [...new Set(placed.map(u => u.line as number))].sort((a, b) => a - b)
  const byFL = new Map<string, AuditUnitEnriched>()
  for (const u of placed) byFL.set(`${u.floor}-${u.line}`, u)

  const Cell = ({ u }: { u: AuditUnitEnriched | undefined }) => {
    if (!u) return <div style={{ width: 74, height: 56 }} />
    const { bg, fg } = cellColor(u.missingCount)
    const occ = u.occupancy ? OCC_TEXT[u.occupancy] : ''
    return (
      <a
        href={`/units/unit?account=${encodeURIComponent(u.accountNumber)}&assoc=${encodeURIComponent(u.associationCode)}`}
        target="_blank" rel="noopener noreferrer"
        title={`Unit ${u.unit} · ${u.ownerName || 'owner —'} · ${u.occupancy ?? 'occupancy not set'} · balance ${money(u.balance)}${u.inCollections ? ' · IN COLLECTIONS' : ''} · ${u.missingCount} doc(s) missing`}
        style={{
          width: 74, height: 56, borderRadius: 8, background: bg, color: fg, textDecoration: 'none',
          border: u.inCollections ? '2px solid #dc2626' : '1px solid rgba(0,0,0,0.08)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', font: '600 13px system-ui', padding: 0, position: 'relative',
        }}
      >
        {occ && (
          <span style={{ position: 'absolute', top: 3, left: 4, font: '700 8px system-ui', color: u.occupancy === 'leased' ? '#5b21b6' : fg, background: 'rgba(255,255,255,0.75)', borderRadius: 4, padding: '1px 3px', letterSpacing: '0.01em' }}>{occ}</span>
        )}
        {u.inCollections && (
          <span title="In collections" style={{ position: 'absolute', top: 3, right: 5, font: '700 9px system-ui', color: '#dc2626' }}>⛔</span>
        )}
        <span style={{ lineHeight: 1.1 }}>{u.unit}</span>
        <span style={{ font: `600 10px system-ui`, color: balanceColor(u.balance), marginTop: 1 }}>
          {money(u.balance)}
        </span>
      </a>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14, font: '500 12px system-ui', color: '#374151', alignItems: 'center' }}>
        <Legend sw="#dcfce7" label="Docs complete" />
        <Legend sw="#fef9c3" label="1–2 missing" />
        <Legend sw="#fee2e2" label="3+ missing" />
        <span style={{ color: '#9ca3af' }}>·</span>
        <span>Occupancy shown as <b>Owner</b> · <b style={{ color: '#5b21b6' }}>Leased</b> · <b>Vacant</b></span>
        <span style={{ color: '#dc2626' }}>⛔ / red border = in collections</span>
      </div>

      <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <table style={{ borderSpacing: 6, borderCollapse: 'separate' }}>
          <thead>
            <tr>
              <th style={{ width: 38 }} />
              {lines.map(l => (
                <th key={l} style={{ font: '600 11px system-ui', color: '#6b7280', textAlign: 'center' }}>{String(l).padStart(2, '0')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {floors.map(f => (
              <tr key={f}>
                <td style={{ font: '600 12px system-ui', color: '#6b7280', textAlign: 'right', paddingRight: 4, whiteSpace: 'nowrap' }}>Fl {f}</td>
                {lines.map(l => <td key={l}><Cell u={byFL.get(`${f}-${l}`)} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {other.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ font: '600 11px system-ui', color: '#6b7280', marginBottom: 6 }}>Other units</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{other.map(u => <Cell key={u.accountNumber} u={u} />)}</div>
        </div>
      )}
    </div>
  )
}

function Legend({ sw, label }: { sw: string; label: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 14, borderRadius: 4, background: sw, border: '1px solid rgba(0,0,0,0.08)' }} />{label}</span>
}
