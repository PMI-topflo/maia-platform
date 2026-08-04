'use client'

// On-site managers box on the Association Hub — the building-wide on-site
// staff (building_managers), distinct from an owner's per-unit unit_managers.
// Lists them + lets staff paste a whole list of emails at once (one per line,
// optional name). They become recipients of the lease-expiry alerts.

import { useEffect, useState } from 'react'

interface Manager { id: string; first_name: string; last_name: string; email: string | null; phone: string | null; company_name: string | null; active: boolean }

// Pull an email out of a pasted line; the rest of the line is the name.
function parseLine(line: string): { name: string; email: string } | null {
  const m = line.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  if (!m) return null
  const email = m[0]
  const name = line.replace(email, '').replace(/[<>(),;|]/g, ' ').replace(/\s+/g, ' ').trim()
  return { name, email }
}

export default function OnsiteManagersBox({ code }: { code: string }) {
  const [managers, setManagers] = useState<Manager[] | null>(null)
  const [paste, setPaste] = useState('')
  const [one, setOne] = useState({ name: '', email: '', phone: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = () => fetch(`/api/admin/building-managers?assoc=${encodeURIComponent(code)}`)
    .then(r => r.json()).then(d => setManagers(d.managers ?? [])).catch(() => setManagers([]))
  useEffect(() => { load() }, [code])   // eslint-disable-line react-hooks/exhaustive-deps

  async function addPasted() {
    const entries = paste.split(/[\n,]+/).map(parseLine).filter((e): e is { name: string; email: string } => !!e)
    if (entries.length === 0) { setMsg('Paste at least one email address.'); return }
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/admin/building-managers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ association_code: code, entries }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setMsg(`Added ${j.added}${j.skipped ? `, skipped ${j.skipped} already on file` : ''}.`)
      setPaste(''); load()
    } catch (e) { setMsg(`Could not add: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  async function addOne() {
    if (!one.email.trim().includes('@')) { setMsg('Enter a valid email.'); return }
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/admin/building-managers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ association_code: code, entries: [one] }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setMsg(j.added ? 'Added.' : 'Already on file.')
      setOne({ name: '', email: '', phone: '' }); load()
    } catch (e) { setMsg(`Could not add: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  async function toggle(id: string, active: boolean) {
    await fetch('/api/admin/building-managers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, active }) })
    load()
  }

  async function saveEdits(id: string, fields: { name: string; email: string; phone: string }) {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/admin/building-managers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...fields }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setMsg('Saved.'); load()
    } catch (e) { setMsg(`Could not save: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Remove ${label} from the on-site managers?`)) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/admin/building-managers?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setMsg('Removed.'); load()
    } catch (e) { setMsg(`Could not remove: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  const box: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 }
  return (
    <div style={box}>
      <h3 style={{ font: '700 15px system-ui', margin: '0 0 2px' }}>On-site managers</h3>
      <p style={{ font: '12px system-ui', color: '#6b7280', margin: '0 0 12px' }}>Building-wide on-site staff. They receive lease-expiry alerts. (Not an owner&rsquo;s per-unit manager.)</p>

      {managers === null ? <p style={{ font: '12px system-ui', color: '#9ca3af' }}>Loading…</p>
        : managers.length === 0 ? <p style={{ font: '12px system-ui', color: '#9ca3af' }}>None yet — paste the on-site managers&rsquo; emails below.</p>
        : (
          <ul style={{ listStyle: 'none', margin: '0 0 12px', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {managers.map(m => (
              <ManagerRow key={m.id} m={m} busy={busy}
                onSave={f => saveEdits(m.id, f)}
                onToggle={() => toggle(m.id, !m.active)}
                onRemove={() => remove(m.id, [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || 'this manager')} />
            ))}
          </ul>
        )}

      {(() => {
        const inp: React.CSSProperties = { font: '13px system-ui', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', boxSizing: 'border-box', width: '100%' }
        const btn = (on: boolean): React.CSSProperties => ({ font: '600 13px system-ui', background: '#f26a1b', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', cursor: on ? 'pointer' : 'default', opacity: on ? 1 : 0.55 })
        return (<>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
            <input style={inp} placeholder="Name" value={one.name} onChange={e => setOne(o => ({ ...o, name: e.target.value }))} />
            <input style={inp} placeholder="Phone" value={one.phone} onChange={e => setOne(o => ({ ...o, phone: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <input style={{ ...inp, flex: 1 }} placeholder="Email" value={one.email} onChange={e => setOne(o => ({ ...o, email: e.target.value }))} />
            <button onClick={addOne} disabled={busy || !one.email.trim()} style={btn(!busy && !!one.email.trim())}>Add</button>
          </div>

          <div style={{ font: '11px system-ui', color: '#9ca3af', margin: '0 0 4px' }}>Or paste a list —</div>
          <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={3}
            placeholder={'one per line — Jane Doe <jane@onsite.com> or manager2@onsite.com'}
            style={{ width: '100%', font: '12px ui-monospace, monospace', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', boxSizing: 'border-box', resize: 'vertical' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <button onClick={addPasted} disabled={busy || !paste.trim()} style={btn(!busy && !!paste.trim())}>
              {busy ? 'Adding…' : 'Add pasted list'}
            </button>
            {msg && <span style={{ font: '12px system-ui', color: '#374151' }}>{msg}</span>}
          </div>
        </>)
      })()}
    </div>
  )
}

// One editable manager row: name / phone / email inline, Save when changed,
// plus Deactivate/Reactivate and Remove.
function ManagerRow({ m, busy, onSave, onToggle, onRemove }: {
  m: Manager; busy: boolean
  onSave: (f: { name: string; email: string; phone: string }) => void
  onToggle: () => void; onRemove: () => void
}) {
  const initial = { name: [m.first_name, m.last_name].filter(Boolean).join(' '), email: m.email ?? '', phone: m.phone ?? '' }
  const [f, setF] = useState(initial)
  const dirty = f.name !== initial.name || f.email !== initial.email || f.phone !== initial.phone
  const inp: React.CSSProperties = { font: '13px system-ui', border: '1px solid #d1d5db', borderRadius: 8, padding: '7px 9px', boxSizing: 'border-box', width: '100%' }
  const link = (color: string): React.CSSProperties => ({ font: '11px system-ui', color, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', padding: 0 })
  return (
    <li style={{ border: '1px solid #f3f4f6', borderRadius: 10, padding: 10, opacity: m.active ? 1 : 0.6, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <input style={inp} placeholder="Name" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} />
        <input style={inp} placeholder="Phone" value={f.phone} onChange={e => setF(s => ({ ...s, phone: e.target.value }))} />
      </div>
      <input style={inp} placeholder="Email" value={f.email} onChange={e => setF(s => ({ ...s, email: e.target.value }))} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => onSave(f)} disabled={!dirty || busy}
          style={{ font: '600 12px system-ui', background: dirty ? '#f26a1b' : '#e5e7eb', color: dirty ? '#fff' : '#9ca3af', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: dirty && !busy ? 'pointer' : 'default' }}>Save</button>
        <span style={{ flex: 1 }} />
        {!m.active && <span style={{ font: '11px system-ui', color: '#9ca3af' }}>inactive</span>}
        <button onClick={onToggle} style={link(m.active ? '#b91c1c' : '#2563eb')}>{m.active ? 'Deactivate' : 'Reactivate'}</button>
        <button onClick={onRemove} style={link('#6b7280')}>Remove</button>
      </div>
    </li>
  )
}
