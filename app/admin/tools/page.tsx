'use client'

import { useState } from 'react'

interface BatchResult {
  renamed: number
  created: number
  already_correct: number
  batch_size: number
}

export default function AdminToolsPage() {
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [totals, setTotals] = useState({ renamed: 0, created: 0, ok: 0 })
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function run(apply: boolean) {
    setRunning(true)
    setLog([])
    setTotals({ renamed: 0, created: 0, ok: 0 })
    setError(null)
    setDone(false)
    setProgress('Starting…')

    let offset = 0
    let totalUnits = 0
    let cumRenamed = 0, cumCreated = 0, cumOk = 0

    try {
      while (true) {
        setProgress(`Processing units ${offset + 1}–${offset + 15}${totalUnits ? ` of ${totalUnits}` : ''}…`)

        const res = await fetch('/api/admin/tools/sync-drive-folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apply, association_code: 'MANXI', offset }),
        })
        const json = await res.json()
        if (!res.ok || !json.ok) throw new Error(json.error ?? 'Request failed')

        totalUnits = json.total
        const s: BatchResult = json.summary
        cumRenamed += s.renamed
        cumCreated += s.created
        cumOk += s.already_correct

        setTotals({ renamed: cumRenamed, created: cumCreated, ok: cumOk })
        setLog(prev => [...prev, ...json.log])

        if (json.next_offset == null) break
        offset = json.next_offset
      }

      setProgress(`Done — ${totalUnits} units processed`)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setRunning(false)
    }
  }

  const btnBase: React.CSSProperties = {
    padding: '0.6rem 1.2rem', borderRadius: 6, fontWeight: 600,
    cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.5 : 1,
    fontSize: '0.875rem',
  }

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Admin Tools</h1>
      <p style={{ color: '#6b7280', marginBottom: '2rem' }}>Server-side maintenance tasks</p>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb', padding: '1rem 1.25rem' }}>
          <h2 style={{ fontWeight: 700, margin: 0, fontSize: '1rem' }}>Sync Drive Unit Folders — MANXI</h2>
          <p style={{ color: '#6b7280', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
            Renames folders to <code style={{ background: '#f3f4f6', padding: '0 3px', borderRadius: 3, fontSize: '0.75rem' }}>ACCOUNT - ADDRESS</code> format. Processes 15 units at a time.
          </p>
        </div>

        <div style={{ padding: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => run(false)} disabled={running}
            style={{ ...btnBase, border: '1px solid #d1d5db', background: '#fff', color: '#374151' }}>
            Dry Run (preview)
          </button>
          <button
            onClick={() => { if (confirm('Rename Drive folders for real. Continue?')) run(true) }}
            disabled={running}
            style={{ ...btnBase, border: 'none', background: '#f26a1b', color: '#fff' }}>
            Apply Changes
          </button>
          {running && (
            <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>{progress}</span>
          )}
          {error && <span style={{ fontSize: '0.875rem', color: '#dc2626' }}>{error}</span>}
        </div>

        {(done || log.length > 0) && (
          <div style={{ borderTop: '1px solid #e5e7eb', padding: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
              {[
                ['Already correct', totals.ok, '#16a34a'],
                ['Renamed', totals.renamed, '#f26a1b'],
                ['Created', totals.created, '#2563eb'],
              ].map(([label, value, color]) => (
                <div key={label as string}>
                  <div style={{ color: color as string, fontWeight: 700, fontSize: '1.4rem' }}>{value as number}</div>
                  <div style={{ color: '#6b7280', fontSize: '0.8rem' }}>{label as string}</div>
                </div>
              ))}
            </div>
            {log.length > 0 && (
              <div style={{ background: '#0d0d0d', borderRadius: 6, padding: '1rem', maxHeight: 360, overflowY: 'auto' }}>
                {log.map((line, i) => (
                  <div key={i} style={{
                    fontFamily: 'monospace', fontSize: '0.72rem', lineHeight: 1.7,
                    color: line.startsWith('RENAMED') || line.startsWith('WOULD RENAME') ? '#fbbf24'
                      : line.startsWith('CREATED') || line.startsWith('WOULD CREATE') ? '#60a5fa'
                      : '#9ca3af',
                  }}>
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
