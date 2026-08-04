'use client'

// Staff Pre-Application audit queue (B4). Read-only list of submitted intakes
// for now — the per-application audit + dual approval (on-site manager OR board)
// land in slice 3.

import { useEffect, useState } from 'react'

interface App {
  id: string; associationCode: string; type: string; unit: string | null; status: string
  submittedAt: string | null; applicant: { name: string | null; email: string | null } | null; docCount: number; signed: boolean
}

const TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease renewal', additional_occupant: 'Additional occupant' }
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '—'

export default function PreApplyQueue() {
  const [apps, setApps] = useState<App[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/pre-apply', { credentials: 'include' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(d => setApps(d.applications)).catch(e => setErr(String(e.message ?? e)))
  }, [])

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Pre-Application audit queue</h1>
      <p style={{ color: '#6b7280', fontSize: 14 }}>Submitted applications awaiting audit. Per-application review + dual approval (on-site manager or board) is coming next.</p>
      {err && <p style={{ color: '#991b1b' }}>{err}</p>}
      {!apps ? <p style={{ color: '#9ca3af' }}>Loading…</p> : apps.length === 0 ? <p style={{ color: '#9ca3af' }}>No submitted applications yet.</p> : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#f9fafb', textAlign: 'left' }}>
              {['Applicant', 'Association', 'Unit', 'Type', 'Docs', 'Signed', 'Submitted', 'Status'].map(h => <th key={h} style={{ padding: '10px 12px', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {apps.map(a => (
                <tr key={a.id}>
                  <td style={td}><div style={{ fontWeight: 600 }}>{a.applicant?.name || '—'}</div><div style={{ color: '#9ca3af', fontSize: 12 }}>{a.applicant?.email}</div></td>
                  <td style={td}>{a.associationCode}</td>
                  <td style={td}>{a.unit || '—'}</td>
                  <td style={td}>{TYPE_LABEL[a.type] ?? a.type}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{a.docCount}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{a.signed ? '✓' : '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(a.submittedAt)}</td>
                  <td style={td}><span style={{ font: '600 11px system-ui', color: '#92400e', background: '#ffedd5', borderRadius: 6, padding: '2px 8px' }}>{a.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const td: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid #f3f4f6', color: '#374151', verticalAlign: 'top' }
