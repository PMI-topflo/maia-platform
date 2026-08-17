'use client'

// Public token-gated page where an owner/tenant uploads the documents PMI asked
// for on an application. No login — the link is the auth.

import { use, useCallback, useEffect, useState } from 'react'
import { OCCUPANT_ROLES, applicantRoleLabel } from '@/lib/applicant-roles'

interface Item { doc_key: string; label: string; uploaded: boolean; kind?: 'contact' | 'file' }
interface Person { name: string; email: string; phone: string; role: string }
interface Data { associationName: string; propertyAddress: string | null; unit: string | null; role: string; message: string | null; note?: string | null; tenantName?: string | null; people?: Person[]; applicationType?: string | null; items: Item[] }

export default function RequestUpload({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/request/${token}`).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(setD).catch(e => setErr(String(e.message ?? e)))
  }, [token])
  useEffect(load, [load])

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#eceef2', fontFamily: 'system-ui', padding: '28px 16px' }
  const card: React.CSSProperties = { maxWidth: 600, margin: '0 auto', background: '#fff', border: '1px solid #e7e2d9', borderRadius: 14, padding: '30px 32px' }

  if (err) return <div style={wrap}><div style={card}><h1 style={{ font: '800 20px Georgia,serif', color: '#1c2333' }}>Link unavailable</h1><p style={{ color: '#6b7280' }}>{err}</p><p style={{ color: '#9ca3af', fontSize: 13 }}>Please contact support@topfloridaproperties.com.</p></div></div>
  if (!d) return <div style={wrap}><div style={card}><p style={{ color: '#9ca3af' }}>Loading…</p></div></div>

  const done = d.items.every(i => i.uploaded)
  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ font: '700 11px system-ui', letterSpacing: '.14em', textTransform: 'uppercase', color: '#c0571a', marginBottom: 10 }}>PMI Top Florida Properties</div>
        <h1 style={{ font: '800 24px/1.2 Georgia,serif', color: '#1c2333', margin: '0 0 12px' }}>Upload your documents</h1>
        <div style={{ border: '1px solid #e7e2d9', borderRadius: 10, overflow: 'hidden', marginBottom: 18, fontSize: 13.5 }}>
          <div style={{ display: 'flex', gap: 12, padding: '9px 14px', background: '#faf8f4' }}><span style={{ width: 90, color: '#8a8f9a', font: '700 11px system-ui', textTransform: 'uppercase', letterSpacing: '.05em' }}>Association</span><b style={{ color: '#1c2333' }}>{d.associationName}</b></div>
          {d.propertyAddress && <div style={{ display: 'flex', gap: 12, padding: '9px 14px', borderTop: '1px solid #f2efe8' }}><span style={{ width: 90, color: '#8a8f9a', font: '700 11px system-ui', textTransform: 'uppercase', letterSpacing: '.05em' }}>Property</span><b style={{ color: '#1c2333' }}>{d.propertyAddress}</b></div>}
        </div>
        {d.message && <p style={{ fontSize: 14.5, color: '#3f4756', margin: '0 0 16px' }}>{d.message}</p>}

        {done ? (
          <div style={{ background: '#e8f3ec', border: '1px solid #15803d', borderRadius: 10, padding: 16, color: '#166534', fontWeight: 600 }}>✓ All done — thank you! You can close this page. We&apos;ll take it from here.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {d.items.map(it => it.kind === 'contact'
              ? <RosterRow key={it.doc_key} token={token} item={it} people={d.people ?? []} applicationType={d.applicationType ?? null} onDone={load} />
              : <ItemRow key={it.doc_key} token={token} item={it} onDone={load} />)}
          </div>
        )}
        <MessageBox token={token} initial={d.note ?? ''} />
        <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 20, borderTop: '1px solid #e7e2d9', paddingTop: 14 }}>Secure upload · PDF or image · no login needed. Questions? Reply to the email or contact support@topfloridaproperties.com.</p>
      </div>
    </div>
  )
}

// The owner tells us WHO is going to live in the unit — one row per person,
// name + email + phone. This is what lets us email the tenants directly for
// the documents only they can provide, so it has to accept a whole household,
// not one address.
function RosterRow({ token, item, people, applicationType, onDone }: { token: string; item: Item; people: Person[]; applicationType: string | null; onDone: () => void }) {
  // One named person, and the point is THEIR OWN address.
  const occupantOnly = applicationType === 'additional_occupant'
  const personName = (people[0]?.name ?? '').trim() || null
  const blank = (): Person => ({ name: '', email: '', phone: '', role: 'tenant' })
  const [rows, setRows] = useState<Person[]>(people.length ? people : [blank()])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState(!item.uploaded)
  const inp: React.CSSProperties = { font: '14px system-ui', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: 8, width: '100%', boxSizing: 'border-box' }
  const set = (i: number, k: keyof Person, v: string) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r))

  async function save() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/request/${token}/contact`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ people: rows }) })
      const j = await r.json() as { error?: string; tenantSent?: boolean }
      if (!r.ok) throw new Error(j.error || 'save failed')
      setEditing(false); onDone()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={{ border: '1px solid #e7e2d9', borderRadius: 10, padding: '14px 16px', background: item.uploaded && !editing ? '#f6faf7' : '#fff' }}>
      <div style={{ font: '600 14.5px system-ui', color: '#1c2333', marginBottom: 2 }}>{item.label}</div>
      {item.uploaded && !editing ? (
        <>
          <div style={{ font: '600 12.5px system-ui', color: '#166534', marginBottom: 6 }}>✓ Received — thank you</div>
          {rows.map((p, i) => <div key={i} style={{ font: '13px system-ui', color: '#3f4756' }}>{p.name} <span style={{ color: '#9ca3af' }}>({applicantRoleLabel(p.role) || 'Tenant'})</span> — {p.email} · {p.phone}</div>)}
          <button onClick={() => setEditing(true)} style={{ marginTop: 8, cursor: 'pointer', font: '600 12.5px system-ui', color: '#c0571a', background: 'none', border: 'none', padding: 0 }}>Add or correct someone</button>
        </>
      ) : (
        <>
          {/* On an ADDITIONAL OCCUPANT application this is one named person and
              the point is their OWN address. An occupant's paperwork came back
              carrying the tenant's email, which is exactly the collision this
              wording has to prevent: email is identity here — it is what the
              one-time code and the e-signature are tied to. */}
          <div style={{ font: '12.5px system-ui', color: '#6b7280', margin: '0 0 12px' }}>
            {occupantOnly ? (
              <>
                Please give us <strong>{personName ? `${personName}'s` : "the additional occupant's"} own email and phone number</strong> — their own, not yours and not the current tenant&apos;s.
                We email them directly for the documents only they can provide, and their email is what their one-time code and their signature are tied to, so a shared address would record their signature against somebody else&apos;s mailbox.
              </>
            ) : (
              <>
                Please list <strong>everyone who will live in the unit</strong> — their full name, email and phone. We email each person directly for the documents only they can provide (ID, income, and so on), so we need a real address for each adult.
              </>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {rows.map((p, i) => (
              <div key={i} style={{ border: '1px solid #eee9e0', borderRadius: 9, padding: 12, background: '#faf8f4' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                  <span style={{ font: '700 11px system-ui', letterSpacing: '.06em', textTransform: 'uppercase', color: '#8a8f9a' }}>Person {i + 1}</span>
                  {rows.length > 1 && <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} style={{ cursor: 'pointer', font: '600 12px system-ui', color: '#b91c1c', background: 'none', border: 'none', padding: 0 }}>Remove</button>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input value={p.name} onChange={e => set(i, 'name', e.target.value)} placeholder="Full name" style={inp} />
                  <input value={p.email} onChange={e => set(i, 'email', e.target.value)} type="email" placeholder="Email" style={inp} />
                  <input value={p.phone} onChange={e => set(i, 'phone', e.target.value)} placeholder="Phone" style={inp} />
                  <select value={p.role} onChange={e => set(i, 'role', e.target.value)} style={{ ...inp, background: '#fff' }}>
                    {OCCUPANT_ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </div>
              </div>
            ))}
            <button onClick={() => setRows(rs => [...rs, blank()])} style={{ cursor: 'pointer', font: '700 13px system-ui', color: '#c0571a', background: '#fff7f0', border: '1px dashed #e8b48b', borderRadius: 9, padding: '9px 14px', alignSelf: 'flex-start' }}>+ Add another person</button>
            {err && <div style={{ font: '12.5px system-ui', color: '#b91c1c' }}>{err}</div>}
            <button onClick={save} disabled={busy} style={{ cursor: busy ? 'default' : 'pointer', font: '700 14px system-ui', color: '#fff', background: busy ? '#c9ccd3' : '#c0571a', border: 'none', borderRadius: 9, padding: '10px 18px', alignSelf: 'flex-start' }}>{busy ? 'Saving…' : `Save ${rows.length > 1 ? `all ${rows.length}` : 'contact'}`}</button>
          </div>
        </>
      )}
    </div>
  )
}

// A message the owner/tenant can leave for us — registered as communication history.
function MessageBox({ token, initial }: { token: string; initial: string }) {
  const [note, setNote] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  async function save() {
    setBusy(true); setSaved(false)
    try {
      const r = await fetch(`/api/request/${token}/note`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note }) })
      if (!r.ok) throw new Error((await r.json()).error || 'failed')
      setSaved(true)
    } catch { /* */ } finally { setBusy(false) }
  }
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ font: '600 13px system-ui', color: '#1c2333', marginBottom: 6 }}>Leave us a message (optional)</div>
      <textarea value={note} onChange={e => { setNote(e.target.value); setSaved(false) }} placeholder="Anything we should know? e.g. a document is on its way, a question…" style={{ width: '100%', boxSizing: 'border-box', minHeight: 70, padding: 10, border: '1px solid #d1d5db', borderRadius: 8, font: '14px system-ui' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
        <button onClick={save} disabled={busy} style={{ cursor: busy ? 'default' : 'pointer', font: '700 13px system-ui', color: '#fff', background: busy ? '#c9ccd3' : '#1c2333', border: 'none', borderRadius: 8, padding: '8px 16px' }}>{busy ? 'Sending…' : 'Send message'}</button>
        {saved && <span style={{ font: '600 12.5px system-ui', color: '#166534' }}>✓ Sent — thank you</span>}
      </div>
    </div>
  )
}

