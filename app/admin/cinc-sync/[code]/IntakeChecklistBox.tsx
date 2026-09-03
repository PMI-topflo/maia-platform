'use client'

// Pre-Application intake document checklist (B4) on the Association Hub. Shows,
// per application type (Lease / Purchase / Lease Renewal / Additional Occupant),
// exactly which documents each party must provide — editable per association.
// The public intake, staff audit, and MAIA/Checkr population all read this.

import { useCallback, useEffect, useState } from 'react'

interface Doc { id: string; doc_key: string; label: string; provided_by: 'applicant' | 'landlord' | 'agent'; required: boolean; note: string | null; sort_order: number }
interface TypeMeta { key: string; label: string; blurb: string }
interface Data { types: TypeMeta[]; checklist: Record<string, Doc[]> }

const PROVIDER_LABEL: Record<string, string> = { applicant: 'Applicant', landlord: 'Landlord', agent: 'Agent' }

export default function IntakeChecklistBox({ code }: { code: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr]   = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [addFor, setAddFor] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/admin/intake-documents?code=${encodeURIComponent(code)}`, { credentials: 'include' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(setData).catch(e => setErr(String(e.message ?? e)))
  }, [code])
  useEffect(load, [load])

  const del = async (id: string) => {
    if (!confirm('Remove this document from the checklist?')) return
    setBusy(id)
    try { const r = await fetch(`/api/admin/intake-documents/${id}`, { method: 'DELETE', credentials: 'include' }); if (!r.ok) throw new Error((await r.json()).error); load() }
    catch (e) { alert(`Could not remove: ${(e as Error).message}`) } finally { setBusy(null) }
  }
  const toggleReq = async (d: Doc) => {
    setBusy(d.id)
    try { const r = await fetch(`/api/admin/intake-documents/${d.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ required: !d.required }) }); if (!r.ok) throw new Error((await r.json()).error); load() }
    catch (e) { alert(`Could not update: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  if (err) return <div style={box}><h3 style={h3}>Application document checklist</h3><p style={{ font: '12px system-ui', color: '#991b1b' }}>{err}</p></div>

  return (
    <div style={box}>
      <h3 style={h3}>Application document checklist</h3>
      <p style={{ font: '11px system-ui', color: '#6b7280', margin: '4px 0 10px' }}>What each applicant must provide per application type — drives the Pre-Application intake, staff audit, and MAIA/Checkr.</p>
      <ScreeningProviderToggle code={code} />
      {!data ? <p style={{ font: '12px system-ui', color: '#9ca3af' }}>Loading…</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {data.types.map(t => {
            const docs = data.checklist[t.key] ?? []
            return (
              <div key={t.key} style={{ borderTop: '1px solid #f3f4f6', paddingTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div><span style={{ font: '700 13px system-ui', color: '#111827' }}>{t.label}</span> <span style={{ font: '400 11px system-ui', color: '#9ca3af' }}>{t.blurb}</span></div>
                  <button onClick={() => setAddFor(addFor === t.key ? null : t.key)} style={linkBtn}>{addFor === t.key ? 'Cancel' : '+ Add document'}</button>
                </div>
                {docs.length === 0 && <div style={{ font: '12px system-ui', color: '#b45309', marginTop: 4 }}>No documents configured for this type.</div>}
                <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {docs.map(d => (
                    <li key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, font: '12px system-ui', color: '#374151', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>{d.label}</span>
                      <span style={{ font: '600 10px system-ui', color: '#4338ca', background: '#eef2ff', borderRadius: 5, padding: '1px 6px' }}>{PROVIDER_LABEL[d.provided_by]}</span>
                      <button onClick={() => toggleReq(d)} disabled={busy === d.id} title="Toggle required" style={{ ...tag, color: d.required ? '#166534' : '#6b7280', background: d.required ? '#dcfce7' : '#f3f4f6', cursor: 'pointer', border: 'none' }}>{d.required ? 'Required' : 'Optional'}</button>
                      {d.note && <span style={{ color: '#9ca3af', fontSize: 11 }}>· {d.note}</span>}
                      <button onClick={() => del(d.id)} disabled={busy === d.id} style={{ ...linkBtn, color: '#991b1b', marginLeft: 'auto' }}>remove</button>
                    </li>
                  ))}
                </ul>
                {addFor === t.key && <AddRow code={code} type={t.key} onDone={() => { setAddFor(null); load() }} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Where an approved intake hands off for the background check. The
// 'tenant_evaluation' DB value is unchanged (no migration needed) but the
// label now reads "Rentvine Screening" — Tenant Evaluation itself is
// retired, and staff use this slot for the manual Rentvine fallback
// instead (see RentvineFallbackSender, app/admin/pre-apply/[id]/page.tsx).
// MANXI flipped to maia_checkr 2026-09-03 once the Checkr key mode read
// LIVE on /admin/tools; this option is planned for removal once every
// association has migrated off it.
function ScreeningProviderToggle({ code }: { code: string }) {
  const [provider, setProvider] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { fetch(`/api/admin/screening-provider?code=${encodeURIComponent(code)}`, { credentials: 'include' }).then(r => r.json()).then(d => setProvider(d.provider)).catch(() => {}) }, [code])
  const set = async (p: string) => {
    setBusy(true)
    try { const r = await fetch('/api/admin/screening-provider', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, provider: p }) }); if (!r.ok) throw new Error((await r.json()).error); setProvider(p) }
    catch (e) { alert(`Could not change: ${(e as Error).message}`) } finally { setBusy(false) }
  }
  if (provider === null) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
      <span style={{ font: '600 11px system-ui', color: '#6b7280' }}>On approval, screen via:</span>
      {[{ k: 'tenant_evaluation', l: 'Rentvine Screening' }, { k: 'maia_checkr', l: 'MAIA + Checkr' }].map(o => (
        <button key={o.k} onClick={() => set(o.k)} disabled={busy || provider === o.k}
          style={{ font: '600 11px system-ui', padding: '4px 10px', borderRadius: 6, cursor: provider === o.k ? 'default' : 'pointer', border: `1px solid ${provider === o.k ? '#2563eb' : '#d1d5db'}`, background: provider === o.k ? '#eff6ff' : '#fff', color: provider === o.k ? '#1d4ed8' : '#374151' }}>{o.l}</button>
      ))}
      {provider === 'maia_checkr' && <span style={{ font: '10px system-ui', color: '#b45309' }}>⚠ Checkr must be production-authorized</span>}
    </div>
  )
}

function AddRow({ code, type, onDone }: { code: string; type: string; onDone: () => void }) {
  const [label, setLabel] = useState('')
  const [key, setKey] = useState('')
  const [provider, setProvider] = useState<'applicant' | 'landlord' | 'agent'>('applicant')
  const [required, setRequired] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const submit = async () => {
    if (!label.trim()) { setMsg('Enter a label.'); return }
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/admin/intake-documents', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, application_type: type, doc_key: key || label, label, provided_by: provider, required }),
      })
      if (!r.ok) throw new Error((await r.json()).error); onDone()
    } catch (e) { setMsg(`Could not add: ${(e as Error).message}`); setBusy(false) }
  }
  return (
    <div style={{ marginTop: 8, background: '#f9fafb', borderRadius: 8, padding: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <input placeholder="Document label" value={label} onChange={e => setLabel(e.target.value)} style={{ ...mini, minWidth: 180 }} />
      <input placeholder="key (optional)" value={key} onChange={e => setKey(e.target.value)} style={{ ...mini, width: 120 }} />
      <select value={provider} onChange={e => setProvider(e.target.value as 'applicant' | 'landlord' | 'agent')} style={mini}><option value="applicant">Applicant</option><option value="landlord">Landlord</option><option value="agent">Agent</option></select>
      <label style={{ font: '12px system-ui', display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} /> Required</label>
      <button onClick={submit} disabled={busy} style={{ ...linkBtn, color: '#166534' }}>{busy ? '…' : 'Add'}</button>
      {msg && <span style={{ font: '11px system-ui', color: '#991b1b' }}>{msg}</span>}
    </div>
  )
}

const box: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 }
const h3: React.CSSProperties = { font: '700 15px system-ui', margin: 0 }
const linkBtn: React.CSSProperties = { font: '600 11px system-ui', color: '#2563eb', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }
const tag: React.CSSProperties = { font: '600 10px system-ui', borderRadius: 5, padding: '1px 6px' }
const mini: React.CSSProperties = { font: '12px system-ui', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: 6 }
