'use client'

// =====================================================================
// app/esign/[token]/EmergencyContactFill.tsx
//
// The Emergency Contact List, as the owner or renter fills it in. Rendered by
// the generic e-sign page when the document still needs its answers.
//
// ONE form that adapts: a non-resident owner is confirming their TENANT's
// household, so the occupant section arrives prefilled from the tenant record
// and is reworded. Everything else is asked identically.
//
// The evacuation question is disability-adjacent and is written the way the
// animal questionnaire is written: optional, one yes/no, its purpose stated on
// screen, and NO field for a reason. The server whitelist (see
// /api/esign/[token]/fill) is what actually guarantees a reason cannot be
// stored — this wording just means nobody is invited to give one.
// =====================================================================

import { useState } from 'react'

export interface EmergencyOccupantClient { name: string; note?: string }
export interface EmergencyPayloadClient {
  audience?: 'resident' | 'landlord'
  occupants?: EmergencyOccupantClient[]
  contacts?: { name?: string; relationship?: string; phone?: string; email?: string }[]
  occupancy?: Occupancy
  language?: string
  tenants?: { name?: string; email?: string; phone?: string }[]
}

type Occupancy = 'owner_occupied' | 'leased' | 'vacant'
interface Contact { name: string; relationship: string; phone: string; email: string }
interface TenantRow { name: string; email: string; phone: string }
const blank = (): Contact => ({ name: '', relationship: '', phone: '', email: '' })
const blankTenant = (): TenantRow => ({ name: '', email: '', phone: '' })

const OCCUPANCY: { key: Occupancy; label: string; hint: string }[] = [
  { key: 'owner_occupied', label: 'I live here', hint: 'Owner-occupied' },
  { key: 'leased', label: 'It is rented', hint: 'A tenant lives here' },
  { key: 'vacant', label: 'Nobody lives here', hint: 'Vacant right now' },
]

// Kept in step with PORTAL_LANGS in lib/portal-i18n.ts. Each label is written
// in its own language — somebody who reads little English still finds theirs.
const LANGUAGES: { key: string; label: string }[] = [
  { key: 'en', label: 'English' }, { key: 'es', label: 'Español' },
  { key: 'pt', label: 'Português' }, { key: 'fr', label: 'Français' },
  { key: 'ht', label: 'Kreyòl Ayisyen' }, { key: 'he', label: 'עברית' },
  { key: 'ru', label: 'Русский' },
]

const inp: React.CSSProperties = { font: '14px system-ui', padding: '9px 10px', border: '1px solid #d1d5db', borderRadius: 8, width: '100%', boxSizing: 'border-box' }
const label: React.CSSProperties = { font: '600 13px system-ui', color: '#1f2937', marginBottom: 3 }
const hint: React.CSSProperties = { font: '12.5px system-ui', color: '#6b7280', margin: '0 0 10px', lineHeight: 1.5 }
const section: React.CSSProperties = { borderTop: '1px solid #eef0f3', paddingTop: 16, marginTop: 18 }

// Kept verbatim in step with lib/esign-forms.tsx → EMERGENCY_LIABILITY, which
// is what the signed PDF prints. Duplicated as a literal rather than imported
// because that module pulls in @react-pdf/renderer, which has no business in
// the browser bundle.
const LIABILITY_TEXT = 'The Association maintains this list as a courtesy and will make reasonable efforts to use it. It does not undertake to reach any person named here, and cannot guarantee that contact will be made, or made in time — an emergency is unpredictable, and telephone, internet and postal service may be unavailable during one. Keeping these details current is the responsibility of the person who signed this form, and the Association is not responsible for the consequences of information that is out of date, incomplete or incorrect, or of being unable to reach any person listed. Nothing in this form obliges the Association to provide emergency, medical, rescue or evacuation services, and nothing in it limits or waives any duty the Association owes under Chapter 718, Florida Statutes, or under its governing documents. In a life-safety emergency, call 911 first.'

