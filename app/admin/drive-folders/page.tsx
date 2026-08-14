'use client'

// Rename an association's per-unit Drive folders to ACCOUNT_ADDRESS.
// Preview first — nothing is renamed until you read the plan and confirm.
// Built generic: Venetian Park I is the first of ~24 associations whose Unit
// Docs folders were named by hand over several years.

import { useState } from 'react'

interface Row { fileId: string; currentName: string; proposedName: string | null; accountNumber: string | null; matchedBy: string | null; reason?: string }
interface Plan { ok: boolean; serviceAccount: string; accessError?: string; rows: Row[]; applied?: { fileId: string; from: string; to: string; error?: string }[] }

export default function DriveFolders() {
  const [code, setCode] = useState('VPCI')
  const [folderId, setFolderId] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState<'plan' | 'apply' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function preview() {
    setBusy('plan'); setErr(null); setPlan(null)
    try {
      const r = await fetch(`/api/admin/drive-folders?code=${encodeURIComponent(code)}&folderId=${encodeURIComponent(folderId)}`, { credentials: 'include' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setPlan(j)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  async function apply() {
    const n = (plan?.rows ?? []).filter(r => r.proposedName && r.proposedName !== r.currentName).length
    if (!confirm(`Rename ${n} folder${n === 1 ? '' : 's'} in Drive? The previous names are recorded, so this can be walked back.`)) return
    setBusy('apply'); setErr(null)
    try {
      const r = await fetch('/api/admin/drive-folders', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, folderId }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setPlan(j)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  const renameable = (plan?.rows ?? []).filter(r => r.proposedName && r.proposedName !== r.currentName)
  const unmatched = (plan?.rows ?? []).filter(r => !r.proposedName)
  const inp: React.CSSProperties = { font: '13px system-ui', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 7 }
  const btn = (bg: string): React.CSSProperties => ({ font: '700 13px system-ui', color: '#fff', background: bg, border: 'none', borderRadius: 8, padding: '8px 15px', cursor: 'pointer' })

  return (
    <div style={{ padding: 24, maxWidth: 960, fontFamily: 'system-ui' }}>
      <h1 style={{ font: '800 22px Georgia,serif', color: 'var(--navy, #1c2333)', margin: '0 0 6px' }}>Unit folder names</h1>
      <p style={{ font: '13px system-ui', color: '#6b7280', margin: '0 0 16px' }}>
        Renames each per-unit Drive folder to <code>ACCOUNT_ADDRESS</code> (e.g. <code>VPCI25J_2300 NE 7th St</code>), matching folders to units by the account number and address in their names. Only the unit folders are touched — nothing inside them changes.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="VPCI" style={{ ...inp, width: 110 }} />
        <input value={folderId} onChange={e => setFolderId(e.target.value)} placeholder="Unit Docs folder id or Drive URL" style={{ ...inp, flex: '1 1 380px' }} />
        <button onClick={preview} disabled={busy !== null || !folderId.trim()} style={btn(folderId.trim() ? '#2563eb' : '#c9ccd3')}>{busy === 'plan' ? 'Reading…' : 'Preview plan'}</button>
      </div>

      {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: 12, font: '13px system-ui', marginBottom: 14 }}>{err}</div>}

      {plan?.accessError && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 14, font: '13px system-ui', color: '#92400e' }}>
          <strong>MAIA can&apos;t open that folder.</strong>
          <div style={{ marginTop: 6 }}>{plan.accessError}</div>
        </div>
      )}

      {plan?.ok && (
        <>
          <div style={{ font: '13px system-ui', color: '#374151', marginBottom: 10 }}>
            {renameable.length} folder{renameable.length === 1 ? '' : 's'} to rename · {plan.rows.length - renameable.length - unmatched.length} already correct · {unmatched.length} unmatched
          </div>

          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
            {plan.rows.map((r, i) => (
              <div key={r.fileId} style={{ padding: '9px 13px', borderTop: i ? '1px solid #f3f4f6' : 'none', background: r.proposedName ? '#fff' : '#fffbeb', font: '12.5px system-ui' }}>
                <div style={{ color: '#9ca3af', textDecoration: r.proposedName && r.proposedName !== r.currentName ? 'line-through' : 'none' }}>{r.currentName}</div>
                {r.proposedName
                  ? <div style={{ color: '#166534', fontWeight: 600 }}>→ {r.proposedName} <span style={{ color: '#9ca3af', fontWeight: 400 }}>· matched by {r.matchedBy}{r.reason ? ` · ${r.reason}` : ''}</span></div>
                  : <div style={{ color: '#b45309', fontWeight: 600 }}>⚠ {r.reason}</div>}
              </div>
            ))}
          </div>

          {plan.applied
            ? <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 12, font: '13px system-ui', color: '#166534' }}>
                ✓ Renamed {plan.applied.filter(a => !a.error).length} folder(s).
                {plan.applied.filter(a => a.error).map(a => <div key={a.fileId} style={{ color: '#b91c1c' }}>✗ {a.from}: {a.error}</div>)}
              </div>
            : renameable.length > 0 && <button onClick={apply} disabled={busy !== null} style={btn('#c05a1c')}>{busy === 'apply' ? 'Renaming…' : `Rename ${renameable.length} folder${renameable.length === 1 ? '' : 's'}`}</button>}
        </>
      )}
    </div>
  )
}
