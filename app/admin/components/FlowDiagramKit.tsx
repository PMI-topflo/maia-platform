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

/** A form-field mockup row inside a NodePreview of type 'form' — visual
 *  only, resembling the real page's actual fields so staff recognize it,
 *  not a functional form. */
export interface FormField {
  label: string
  kind:  'readonly' | 'text' | 'textarea' | 'date' | 'file' | 'photos' | 'button' | 'signature'
  value?: string
}

/** What actually gets sent/shown to the external person at this step —
 *  the real email template (verbatim subject/body from the route that
 *  sends it) or a mockup of the real page/form they interact with. */
export type NodePreview =
  | { type: 'email'; to: string; subject: string; html: string }
  | { type: 'form'; pageTitle: string; fields: FormField[] }

export interface NodeDoc {
  title:  string
  lines?: string[]
  note?:  string
  source: string
  /** The actual email or form/page sent to an external party at this step. */
  preview?: NodePreview
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

/** Visual mockup of one field on the real page — NOT functional, just
 *  enough of a resemblance (label + input-shaped box) that staff recognize
 *  it against the actual product. */
function FieldMock({ field }: { field: FormField }) {
  const label = (
    <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: COLOR.muted, marginBottom: '0.25rem' }}>
      {field.label}
    </div>
  )
  if (field.kind === 'button') {
    return (
      <div style={{ display: 'inline-block', background: COLOR.gold, color: '#fff', fontWeight: 700, fontSize: '0.82rem', padding: '0.55rem 1rem', borderRadius: 8 }}>
        {field.value ?? field.label}
      </div>
    )
  }
  if (field.kind === 'photos') {
    return (
      <div>
        {label}
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: 44, height: 44, borderRadius: 6, background: '#e5e7eb', border: `1px solid ${COLOR.border}` }} />
          ))}
        </div>
      </div>
    )
  }
  if (field.kind === 'file') {
    return (
      <div>
        {label}
        <div style={{ border: `1.5px dashed ${COLOR.border}`, borderRadius: 8, padding: '0.6rem 0.8rem', fontSize: '0.8rem', color: COLOR.muted, textAlign: 'center' }}>
          {field.value ?? 'Upload file'}
        </div>
      </div>
    )
  }
  if (field.kind === 'signature') {
    return (
      <div>
        {label}
        <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 6, height: 44, background: '#fff', display: 'flex', alignItems: 'center', paddingLeft: '0.6rem' }}>
          <span style={{ fontFamily: 'cursive', fontSize: '1.1rem', color: '#334155' }}>{field.value ?? '✍️'}</span>
        </div>
      </div>
    )
  }
  if (field.kind === 'textarea') {
    return (
      <div>
        {label}
        <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 6, padding: '0.5rem 0.65rem', fontSize: '0.82rem', color: COLOR.navy, background: '#fff', minHeight: '2.6rem', whiteSpace: 'pre-wrap' }}>
          {field.value ?? ''}
        </div>
      </div>
    )
  }
  if (field.kind === 'readonly') {
    return (
      <div>
        {label}
        <div style={{ fontSize: '0.85rem', color: COLOR.navy, whiteSpace: 'pre-wrap' }}>{field.value ?? ''}</div>
      </div>
    )
  }
  // text / date
  return (
    <div>
      {label}
      <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 6, padding: '0.45rem 0.65rem', fontSize: '0.82rem', color: COLOR.navy, background: '#fff', display: 'inline-block', minWidth: field.kind === 'date' ? 110 : 180 }}>
        {field.value ?? ''}
      </div>
    </div>
  )
}

function PreviewPanel({ preview }: { preview: NodePreview }) {
  if (preview.type === 'email') {
    return (
      <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ background: '#f9fafb', borderBottom: `1px solid ${COLOR.border}`, padding: '0.6rem 0.9rem', fontSize: '0.78rem', color: COLOR.muted }}>
          <div><strong style={{ color: COLOR.navy }}>To:</strong> {preview.to}</div>
          <div><strong style={{ color: COLOR.navy }}>Subject:</strong> {preview.subject}</div>
        </div>
        <div
          style={{ padding: '1rem 1.1rem', fontSize: '0.85rem', lineHeight: 1.6, color: '#111827', background: '#fff' }}
          // Static, hand-authored content mirrored verbatim from the real
          // sendEmail() call in the route — never user input.
          dangerouslySetInnerHTML={{ __html: preview.html }}
        />
      </div>
    )
  }
  return (
    <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 10, padding: '1rem 1.1rem', background: '#fff' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: COLOR.gold, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem' }}>
        {preview.pageTitle}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {preview.fields.map((f, i) => <FieldMock key={i} field={f} />)}
      </div>
    </div>
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
        style={{ background: COLOR.card, borderRadius: 12, maxWidth: 640, width: '100%', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
      >
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: `1px solid ${COLOR.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{d.title}</h3>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: COLOR.muted, fontFamily: 'monospace' }}>{d.source}</p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.3rem', lineHeight: 1, cursor: 'pointer', color: COLOR.muted, padding: 0 }}>×</button>
        </div>
        <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {d.lines?.length ? (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {d.lines.map((line, i) => (
                <li key={i} style={{ fontSize: '0.9rem', lineHeight: 1.5, color: COLOR.navy, background: COLOR.bg, borderRadius: 8, padding: '0.6rem 0.8rem' }}>
                  {line}
                </li>
              ))}
            </ul>
          ) : !d.preview ? (
            <p style={{ margin: 0, fontSize: '0.9rem', color: COLOR.muted, fontStyle: 'italic' }}>No fixed script at this step.</p>
          ) : null}
          {d.note && (
            <p style={{ margin: 0, fontSize: '0.8rem', color: COLOR.muted, lineHeight: 1.5 }}>{d.note}</p>
          )}
          {d.preview && (
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: COLOR.muted, marginBottom: '0.5rem' }}>
                {d.preview.type === 'email' ? '📧 What they actually receive' : '🖥️ What they actually see'}
              </div>
              <PreviewPanel preview={d.preview} />
            </div>
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
