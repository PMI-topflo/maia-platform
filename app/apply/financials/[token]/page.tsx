'use client'

// =====================================================================
// /apply/financials/[token]
// A registered application stakeholder's secure view of the association's
// budget & financial statements (the gated categories). Token-gated, no login.
// =====================================================================

import { use, useEffect, useState } from 'react'

interface Doc { id: string; category_label: string; filename: string; effective_date: string | null; download_url: string }
interface Group { group: string; docs: Doc[] }

export default function FinancialsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [data, setData] = useState<{ ok: boolean; unit: string | null; groups: Group[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/applications/financials/${token}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => d.ok ? setData(d) : setErr(d.error ?? 'This link is invalid.'))
      .catch(() => setErr('Could not load the documents.'))
  }, [token])

  const wrap: React.CSSProperties = { maxWidth: 640, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' }

  if (err)   return <div style={wrap}><h2>⚠ {err}</h2></div>
  if (!data) return <div style={wrap}><p>Loading…</p></div>

  const empty = data.groups.length === 0
  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 22, color: '#f26a1b', marginBottom: 2 }}>Budget &amp; Financial Statements</h1>
      {data.unit && <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0 }}>Unit {data.unit}</p>}

      {empty && <p style={{ color: '#6b7280', fontSize: 14 }}>No budget or financial documents have been posted for this association yet.</p>}

      {data.groups.map(g => (
        <div key={g.group} style={{ marginBottom: 22 }}>
          <div style={{ fontWeight: 700, fontSize: 14, margin: '0 0 8px' }}>{g.group}</div>
          {g.docs.map(doc => (
            <a key={doc.id} href={doc.download_url} target="_blank" rel="noreferrer"
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '11px 14px', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 8, textDecoration: 'none', color: '#1a1a1a' }}>
              <span>📄 {doc.category_label}{doc.effective_date ? ` · ${doc.effective_date}` : ''}<br /><span style={{ color: '#9ca3af', fontSize: 12 }}>{doc.filename}</span></span>
              <span style={{ color: '#f26a1b', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>Download</span>
            </a>
          ))}
        </div>
      ))}

      <p style={{ color: '#9ca3af', fontSize: 11, marginTop: 16 }}>🔒 This secure link is just for you — please don&apos;t forward it.</p>
    </div>
  )
}
