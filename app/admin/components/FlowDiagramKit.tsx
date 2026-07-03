// =====================================================================
// app/admin/components/FlowDiagramKit.tsx
//
// Shared building blocks for the /admin "Flows" diagrams — clickable SVG
// reference diagrams of MAIA's business processes, one per flow (Voice
// Flow was the first, hand-rolled before this kit existed; new diagrams
// should use this instead of re-copying the same Box/Diamond/Arrow/modal
// boilerplate). Each diagram supplies its own node-documentation map
// (what's actually said/done at each step, sourced from the real code)
// and its own SVG layout; this file only owns the reusable pieces.
// =====================================================================

import type { ReactNode } from 'react'

export const COLOR = {
  navy:   '#0d0d0d',
  gold:   '#f26a1b',
  green:  '#1a6b3c',
  blue:   '#1d4ed8',
  muted:  '#6b7280',
  border: '#e5e7eb',
  card:   '#ffffff',
  bg:     '#fafaf9',
}

export interface NodeDoc {
  title:  string
  lines?: string[]
  note?:  string
  source: string
}

export function Box({
  x, y, w, h, title, lines, fill = COLOR.card, stroke = COLOR.navy, titleColor = COLOR.navy, nodeKey, onSelect, doc,
}: {
  x: number; y: number; w: number; h: number
  title: string; lines?: string[]
  fill?: string; stroke?: string; titleColor?: string
  nodeKey: string; onSelect: (key: string) => void; doc?: Record<string, NodeDoc>
}) {
  return (
    <g onClick={() => onSelect(nodeKey)} style={{ cursor: 'pointer' }}>
      <title>{doc?.[nodeKey]?.note ?? 'Click for detail.'}</title>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={fill} stroke={stroke} strokeWidth={1.5} />
      <text x={x + w / 2} y={y + (lines?.length ? 24 : h / 2 + 5)} textAnchor="middle" fontSize={13} fontWeight={700} fill={titleColor}>
        {title}
      </text>
      {lines?.map((line, i) => (
        <text key={i} x={x + w / 2} y={y + 44 + i * 16} textAnchor="middle" fontSize={11} fill={COLOR.muted}>
          {line}
        </text>
      ))}
    </g>
  )
}

export function Diamond({
  x, y, w, h, label, nodeKey, onSelect, doc,
}: { x: number; y: number; w: number; h: number; label: string[]; nodeKey: string; onSelect: (key: string) => void; doc?: Record<string, NodeDoc> }) {
  const cx = x + w / 2
  const cy = y + h / 2
  const points = `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`
  return (
    <g onClick={() => onSelect(nodeKey)} style={{ cursor: 'pointer' }}>
      <title>{doc?.[nodeKey]?.note ?? 'Click for detail.'}</title>
      <polygon points={points} fill="#fff7ed" stroke={COLOR.gold} strokeWidth={1.5} />
      {label.map((line, i) => (
        <text key={i} x={cx} y={cy - (label.length - 1) * 7 + i * 14 + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={COLOR.navy}>
          {line}
        </text>
      ))}
    </g>
  )
}

export function Arrow({ path, dashed = false, label, labelX, labelY }: { path: string; dashed?: boolean; label?: string; labelX?: number; labelY?: number }) {
  return (
    <g>
      <path d={path} fill="none" stroke={COLOR.muted} strokeWidth={1.5} strokeDasharray={dashed ? '5 4' : undefined} markerEnd="url(#arrowhead)" />
      {label && (
        <text x={labelX} y={labelY} fontSize={10.5} fontWeight={600} fill={COLOR.muted}>{label}</text>
      )}
    </g>
  )
}

/** A swim-lane header chip — labels which actor (staff/vendor/board/etc.)
 *  performs the steps below it, so a diagram spanning multiple external
 *  parties stays readable at a glance. */
export function LaneTag({ x, y, label, color }: { x: number; y: number; label: string; color: string }) {
  return (
    <text x={x} y={y} fontSize={10.5} fontWeight={800} fill={color} letterSpacing="0.06em">{label}</text>
  )
}

export function ArrowheadDefs() {
  return (
    <defs>
      <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <path d="M0,0 L6,3 L0,6 Z" fill={COLOR.muted} />
      </marker>
    </defs>
  )
}

export function NodeModal({ nodeKey, doc, onClose }: { nodeKey: string; doc: Record<string, NodeDoc>; onClose: () => void }) {
  const d = doc[nodeKey]
  if (!d) return null
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(13,13,13,0.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: COLOR.card, borderRadius: 12, maxWidth: 560, width: '100%', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
      >
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: `1px solid ${COLOR.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{d.title}</h3>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: COLOR.muted, fontFamily: 'monospace' }}>{d.source}</p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.3rem', lineHeight: 1, cursor: 'pointer', color: COLOR.muted, padding: 0 }}>×</button>
        </div>
        <div style={{ padding: '1.25rem 1.5rem' }}>
          {d.lines?.length ? (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {d.lines.map((line, i) => (
                <li key={i} style={{ fontSize: '0.9rem', lineHeight: 1.5, color: COLOR.navy, background: COLOR.bg, borderRadius: 8, padding: '0.6rem 0.8rem' }}>
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, fontSize: '0.9rem', color: COLOR.muted, fontStyle: 'italic' }}>No fixed script at this step.</p>
          )}
          {d.note && (
            <p style={{ marginTop: d.lines?.length ? '0.9rem' : 0, fontSize: '0.8rem', color: COLOR.muted, lineHeight: 1.5 }}>{d.note}</p>
          )}
        </div>
      </div>
    </div>
  )
}

/** Standard legend row — reused verbatim across diagrams so the color
 *  language stays consistent. Extend with extra swatches via `extra`. */
export function Legend({ x, y, extra }: { x: number; y: number; extra?: ReactNode }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={0} y={-14} width={14} height={14} rx={3} fill={COLOR.navy} />
      <text x={20} y={-3} fontSize={11} fill={COLOR.muted}>Processing / engine</text>
      <rect x={190} y={-14} width={14} height={14} rx={3} fill="#fff7ed" stroke={COLOR.gold} />
      <text x={210} y={-3} fontSize={11} fill={COLOR.muted}>Menu / decision</text>
      <rect x={360} y={-14} width={14} height={14} rx={3} fill="#f0fdf4" stroke={COLOR.green} />
      <text x={380} y={-3} fontSize={11} fill={COLOR.muted}>Terminal / outcome</text>
      {extra}
      <text x={560} y={-3} fontSize={11} fill={COLOR.muted}>Click any box for detail.</text>
    </g>
  )
}
