'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import type { FinancialFigures } from '@/lib/report-financials'
import { FinancialFiguresGrid } from '@/lib/render-report-financials'

interface Existing {
  figures:        FinancialFigures | null
  pdf_filename:   string
  extract_status: 'pending' | 'extracted' | 'failed'
  extract_error:  string | null
}

interface Props {
  assoc:    string                 // '' for "all associations"
  month:    string
  existing: Existing | null        // null = nothing uploaded yet
}

const FILE_INPUT_CLS =
  'text-xs text-gray-600 file:mr-2 file:rounded file:border-0 file:bg-gray-100 ' +
  'file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-200'
const UPLOAD_BTN_CLS =
  'rounded bg-[#f26a1b] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#d85a14] disabled:opacity-50'

/** Financial-statement panel on the report builder — staff upload the
 *  CINC financial PDF; MAIA extracts the headline figures for the
 *  report's Financial Summary section. */
export default function FinancialPanel({ assoc, month, existing }: Props) {
  const router  = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg,  setMsg]  = useState<string | null>(null)

  async function upload() {
    if (!file) return
    setBusy(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.append('assoc', assoc)
      fd.append('month', month)
      fd.append('file',  file)
      const res  = await fetch('/api/admin/reports/monthly/financials', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data?.error ?? 'Upload failed')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setMsg(data.extract_status === 'extracted'
        ? '✓ Statement uploaded — MAIA extracted the figures.'
        : `Statement uploaded, but MAIA could not read the figures${data.extract_error ? ` (${data.extract_error})` : ''}. The PDF is still attached — try replacing it with a clearer file.`)
      router.refresh()
    } catch (err) {
      setMsg(`✗ ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(
        `/api/admin/reports/monthly/financials?assoc=${encodeURIComponent(assoc)}&month=${encodeURIComponent(month)}`,
        { method: 'DELETE' },
      )
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data?.error ?? 'Could not remove the statement')
      router.refresh()
    } catch (err) {
      setMsg(`✗ ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const pdfHref =
    `/api/admin/reports/monthly/financials/pdf?assoc=${encodeURIComponent(assoc)}&month=${encodeURIComponent(month)}`

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Financial statement</h2>

      {!assoc ? (
        <p className="mt-1 text-xs text-gray-500">
          Pick a single association above to upload its financial statement — it&apos;s per association.
        </p>
      ) : existing ? (
        <div className="mt-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-700">
              📄{' '}
              <a href={pdfHref} target="_blank" rel="noopener noreferrer" className="font-medium text-[#f26a1b] hover:underline">
                {existing.pdf_filename}
              </a>
            </span>
            <button
              onClick={() => void remove()}
              disabled={busy}
              className="text-[11px] text-gray-400 hover:text-red-600 disabled:opacity-50"
            >
              Remove
            </button>
          </div>

          {existing.extract_status === 'extracted' && existing.figures ? (
            <div className="mt-3">
              <p className="mb-1.5 text-[11px] uppercase tracking-wide text-gray-400">
                Figures MAIA extracted
                {existing.figures.period_label ? ` · ${existing.figures.period_label}` : ''}
              </p>
              <FinancialFiguresGrid figures={existing.figures} />
              <p className="mt-2 text-[11px] text-gray-400">
                These appear in the report&apos;s Financial Summary section and feed the board report.
              </p>
            </div>
          ) : (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              MAIA could not read the figures from this PDF
              {existing.extract_error ? ` (${existing.extract_error})` : ''}. The statement is still
              attached to the report — replace it below with a clearer file to try again.
            </div>
          )}

          <div className="mt-3 border-t border-gray-100 pt-3">
            <p className="mb-1.5 text-[11px] font-medium text-gray-600">Replace the statement</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className={FILE_INPUT_CLS}
              />
              <button onClick={() => void upload()} disabled={!file || busy} className={UPLOAD_BTN_CLS}>
                {busy ? 'Reading…' : 'Upload & extract'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-xs text-gray-500">
            Optional — upload this association&apos;s CINC financial statement (PDF). MAIA reads it and
            pulls the headline figures into the report&apos;s Financial Summary section.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className={FILE_INPUT_CLS}
            />
            <button onClick={() => void upload()} disabled={!file || busy} className={UPLOAD_BTN_CLS}>
              {busy ? 'Reading…' : 'Upload & extract'}
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div className="mt-2 text-xs text-gray-500">
          MAIA is reading the statement — this can take up to a minute…
        </div>
      )}
      {msg && (
        <div className={['mt-2 text-xs', msg.startsWith('✗') ? 'text-red-700' : 'text-gray-600'].join(' ')}>
          {msg}
        </div>
      )}
    </section>
  )
}
