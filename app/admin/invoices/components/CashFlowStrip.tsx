'use client'

// Weekly cash-flow strip: a thin balance trend line over a row of colored boxes
// (green healthy / amber tight / red overdrawn). Each box carries the week's
// date + balance in small text. A caption shows the hovered week's bill /
// assessment detail. Powered by the funds-check weekly series.

import { useState } from 'react'

export interface CashWeek { weekStart: string; balance: number; due: number; income: number }

const fmt = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`
const fmtBox = (n: number) => {
  const a = Math.abs(n)
  return a >= 10000 ? `${n < 0 ? '−' : ''}$${Math.round(a / 1000)}k` : `${n < 0 ? '−' : ''}$${Math.round(a).toLocaleString()}`
}
const dLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export default function CashFlowStrip({ weekly, tightBelow = 5000 }: { weekly: CashWeek[]; tightBelow?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!weekly || weekly.length === 0) return null

  const W = 600, padL = 4, padR = 4, top = 4, lineBot = 34, stripTop = 40, stripH = 34, H = 80
  const n = weekly.length
  const bw = (W - padL - padR) / n
  const bals = weekly.map(w => w.balance)
  const hi = Math.max(1000, ...bals), lo = Math.min(0, ...bals)
  const pad = (hi - lo) * 0.15 || 1000
  const yTop = hi + pad, yLo = lo - pad
  const ys = (b: number) => top + (yTop - b) / (yTop - yLo) * (lineBot - top)
  const cx = (i: number) => padL + bw * i + bw / 2
  const color = (b: number) => (b < 0 ? '#E24B4A' : b < tightBelow ? '#EF9F27' : '#639922')
  const boxText = (b: number) => (b >= 0 && b < tightBelow ? '#4A2E00' : '#FFFFFF')  // dark on amber, white otherwise

  const line = weekly.map((w, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)} ${ys(w.balance).toFixed(1)}`).join(' ')
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
        <line x1={padL} y1={ys(0)} x2={W - padR} y2={ys(0)} stroke="var(--color-border-tertiary)" strokeWidth={1} strokeDasharray="3 3" />
        <path d={line} fill="none" stroke="#378ADD" strokeWidth={1.4} />
        {weekly.map((w, i) => (
          <g key={i}>
            {w.income > 0 && <path d={`M${cx(i) - 3.5} ${ys(w.balance) - 5} L${cx(i) + 3.5} ${ys(w.balance) - 5} L${cx(i)} ${ys(w.balance) - 11} Z`} fill="#639922" />}
            <circle cx={cx(i)} cy={ys(w.balance)} r={1.8} fill={color(w.balance)} />
            <rect x={padL + bw * i + 1} y={stripTop} width={bw - 2} height={stripH} rx={3} fill={color(w.balance)}
              stroke={hover === i ? '#111827' : 'none'} strokeWidth={hover === i ? 1.2 : 0}
              opacity={hover === null || hover === i ? 1 : 0.6}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }} />
            <text x={cx(i)} y={stripTop + 13} textAnchor="middle" fontSize="6.5" fill={boxText(w.balance)} pointerEvents="none">{dLabel(w.weekStart)}</text>
            <text x={cx(i)} y={stripTop + 25} textAnchor="middle" fontSize="8.5" fontWeight="700" fill={boxText(w.balance)} pointerEvents="none">{fmtBox(w.balance)}</text>
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
