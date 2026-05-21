'use client'

import { useState } from 'react'

interface Props {
  assoc:      string
  month:      string
  monthLabel: string
}

/** Render inline **bold** within a line; everything else is plain text. */
function inline(text: string, keyBase: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>
    }
    return <span key={`${keyBase}-${i}`}>{part}</span>
  })
}

/** Minimal markdown → JSX: headings (#/##/###), bullet lists, paragraphs,
 *  inline bold. Enough to render the board report cleanly. */
function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split(/\r?\n/)
  const out: React.ReactNode[] = []
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
      out.push(<h4 key={idx} className="text-sm font-semibold text-gray-900 mt-3 mb-1">{inline(line.slice(4), `h4-${idx}`)}</h4>)
    } else if (line.startsWith('## ')) {
      out.push(<h3 key={idx} className="text-base font-semibold text-gray-900 mt-4 mb-1">{inline(line.slice(3), `h3-${idx}`)}</h3>)
    } else if (line.startsWith('# ')) {
      out.push(<h2 key={idx} className="text-lg font-bold text-gray-900 mt-2 mb-2">{inline(line.slice(2), `h2-${idx}`)}</h2>)
    } else {
      out.push(<p key={idx} className="text-sm text-gray-700 my-1.5 leading-relaxed">{inline(line, `p-${idx}`)}</p>)
    }
  })
  flushBullets()
  return out
}

export default function MonthlyReportGenerator({ assoc, month, monthLabel }: Props) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [report,  setReport]  = useState<string | null>(null)
  const [copied,  setCopied]  = useState(false)

  async function generate() {
    setLoading(true)
    setError(null)
    setReport(null)
    try {
      const res = await fetch('/api/admin/reports/monthly/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ assoc, month }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data?.error ?? 'Report generation failed')
      setReport(data.report as string)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function copyReport() {
    if (!report) return
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy to clipboard')
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">MAIA board report</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            MAIA writes the full board report for {monthLabel}
            {assoc ? ` (${assoc})` : ' — all associations'} from the activity and flagged items above.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {report && (
            <button
              onClick={() => void copyReport()}
              className="text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-700 hover:border-gray-400"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          )}
          <button
            onClick={() => void generate()}
            disabled={loading}
            className="bg-[#f26a1b] text-white text-sm font-medium px-4 py-1.5 rounded hover:bg-[#d85a14] disabled:opacity-50"
          >
            {loading ? 'Generating…' : report ? 'Regenerate' : 'Generate board report'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="mt-4 text-xs text-gray-500">
          MAIA is reviewing the month&apos;s tickets, work orders and communications…
        </div>
      )}

      {error && (
        <div className="mt-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {report && !loading && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-4 max-h-[640px] overflow-y-auto">
            {renderMarkdown(report)}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            Draft generated by MAIA — review before sending to the board. Use Copy to paste it into an email or document.
          </p>
        </div>
      )}
    </section>
  )
}
