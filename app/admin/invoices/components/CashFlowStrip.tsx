'use client'

// Weekly cash-flow strip: end-of-week projected balance as colored boxes
// (green healthy / amber tight / red overdrawn) under a balance line, with a
// dollar scale and a fixed caption (updates on hover). Powered by the
// funds-check weekly series (bills by due date + assessments by learned cadence).

import { useState } from 'react'

export interface CashWeek { weekStart: string; balance: number; due: number; income: number }

const fmt = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`
const fmtK = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n / 1000))}k`
const dLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export default function CashFlowStrip({ weekly, tightBelow = 5000 }: { weekly: CashWeek[]; tightBelow?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!weekly || weekly.length === 0) return null

  const W = 600, H = 78, padL = 32, padR = 6, top = 6, lineBot = 50, stripTop = 56, stripH = 16
  const n = weekly.length
  const bw = (W - padL - padR) / n
  const bals = weekly.map(w => w.balance)
  const hi = Math.max(1000, ...bals), lo = Math.min(0, ...bals)
  const pad = (hi - lo) * 0.12 || 1000
  const yTop = hi + pad, yLo = lo - pad
  const ys = (b: number) => top + (yTop - b) / (yTop - yLo) * (lineBot - top)
  const cx = (i: number) => padL + bw * i + bw / 2
  const color = (b: number) => (b < 0 ? '#E24B4A' : b < tightBelow ? '#EF9F27' : '#639922')

  const line = weekly.map((w, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)} ${ys(w.balance).toFixed(1)}`).join(' ')
  const ticks = [yTop, 0, yLo].filter((v, i, a) => a.indexOf(v) === i)

  const active = hover ?? (n - 1)
  const aw = weekly[active]

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', fontSize: 11, marginBottom: 3, minHeight: 16 }}>
        <span style={{ fontWeight: 500 }}>Week of {dLabel(aw.weekStart)}</span>
        <span style={{ color: color(aw.balance), fontWeight: 600 }}>{fmt(aw.balance)}</span>
        {aw.due > 0 && <span style={{ color: 'var(--color-text-secondary)' }}>bills −{fmt(aw.due)}</span>}
        {aw.income > 0 && <span style={{ color: '#3B6D11' }}>assessment +{fmt(aw.income)}</span>}
        <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10 }}>{hover === null ? '· latest — hover a week' : ''}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label={`Weekly projected balance over ${n} weeks, from ${fmt(weekly[0].balance)} to ${fmt(weekly[n - 1].balance)}.`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={ys(t)} x2={W - padR} y2={ys(t)} stroke="var(--color-border-tertiary)" strokeWidth={t === 0 ? 1 : 0.5} strokeDasharray={t === 0 ? '3 3' : ''} />
            <text x={padL - 4} y={ys(t) + 3} textAnchor="end" fontSize="8" fill="var(--color-text-tertiary)">{fmtK(t)}</text>
          </g>
        ))}
        <path d={line} fill="none" stroke="#378ADD" strokeWidth={1.5} />
        {weekly.map((w, i) => (
          <g key={i}>
            {w.income > 0 && <path d={`M${cx(i) - 3.5} ${ys(w.balance) - 6} L${cx(i) + 3.5} ${ys(w.balance) - 6} L${cx(i)} ${ys(w.balance) - 12} Z`} fill="#639922" />}
            <circle cx={cx(i)} cy={ys(w.balance)} r={2} fill={color(w.balance)} />
            <rect x={padL + bw * i + 1} y={stripTop} width={bw - 2} height={stripH} rx={2} fill={color(w.balance)}
              stroke={hover === i ? '#111827' : 'none'} strokeWidth={hover === i ? 1 : 0}
              opacity={hover === null || hover === i ? 1 : 0.55}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }} />
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 4, fontSize: 11, color: 'var(--color-text-secondary)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#639922' }} />Healthy</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#EF9F27' }} />Tight</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#E24B4A' }} />Overdrawn</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>▲ assessment lands</span>
      </div>
    </div>
  )
}
