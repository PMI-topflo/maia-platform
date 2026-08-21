'use client'

// Public token-gated page where an owner/tenant uploads the documents PMI asked
// for on an application. No login — the link is the auth.

import { use, useCallback, useEffect, useState } from 'react'
import { OCCUPANT_ROLES, applicantRoleLabel } from '@/lib/applicant-roles'
import { ANIMAL_KIND_LABEL, ANIMAL_KIND_BLURB, type AnimalKind } from '@/lib/animal-accommodation'

interface Item {
  doc_key: string; label: string; uploaded: boolean; kind?: 'contact' | 'file' | 'declare' | 'esign_packet'
  declareKey?: 'vehicle' | 'animal'; has?: boolean | null; animalKind?: AnimalKind | null
  exampleUrl?: string | null
  packetStatus?: 'not_sent' | 'sent' | 'partially_signed' | 'completed'; mySigned?: boolean; otherSigned?: boolean
}
interface Person { name: string; email: string; phone: string; role: string }
interface Data { associationName: string; associationCode: string; propertyAddress: string | null; unit: string | null; role: string; message: string | null; note?: string | null; tenantName?: string | null; people?: Person[]; applicationType?: string | null; items: Item[] }

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
              : it.kind === 'declare'
              ? <DeclareRow key={it.doc_key} token={token} item={it} onDone={load} />
              : it.kind === 'esign_packet'
              ? <EsignPacketRow key={it.doc_key} token={token} item={it} role={d.role} onDone={load} />
              : <ItemRow key={it.doc_key} token={token} item={it} onDone={load} />)}
          </div>
        )}
        <MessageBox token={token} initial={d.note ?? ''} />
        <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 20, borderTop: '1px solid #e7e2d9', paddingTop: 14 }}>Secure upload · PDF or image · no login needed. Questions? Reply to the email or contact support@topfloridaproperties.com.</p>
        <ForwardEmailHint associationCode={d.associationCode} unit={d.unit} />
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

