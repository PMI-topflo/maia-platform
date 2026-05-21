// =====================================================================
// lib/render-report-markdown.tsx
//
// Minimal markdown → JSX renderer for the MAIA-generated board report.
// Handles headings (#/##/###), bullet lists, paragraphs and inline
// **bold** — enough for the report layout. Pure (no hooks), so it works
// in both server and client components.
// =====================================================================

import type { ReactNode } from 'react'

/** Render inline **bold** within a line; everything else is plain text. */
function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>
    }
    return <span key={`${keyBase}-${i}`}>{part}</span>
  })
}

export function renderReportMarkdown(md: string): ReactNode[] {
  const lines = md.split(/\r?\n/)
  const out: ReactNode[] = []
  let bullets: string[] = []

  const flushBullets = () => {
    if (bullets.length === 0) return
    out.push(
      <ul key={`ul-${out.length}`} className="list-disc pl-5 my-2 space-y-1 text-sm text-gray-700">
        {bullets.map((b, i) => <li key={i}>{inline(b, `li-${out.length}-${i}`)}</li>)}
      </ul>,
    )
    bullets = []
  }

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd()
    if (/^\s*[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^\s*[-*]\s+/, ''))
      return
    }
    flushBullets()
    if (!line.trim()) return
    if (line.startsWith('### ')) {
      out.push(<h4 key={idx} className="text-sm font-semibold text-gray-900 mt-4 mb-1">{inline(line.slice(4), `h4-${idx}`)}</h4>)
    } else if (line.startsWith('## ')) {
      out.push(<h3 key={idx} className="text-base font-semibold text-gray-900 mt-5 mb-1">{inline(line.slice(3), `h3-${idx}`)}</h3>)
    } else if (line.startsWith('# ')) {
      out.push(<h2 key={idx} className="text-lg font-bold text-gray-900 mt-3 mb-2">{inline(line.slice(2), `h2-${idx}`)}</h2>)
    } else {
      out.push(<p key={idx} className="text-sm text-gray-700 my-1.5 leading-relaxed">{inline(line, `p-${idx}`)}</p>)
    }
  })
  flushBullets()
  return out
}

/** Newsletter variant — each `## ` heading becomes a numbered section
 *  with a circular badge + orange underline, bullets get orange dots.
 *  Used by the printable/shareable monthly-report view page. */
export function renderNewsletterMarkdown(md: string): ReactNode[] {
  const lines = md.split(/\r?\n/)
  const out: ReactNode[] = []
  let bullets: string[] = []
  let sectionNum = 0

  const flushBullets = () => {
    if (bullets.length === 0) return
    out.push(
      <ul key={`ul-${out.length}`} className="my-2 space-y-1.5">
        {bullets.map((b, i) => (
          <li key={i} className="relative pl-5 text-sm text-gray-700 leading-relaxed">
            <span className="absolute left-0 top-2 h-1.5 w-1.5 rounded-full bg-[#f26a1b]" />
            {inline(b, `li-${out.length}-${i}`)}
          </li>
        ))}
      </ul>,
    )
    bullets = []
  }

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd()
    if (/^\s*[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^\s*[-*]\s+/, ''))
      return
    }
    flushBullets()
    if (!line.trim()) return

    if (line.startsWith('## ')) {
      sectionNum += 1
      // Drop any leading "N." the model may have written — we number it.
      const text = line.slice(3).replace(/^\s*\d+[.)]\s*/, '')
      out.push(
        <h2 key={idx} className="mt-7 mb-2.5 flex items-center gap-2 border-b-2 border-[#f26a1b] pb-1.5">
          <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#f26a1b] text-xs font-bold text-white">
            {sectionNum}
          </span>
          <span className="text-base font-semibold text-[#1f2a44]">{inline(text, `h2-${idx}`)}</span>
        </h2>,
      )
    } else if (line.startsWith('### ')) {
      out.push(<h3 key={idx} className="mt-4 mb-1 text-sm font-semibold text-gray-900">{inline(line.slice(4), `h3-${idx}`)}</h3>)
    } else if (line.startsWith('# ')) {
      out.push(<h2 key={idx} className="mt-3 mb-2 text-lg font-bold text-[#1f2a44]">{inline(line.slice(2), `h1-${idx}`)}</h2>)
    } else {
      out.push(<p key={idx} className="my-2 text-sm leading-relaxed text-gray-700">{inline(line, `p-${idx}`)}</p>)
    }
  })
  flushBullets()
  return out
}
