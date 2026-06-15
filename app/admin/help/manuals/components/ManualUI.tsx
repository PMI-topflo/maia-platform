// =====================================================================
// app/admin/help/manuals/components/ManualUI.tsx
// Shared presentational pieces for the Maia operating manuals:
// numbered steps + annotated screen mockups (callout pins + legend).
// Server-component safe (no client state) so the manuals render fast.
// =====================================================================

import Link from 'next/link'
import type { ReactNode, CSSProperties } from 'react'

const ORANGE = '#f26a1b'

export function ManualHeader({ icon, title, intro }: { icon: string; title: string; intro: string }) {
  return (
    <header className="mb-8 border-l-4 pl-4" style={{ borderColor: ORANGE }}>
      <div className="mb-1 text-xs text-gray-400">
        <Link href="/admin/help" className="hover:text-[#f26a1b]">Help</Link>
        {' / '}
        <Link href="/admin/help/manuals" className="hover:text-[#f26a1b]">Operating manuals</Link>
      </div>
      <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900"><span>{icon}</span>{title}</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">{intro}</p>
    </header>
  )
}

/** One numbered step: orange badge + title, then the instruction + figure as children. */
export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mb-9">
      <div className="mb-2 flex items-start gap-3">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-sm font-medium text-white" style={{ background: ORANGE }}>{n}</span>
        <h2 className="mt-0.5 text-base font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="pl-10">{children}</div>
    </section>
  )
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mb-3 max-w-2xl text-sm leading-relaxed text-gray-600">{children}</p>
}

/** Emphasise a UI label referenced in instruction prose. */
export function UI({ children }: { children: ReactNode }) {
  return <span className="font-medium text-gray-900">{children}</span>
}

export function Tip({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{children}</div>
  )
}

/** Wraps a screen mockup on a surface + renders the numbered callout legend. */
export function Figure({ legend, children }: { legend?: { n: number; text: ReactNode }[]; children: ReactNode }) {
  return (
    <div className="max-w-2xl rounded-xl bg-gray-50 p-4">
      <div className="relative">{children}</div>
      {legend && legend.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-gray-600">
          {legend.map(l => (
            <li key={l.n} className="flex items-start gap-2">
              <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-medium text-white" style={{ background: ORANGE }}>{l.n}</span>
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Absolutely-positioned callout pin. Caller sets position via `style`. */
export function Pin({ n, style }: { n: number; style: CSSProperties }) {
  return (
    <span
      className="absolute z-10 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium text-white shadow"
      style={{ background: ORANGE, ...style }}
    >{n}</span>
  )
}

/** Browser-chrome frame for a screen mockup. */
export function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
      <div className="flex items-center gap-1.5 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
        <span className="ml-2 text-[11px] text-gray-400">{title}</span>
      </div>
      {children}
    </div>
  )
}

/** A tab strip inside a mockup; `active` is highlighted orange. */
export function TabStrip({ tabs, active }: { tabs: string[]; active: string }) {
  return (
    <div className="flex flex-wrap gap-3 border-b border-gray-200 px-3 py-2 text-[11px] text-gray-400">
      {tabs.map(t => t === active
        ? <span key={t} className="-mb-2 border-b-2 pb-2 font-medium" style={{ color: ORANGE, borderColor: ORANGE }}>{t}</span>
        : <span key={t}>{t}</span>)}
    </div>
  )
}

type Tone = 'neutral' | 'info' | 'success' | 'violet' | 'paid' | 'warn'
const TONES: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-600',
  info:    'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
  violet:  'bg-violet-100 text-violet-800',
  paid:    'bg-emerald-100 text-emerald-800',
  warn:    'bg-amber-100 text-amber-800',
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${TONES[tone]}`}>{children}</span>
}

/** Action-button look-alikes used inside mockups (not real buttons). */
export function FakeBtn({ children, variant = 'gray' }: { children: ReactNode; variant?: 'gray' | 'green' | 'violet' | 'orange' }) {
  const v = {
    gray:   'border-gray-300 bg-white text-gray-700',
    green:  'border-[#16a34a] bg-white text-[#16a34a]',
    violet: 'border-[#7c3aed] bg-[#f5f3ff] text-[#6d28d9]',
    orange: 'border-[#f26a1b] bg-[#f26a1b] text-white',
  }[variant]
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium ${v}`}>{children}</span>
}
