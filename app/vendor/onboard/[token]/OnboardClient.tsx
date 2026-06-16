'use client'

// =====================================================================
// OnboardClient.tsx — the standalone vendor onboarding portal body.
// Reuses W9Section + AchSection (via apiBase) and adds simple COI /
// license uploads. No work order, no login required.
// =====================================================================

import { useState } from 'react'
import W9Section from '../../upload/[token]/W9Section'
import AchSection from '../../upload/[token]/AchSection'

interface Row { coi_status: string; license_status: string; w9_status: string; ach_status: string; license_required: boolean }

export default function OnboardClient({ token, company, row }: { token: string; company: string | null; row: Row }) {
  const base = `/api/vendor/onboard/${token}`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <p style={{ fontSize: 14, color: '#4b5563', margin: 0 }}>
        Welcome{company ? `, ${company}` : ''}! Please provide the items below so we can set you up for payment. Everything is secure — no account needed.
      </p>

      <Card title="W-9 (tax information)" status={row.w9_status}>
        <W9Section token={token} apiBase={base} />
      </Card>

      <Card title="Direct deposit (ACH)" status={row.ach_status} statusNote="received — pending our review">
        <AchSection token={token} apiBase={base} />
      </Card>

      <Card title="Insurance (COI)" status={row.coi_status}>
        <FileUpload base={base} category="coi" label="Upload your Certificate of Insurance (COI)" />
      </Card>

      {row.license_required && (
        <Card title="License" status={row.license_status}>
          <FileUpload base={base} category="license" label="Upload your trade license" />
        </Card>
      )}
    </div>
  )
}

function Card({ title, status, statusNote, children }: { title: string; status: string; statusNote?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#111827' }}>{title}</h2>
        <StatusBadge status={status} note={statusNote} />
      </div>
      {children}
    </section>
  )
}

function StatusBadge({ status, note }: { status: string; note?: string }) {
  if (status === 'applied') return <span style={pill('#065f46', '#ecfdf5', '#a7f3d0')}>✓ On file</span>
  if (status === 'received') return <span style={pill('#92400e', '#fffbeb', '#fde68a')}>✓ {note ?? 'Received'}</span>
  if (status === 'na') return <span style={{ fontSize: 11, color: '#9ca3af' }}>not required</span>
  return <span style={pill('#6b7280', '#f9fafb', '#e5e7eb')}>Needed</span>
}
const pill = (c: string, bg: string, bd: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 600, color: c, background: bg, border: `1px solid ${bd}`, borderRadius: 999, padding: '2px 9px' })

function FileUpload({ base, category, label }: { base: string; category: string; label: string }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function onFile(files: FileList | null) {
    if (!files || files.length === 0) return
    setBusy(true); setErr(null)
    try {
      const fd = new FormData(); fd.append('category', category); fd.append('file', files[0])
      const res = await fetch(base, { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'upload failed')
      setDone(true)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  if (done) return <div style={{ padding: 12, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, fontSize: 14, color: '#065f46' }}>✓ Received — thank you.</div>
  return (
    <div>
      <p style={{ fontSize: 13, color: '#4b5563', margin: '0 0 10px' }}>{label}. PDF, JPG or PNG.</p>
      <label style={{ display: 'inline-block', cursor: busy ? 'default' : 'pointer', background: busy ? '#fed7aa' : '#f26a1b', color: '#fff', fontSize: 14, fontWeight: 600, padding: '9px 16px', borderRadius: 8 }}>
        {busy ? 'Uploading…' : 'Choose file'}
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,application/pdf,image/*" style={{ display: 'none' }} disabled={busy} onChange={e => void onFile(e.target.files)} />
      </label>
      {err && <div style={{ marginTop: 10, fontSize: 13, color: '#b91c1c' }}>⚠ {err}</div>}
    </div>
  )
}
