'use client'

import { useState } from 'react'

export default function AdminToolsPage() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(apply: boolean) {
    setRunning(true)
    setResult(null)
    setError(null)
    try {
      const res = await fetch('/api/admin/tools/sync-drive-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply, association_code: 'MANXI' }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Failed')
      setResult(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Admin Tools</h1>
      <p style={{ color: '#6b7280', marginBottom: '2rem' }}>Server-side maintenance tasks</p>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: '2rem' }}>
        <div style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb', padding: '1rem 1.25rem' }}>
          <h2 style={{ fontWeight: 700, margin: 0 }}>Sync Drive Unit Folders — MANXI</h2>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
            Renames existing unit folders to <code style={{ background: '#f3f4f6', padding: '0 4px', borderRadius: 3 }}>ACCOUNT - ADDRESS</code> format and creates missing folders.
          </p>
        </div>
        <div style={{ padding: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            onClick={() => run(false)}
            disabled={running}
            style={{ padding: '0.6rem 1.2rem', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: running ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: running ? 0.5 : 1 }}
          >
            {running ? 'Running…' : 'Dry Run (preview)'}
          </button>
          <button
            onClick={() => { if (confirm('This will rename Drive folders for real. Continue?')) run(true) }}
            disabled={running}
            style={{ padding: '0.6rem 1.2rem', borderRadius: 6, border: 'none', background: '#f26a1b', color: '#fff', cursor: running ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: running ? 0.5 : 1 }}
          >
            {running ? 'Running…' : 'Apply Changes'}
          </button>
          {error && <span style={{ color: '#dc2626', fontSize: '0.875rem' }}>{error}</span>}
        </div>

        {result && (
          <div style={{ borderTop: '1px solid #e5e7eb', padding: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
              {[
                ['Already correct', result.summary.already_correct, '#16a34a'],
                [result.apply ? 'Renamed' : 'Would rename', result.summary.renamed, '#f26a1b'],
                [result.apply ? 'Created' : 'Would create', result.summary.created, '#2563eb'],
                ['Total units', result.summary.units_total, '#374151'],
              ].map(([label, value, color]) => (
                <div key={label as string}>
                  <div style={{ color: color as string, fontWeight: 700, fontSize: '1.25rem' }}>{value as number}</div>
                  <div style={{ color: '#6b7280' }}>{label as string}</div>
                </div>
              ))}
            </div>
            {result.log.length > 0 && (
              <div style={{ background: '#0d0d0d', borderRadius: 6, padding: '1rem', maxHeight: 320, overflowY: 'auto' }}>
                {result.log.map((line: string, i: number) => (
                  <div key={i} style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: line.startsWith('RENAMED') || line.startsWith('WOULD RENAME') ? '#fbbf24' : line.startsWith('CREATED') || line.startsWith('WOULD CREATE') ? '#60a5fa' : '#9ca3af', lineHeight: 1.6 }}>
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