// Forwarding an email straight to maia@pmitop.com is often faster for the
// owner/tenant than coming back to this link — a renewed insurance
// declaration, a signed page, anything. Same "@maia upapp <ACCOUNT>" tag
// staff already see on the admin screen (app/admin/pre-apply/[id]/page.tsx's
// CommunicationsLog), now copy-pasteable here too so it reaches the same
// application's filed history either way. User direction, 2026-08-21.
function ForwardEmailHint({ associationCode, unit }: { associationCode: string; unit: string | null }) {
  const [copied, setCopied] = useState(false)
  const cmd = `@maia upapp ${associationCode}${unit ?? ''}`
  async function copy() {
    try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* clipboard unavailable */ }
  }
  return (
    <div style={{ marginTop: 14, border: '1px solid #e7e2d9', borderRadius: 10, background: '#faf8f4', padding: '12px 14px' }}>
      <p style={{ font: '600 12.5px system-ui', color: '#3f4756', margin: '0 0 8px', lineHeight: 1.5 }}>
        Prefer to just forward an email instead? Send it to <strong>maia@pmitop.com</strong> with this line included in the body, and it&apos;s filed on this application automatically:
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <code style={{ flex: 1, background: '#eef2ff', color: '#3730a3', padding: '7px 10px', borderRadius: 6, font: '600 12.5px ui-monospace,monospace', wordBreak: 'break-all' }}>{cmd}</code>
        <button onClick={copy} style={{ cursor: 'pointer', font: '700 12.5px system-ui', color: '#fff', background: copied ? '#166534' : '#c0571a', border: 'none', borderRadius: 7, padding: '8px 13px', whiteSpace: 'nowrap' }}>{copied ? '✓ Copied' : 'Copy'}</button>
      </div>
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

// Vehicle/animal — answered as a real Yes/No control on this same link,
// writing straight into listing_applications.declarations via
// /api/request/[token]/declare. Before this, the question went out as plain
// text in the email and a human had to read the reply and transcribe it.
// User direction, 2026-08-18: "why is he replying to the questions by
// email? Why the card link don't make these questions and save in Maia?"
function DeclareRow({ token, item, onDone }: { token: string; item: Item; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function save(body: Record<string, unknown>, tag: string) {
    setBusy(tag); setErr(null)
    try {
      const r = await fetch(`/api/request/${token}/declare`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'save failed')
      onDone()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  const yn = (on: boolean, active: boolean): React.CSSProperties => ({
    padding: '9px 20px', borderRadius: 9, font: '700 14px system-ui', cursor: 'pointer',
    border: `1.5px solid ${active ? (on ? '#0f7a4d' : '#b45309') : '#d1d5db'}`,
    background: active ? (on ? '#ecfdf5' : '#fffbeb') : '#fff',
    color: active ? (on ? '#0f7a4d' : '#b45309') : '#374151',
  })

  const answered = item.uploaded
  const isVehicle = item.declareKey === 'vehicle'

  return (
    <div style={{ border: '1px solid #e7e2d9', borderRadius: 10, padding: '14px 16px', background: answered ? '#f6faf7' : '#fff' }}>
      <div style={{ font: '600 14.5px system-ui', color: '#1c2333', marginBottom: 10 }}>{item.label}</div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => save({ [item.declareKey!]: true }, 'y')} disabled={!!busy} style={yn(true, item.has === true)}>Yes</button>
        <button onClick={() => save({ [item.declareKey!]: false }, 'n')} disabled={!!busy} style={yn(false, item.has === false)}>No</button>
      </div>

      {isVehicle && item.has === false && (
        <p style={{ font: '600 12.5px system-ui', color: '#166534', margin: '10px 0 0' }}>✓ Got it — no vehicle registration will be requested.</p>
      )}
      {isVehicle && item.has === true && (
        <p style={{ font: '12.5px system-ui', color: '#166534', margin: '10px 0 0' }}>✓ Thanks — we&apos;ll follow up for the vehicle registration.</p>
      )}

      {!isVehicle && item.has === false && (
        <p style={{ font: '600 12.5px system-ui', color: '#166534', margin: '10px 0 0' }}>✓ Got it — no animal documents will be requested.</p>
      )}

      {!isVehicle && item.has === true && (
        <div style={{ marginTop: 12 }}>
          <div style={{ font: '600 13.5px system-ui', color: '#1c2333', marginBottom: 4 }}>What kind of animal?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(Object.keys(ANIMAL_KIND_LABEL) as AnimalKind[]).map(k => {
              const on = item.animalKind === k
              return (
                <button key={k} onClick={() => save({ animal: true, animalKind: k }, k)} disabled={!!busy}
                  style={{ textAlign: 'left', border: `1.5px solid ${on ? '#c0571a' : '#e2e5ec'}`, background: on ? '#fff7f0' : '#fff', borderRadius: 10, padding: '11px 13px', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <div style={{ font: '700 14px system-ui', color: '#1c2333' }}>{ANIMAL_KIND_LABEL[k]}</div>
                  <div style={{ font: '12.5px system-ui', color: '#6b7280', marginTop: 2, lineHeight: 1.45 }}>{ANIMAL_KIND_BLURB[k]}</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {err && <div style={{ font: '12.5px system-ui', color: '#b91c1c', marginTop: 8 }}>{err}</div>}
    </div>
  )
}

// The Landlord-Tenant Agreement is MAIA's own e-signed packet (owner + tenant
// both sign) — never a file to upload. User direction, 2026-08-21: keep it
// listed as outstanding until it's actually signed, with a button to push
// the signing links, rather than removing it from the card once nobody can
// satisfy it as an upload.
function EsignPacketRow({ token, item, role, onDone }: { token: string; item: Item; role: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function send() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/request/${token}/lease-packet`, { method: 'POST' })
      if (!r.ok) throw new Error((await r.json()).error || 'failed')
      onDone()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const status = item.packetStatus ?? 'not_sent'
  const statusLine =
    status === 'completed' ? '✓ Signed — thank you'
    : status === 'not_sent' ? null
    : item.mySigned ? `Sent — waiting on the ${role === 'owner' ? 'tenant' : 'owner'} to sign`
    : 'Sent — check your inbox (or spam) for the link to sign';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #e7e2d9', borderRadius: 10, padding: '12px 14px', background: status === 'completed' ? '#f6faf7' : '#fff' }}>
      <div style={{ flex: 1 }}>
        <div style={{ font: '600 14.5px system-ui', color: '#1c2333' }}>{item.label}</div>
        {statusLine && <div style={{ font: `600 12.5px system-ui`, color: status === 'completed' ? '#166534' : '#b45309' }}>{statusLine}</div>}
        {err && <div style={{ font: '12.5px system-ui', color: '#b91c1c' }}>{err}</div>}
      </div>
      {status === 'not_sent' && (
        <button onClick={send} disabled={busy} style={{ cursor: busy ? 'default' : 'pointer', font: '700 13px system-ui', color: '#fff', background: busy ? '#c9ccd3' : '#c0571a', border: 'none', borderRadius: 9, padding: '9px 16px' }}>
          {busy ? 'Sending…' : 'Send to sign'}
        </button>
      )}
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
        {/* A blank form to fill out, sign, and get notarized before uploading
            back here — Tenant Affidavit and similar items have nowhere else
            this link would show one. User direction, 2026-08-19. */}
        {item.exampleUrl && !item.uploaded && (
          <a href={item.exampleUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 4, font: '600 12px system-ui', color: '#2563eb', textDecoration: 'none' }}>⬇ Download blank form</a>
        )}
      </div>
      <input id={inputId} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" style={{ display: 'none' }} onChange={e => onFile(e.target.files?.[0] ?? null)} />
      <label htmlFor={inputId} style={{ cursor: busy ? 'default' : 'pointer', font: '700 13px system-ui', color: '#fff', background: busy ? '#c9ccd3' : item.uploaded ? '#6b7280' : '#c0571a', borderRadius: 9, padding: '9px 16px' }}>
        {busy ? 'Uploading…' : item.uploaded ? 'Replace' : 'Upload'}
      </label>
    </div>
  )
}