export function EmergencyContactFill({ token, payload, onFilled }: {
  token: string
  payload: EmergencyPayloadClient | null
  onFilled: () => void
}) {
  const landlord = payload?.audience === 'landlord'
  const [occupants, setOccupants] = useState<EmergencyOccupantClient[]>(
    payload?.occupants?.length ? payload.occupants : [{ name: '', note: '' }],
  )
  // Seeded from the payload when staff already know who to call — a resident
  // who told the office their contacts by email or phone shouldn't have to
  // retype them here. This used to ignore payload.contacts entirely and
  // always render two empty boxes, silently discarding any prefill.
  const [contacts, setContacts] = useState<Contact[]>(
    payload?.contacts?.length
      ? payload.contacts.map(c => ({ name: c.name ?? '', relationship: c.relationship ?? '', phone: c.phone ?? '', email: c.email ?? '' }))
      : [blank(), blank()],
  )
  const [occupancy, setOccupancy] = useState<Occupancy | null>(payload?.occupancy ?? null)
  const [language, setLanguage] = useState<string>(payload?.language ?? 'en')
  const [tenants, setTenants] = useState<TenantRow[]>(
    payload?.tenants?.length
      ? payload.tenants.map(t => ({ name: t.name ?? '', email: t.email ?? '', phone: t.phone ?? '' }))
      : [blankTenant()],
  )
  const [keyHolder, setKeyHolder] = useState('')
  const [keyPhone, setKeyPhone] = useState('')
  const [mayEnter, setMayEnter] = useState(false)
  const [assist, setAssist] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const updOcc = (i: number, patch: Partial<EmergencyOccupantClient>) =>
    setOccupants(o => o.map((x, j) => j === i ? { ...x, ...patch } : x))
  const updCon = (i: number, patch: Partial<Contact>) =>
    setContacts(c => c.map((x, j) => j === i ? { ...x, ...patch } : x))

  const updTenant = (i: number, patch: Partial<TenantRow>) =>
    setTenants(t => t.map((x, j) => j === i ? { ...x, ...patch } : x))

  async function save() {
    setErr(null)
    const named = contacts.filter(c => c.name.trim())
    const namedTenants = tenants.filter(t => t.name.trim())
    if (!occupancy) { setErr('Tell us how the unit is used.'); return }
    if (occupancy === 'leased' && namedTenants.length === 0) {
      setErr('The unit is rented — please give us at least the tenant’s name.'); return
    }
    if (named.length === 0) { setErr('Add at least one emergency contact.'); return }
    if (!named[0].phone.trim() && !named[0].email.trim()) {
      setErr(`Add a phone number or an email for ${named[0].name.trim()} — without one there is no way to reach them.`); return
    }
    if (!agreed) { setErr('Please confirm the details are correct before signing.'); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/esign/${token}/fill`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          occupants: occupants.filter(o => o.name.trim()),
          contacts: named,
          occupancy, language,
          tenants: occupancy === 'leased' ? namedTenants : [],
          access: { keyHolder, keyHolderPhone: keyPhone, mayEnter },
          assistance: { needed: assist },
        }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not save')
      onFilled()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div>
      {/* ── How the unit is used ─────────────────────────────────────
          Asked first because it decides what the rest of the form needs:
          a rented unit has to name its tenants, a vacant one has nobody to
          list. It is also the answer the Association most often does not
          have — occupancy is what says which documents a unit even owes. */}
      <div>
        <div style={label}>How is this unit used?</div>
        <p style={hint}>So we ask you for the right things, and stop asking for the wrong ones.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {OCCUPANCY.map(o => {
            const on = occupancy === o.key
            return (
              <button key={o.key} onClick={() => { setOccupancy(o.key); setErr(null) }}
                style={{
                  flex: '1 1 150px', textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                  border: on ? '2px solid #f26a1b' : '1px solid #d1d5db', background: on ? '#fff7ed' : '#fff',
                }}>
                <div style={{ font: '600 14px system-ui', color: on ? '#c2410c' : '#111827' }}>{o.label}</div>
                <div style={{ font: '11.5px system-ui', color: '#6b7280' }}>{o.hint}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Tenants, only when it is rented ──────────────────────────
          Their EMAIL is the point. Without it the Association can reach the
          landlord and nobody who actually lives in the unit, so every request
          for a tenant's own document has to be relayed by their landlord. */}
      {occupancy === 'leased' && (
        <div style={section}>
          <div style={label}>Who rents it?</div>
          <p style={hint}>
            With their email we can write to them directly for the things only they can give us — their ID, their lease, their renter&apos;s insurance —
            instead of sending everything through you.
          </p>
          {tenants.map((t, i) => (
            <div key={i} style={{ border: '1px solid #eef0f3', borderRadius: 8, padding: 10, marginBottom: 8, background: '#fafafa' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ font: '700 11px system-ui', letterSpacing: '.05em', textTransform: 'uppercase', color: '#8a8f9a' }}>Tenant {i + 1}</span>
                {tenants.length > 1 && (
                  <button onClick={() => setTenants(x => x.filter((_, j) => j !== i))}
                    style={{ font: '600 12px system-ui', color: '#b42318', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Remove</button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
                <input value={t.name} onChange={e => { updTenant(i, { name: e.target.value }); setErr(null) }} placeholder="Full name" style={inp} />
                <input value={t.email} onChange={e => updTenant(i, { email: e.target.value })} placeholder="Their email" style={inp} />
                <input value={t.phone} onChange={e => updTenant(i, { phone: e.target.value })} placeholder="Their phone" style={inp} />
              </div>
            </div>
          ))}
          <button onClick={() => setTenants(t => [...t, blankTenant()])}
            style={{ font: '600 12.5px system-ui', color: '#374151', background: '#fff', border: '1px dashed #d1d5db', borderRadius: 8, padding: '7px 13px', cursor: 'pointer' }}>+ Add another tenant</button>
        </div>
      )}

      {/* ── Language ─────────────────────────────────────────────────
          Every label is in its own language, so somebody who reads little
          English can still find theirs. */}
      <div style={section}>
        <div style={label}>What language should we write to you in?</div>
        <p style={hint}>MAIA will use it for everything we send you from now on.</p>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {LANGUAGES.map(l => {
            const on = language === l.key
            return (
              <button key={l.key} onClick={() => setLanguage(l.key)}
                style={{
                  font: `${on ? 700 : 600} 13px system-ui`, cursor: 'pointer', borderRadius: 999, padding: '7px 14px',
                  border: on ? '2px solid #f26a1b' : '1px solid #d1d5db', background: on ? '#fff7ed' : '#fff',
                  color: on ? '#c2410c' : '#374151',
                }}>{l.label}</button>
            )
          })}
        </div>
      </div>

      {/* Who lives here. For a landlord this arrives prefilled from the tenant
          record — they are checking our list, not writing one from memory. */}
      <div style={section}>
        <div style={label}>{landlord ? 'Who lives in the unit' : 'Who lives here'}</div>
        <p style={hint}>
          {landlord
            ? 'These are the residents we have on file. Correct anything that is out of date.'
            : 'Everyone who normally sleeps in the unit.'}
        </p>
        {occupants.map((o, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <input value={o.name} onChange={e => updOcc(i, { name: e.target.value })} placeholder="Full name" style={inp} />
            <input value={o.note ?? ''} onChange={e => updOcc(i, { note: e.target.value })} placeholder="Adult / child" style={{ ...inp, maxWidth: 150 }} />
            {occupants.length > 1 && (
              <button onClick={() => setOccupants(x => x.filter((_, j) => j !== i))}
                style={{ font: '600 12px system-ui', color: '#b42318', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '7px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Remove</button>
            )}
          </div>
        ))}
        <button onClick={() => setOccupants(o => [...o, { name: '', note: '' }])}
          style={{ font: '600 12.5px system-ui', color: '#374151', background: '#fff', border: '1px dashed #d1d5db', borderRadius: 8, padding: '7px 13px', cursor: 'pointer' }}>+ Add a person</button>
      </div>

      {/* Up to 4 (the server whitelist's own cap — see /api/esign/[token]/fill).
          This used to be a fixed two-box layout with no way to add a third,
          so a resident who named three people to call had no way to enter
          all of them and the third was silently dropped. */}
      {contacts.map((c, i) => (
        <div key={i} style={section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <div style={label}>
              Emergency contact {i + 1}
              {i === 0
                ? <span style={{ color: '#b42318', fontWeight: 400 }}> · required</span>
                : <span style={{ color: '#9ca3af', fontWeight: 400 }}> · optional</span>}
            </div>
            {contacts.length > 2 && i > 0 && (
              <button onClick={() => setContacts(cs => cs.filter((_, j) => j !== i))}
                style={{ font: '600 12px system-ui', color: '#b42318', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Remove</button>
            )}
          </div>
          <p style={hint}>
            {i === 0
              ? 'Someone who does not live in the unit.'
              : i === 1
                ? 'Ideally someone outside South Florida — in a hurricane, local contacts are evacuating too.'
                : 'Another person we can call.'}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
            <input value={c.name} onChange={e => updCon(i, { name: e.target.value })} placeholder="Full name" style={inp} />
            <input value={c.relationship} onChange={e => updCon(i, { relationship: e.target.value })} placeholder="Relationship to you" style={inp} />
            <input value={c.phone} onChange={e => updCon(i, { phone: e.target.value })} placeholder="Phone" style={inp} />
            <input value={c.email} onChange={e => updCon(i, { email: e.target.value })} placeholder="Email" style={inp} />
          </div>
        </div>
      ))}
      {contacts.length < 4 && (
        <button onClick={() => setContacts(cs => [...cs, blank()])}
          style={{ font: '600 12.5px system-ui', color: '#374151', background: '#fff', border: '1px dashed #d1d5db', borderRadius: 8, padding: '7px 13px', cursor: 'pointer', marginTop: 10 }}>+ Add another contact</button>
      )}

      <div style={section}>
        <div style={label}>Access to the unit</div>
        <p style={hint}>If we cannot reach anyone, this is who can let us in.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8, marginBottom: 10 }}>
          <input value={keyHolder} onChange={e => setKeyHolder(e.target.value)} placeholder="Who else holds a key" style={inp} />
          <input value={keyPhone} onChange={e => setKeyPhone(e.target.value)} placeholder="Their phone" style={inp} />
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', font: '13.5px system-ui', color: '#374151', lineHeight: 1.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={mayEnter} onChange={e => setMayEnter(e.target.checked)} style={{ marginTop: 3 }} />
          <span>Management may enter in an emergency (water, fire, gas) if I cannot be reached.</span>
        </label>
      </div>

      {/* Voluntary, one boolean, purpose stated, no field for a reason. */}
      <div style={section}>
        <div style={label}>Help evacuating <span style={{ color: '#9ca3af', fontWeight: 400 }}>· optional</span></div>
        <p style={hint}>
          Only if you want us to know. It is used to check on the unit during a hurricane, fire or evacuation — nothing else.
          We do not ask, and do not record, the reason.
        </p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', font: '13.5px system-ui', color: '#374151', lineHeight: 1.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={assist} onChange={e => setAssist(e.target.checked)} style={{ marginTop: 3 }} />
          <span>Someone here would need help to evacuate</span>
        </label>
      </div>

      {/* Shown BEFORE signing, not only on the signed PDF — a limitation the
          signer first meets in their filed copy is not one they agreed to. */}
      <div style={section}>
        <div style={{ border: '1px solid #e5e7eb', background: '#fafafa', borderRadius: 8, padding: '11px 13px', marginBottom: 14 }}>
          <div style={{ font: '700 12px system-ui', color: '#1f2a44', marginBottom: 5 }}>What the Association is and is not undertaking</div>
          <p style={{ font: '12.5px system-ui', color: '#4b5563', margin: 0, lineHeight: 1.55 }}>{LIABILITY_TEXT}</p>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', font: '13.5px system-ui', color: '#374151', lineHeight: 1.5, cursor: 'pointer', marginBottom: 14 }}>
          <input type="checkbox" checked={agreed} onChange={e => { setAgreed(e.target.checked); setErr(null) }} style={{ marginTop: 3 }} />
          <span>I have read the note above. The details are correct to the best of my knowledge, and the people listed have agreed to be contacted in an emergency at this unit.</span>
        </label>
        {err && <p style={{ font: '13px system-ui', color: '#b42318', margin: '0 0 10px' }}>{err}</p>}
        <button onClick={save} disabled={busy}
          style={{ font: '600 14px system-ui', color: '#fff', background: busy ? '#c9ccd3' : '#f26a1b', border: 'none', borderRadius: 8, padding: '11px 20px', cursor: busy ? 'default' : 'pointer' }}>
          {busy ? 'Saving…' : 'Continue to sign →'}
        </button>
      </div>
    </div>
  )
}

/** What the signer sees on the review step, before signing. */
export function EmergencySummary({ payload }: { payload: EmergencyPayloadClient | null }) {
  const contacts = (payload?.contacts ?? []).filter(c => (c.name ?? '').trim())
  if (contacts.length === 0) return null
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px', marginTop: 10 }}>
      <div style={{ font: '700 11px system-ui', letterSpacing: '.05em', textTransform: 'uppercase', color: '#6b7280', marginBottom: 6 }}>Emergency contacts</div>
      {contacts.map((c, i) => (
        <div key={i} style={{ font: '13.5px system-ui', color: '#374151', padding: '3px 0' }}>
          <strong>{c.name}</strong>
          {c.relationship ? <span style={{ color: '#6b7280' }}> · {c.relationship}</span> : null}
          {c.phone ? <span style={{ color: '#6b7280' }}> · {c.phone}</span> : null}
          {c.email ? <span style={{ color: '#6b7280' }}> · {c.email}</span> : null}
        </div>
      ))}
    </div>
  )
}