function ItemRow({ token, item, onDone }: { token: string; item: Item; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputId = `f-${item.doc_key}`
  async function onFile(file: File | null) {
    if (!file) return
    setBusy(true); setErr(null)
    try {
      const fd = new FormData(); fd.append('doc_key', item.doc_key); fd.append('file', file)
      const r = await fetch(`/api/request/${token}/upload`, { method: 'POST', body: fd })
      if (!r.ok) throw new Error((await r.json()).error || 'upload failed')
      onDone()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #e7e2d9', borderRadius: 10, padding: '12px 14px', background: item.uploaded ? '#f6faf7' : '#fff' }}>
      <div style={{ flex: 1 }}>
        <div style={{ font: '600 14.5px system-ui', color: '#1c2333' }}>{item.label}</div>
        {item.uploaded ? <div style={{ font: '600 12.5px system-ui', color: '#166534' }}>✓ Received</div> : err ? <div style={{ font: '12.5px system-ui', color: '#b91c1c' }}>{err}</div> : null}
      </div>
      <input id={inputId} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" style={{ display: 'none' }} onChange={e => onFile(e.target.files?.[0] ?? null)} />
      <label htmlFor={inputId} style={{ cursor: busy ? 'default' : 'pointer', font: '700 13px system-ui', color: '#fff', background: busy ? '#c9ccd3' : item.uploaded ? '#6b7280' : '#c0571a', borderRadius: 9, padding: '9px 16px' }}>
        {busy ? 'Uploading…' : item.uploaded ? 'Replace' : 'Upload'}
      </label>
    </div>
  )
}
