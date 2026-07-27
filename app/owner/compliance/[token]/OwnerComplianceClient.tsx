'use client'

import { useEffect, useState } from 'react'

interface MissingItem { key: string; label: string; declaredType: string | null }
interface Occupant { name: string; phone: string; email: string }
interface Status {
  ownerName: string | null; unit: string | null; associationName: string | null
  emails: string[]; phones: string[]; appraiser: { name: string; url: string }
  contactConfirmedAt: string | null; emergencyContact: Occupant | null
  tenant: Occupant | null; occupants: Occupant[]
  unitManager: Occupant | null
  occupancy: string | null; kind: string; commercialUseType: string | null; missing: MissingItem[]
}
type Occ = 'owner_occupied' | 'leased' | 'vacant'
const OCC: { key: Occ; label: string; hint: string }[] = [
  { key: 'owner_occupied', label: 'Owner-occupied', hint: 'You live here' },
  { key: 'leased', label: 'Leased', hint: 'A tenant rents it' },
  { key: 'vacant', label: 'Vacant', hint: 'No one lives here' },
]
const INSURANCE_TYPE_OPTIONS: Record<string, string[]> = {
  'unit.ho6': ['HO-6 (Condo/Co-op Unit Owners Policy)', 'HO-3 (Homeowners Policy)', 'Landlord/Rental Dwelling Policy', 'Umbrella/Other', 'None currently'],
  'unit.ho3': ['HO-3 (Homeowners Policy)', 'Landlord/Rental Dwelling Policy', 'Umbrella/Other', 'None currently'],
  'unit.commercial_property': ['Commercial Package Policy (CPP)', 'Business Owners Policy (BOP)', 'Separate Property + Liability', 'Umbrella/Other', 'None currently'],
  'unit.vacant_policy': ['Vacant Property Policy', 'None currently'],
}
// Items handled by their own field sections above — not the upload list.
const FIELD_ITEMS = new Set(['unit.contact', 'unit.emergency'])

const inp: React.CSSProperties = { width: '100%', padding: '9px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, marginBottom: 8, boxSizing: 'border-box' }
const primaryBtn = (saved: boolean): React.CSSProperties => ({ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: saved ? '#059669' : '#f26a1b', color: '#fff', fontSize: 13, fontWeight: 600 })
const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', marginBottom: 8 }

export default function OwnerComplianceClient({ token }: { token: string }) {
  const [s, setS] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Occupancy
  const [savingOccupancy, setSavingOccupancy] = useState<Occ | null>(null)
  // Contact confirm / change
  const [confirming, setConfirming] = useState(false)
  const [showChange, setShowChange] = useState(false); const [changeText, setChangeText] = useState(''); const [changeSaved, setChangeSaved] = useState(false)
  // Emergency contact
  const [em, setEm] = useState<Occupant>({ name: '', phone: '', email: '' }); const [savingEm, setSavingEm] = useState(false); const [emSaved, setEmSaved] = useState(false)
  // Occupants (leased)
  const [occs, setOccs] = useState<Occupant[]>([{ name: '', phone: '', email: '' }]); const [savingOccs, setSavingOccs] = useState(false); const [occsSaved, setOccsSaved] = useState(false)
  // Commercial use type
  const [useType, setUseType] = useState(''); const [savingUseType, setSavingUseType] = useState(false); const [useTypeSaved, setUseTypeSaved] = useState(false)
  const [savingDeclared, setSavingDeclared] = useState<string | null>(null)
  // Upload
  const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/owner/compliance/${token}`).then(r => r.json())
      .then((d: Status) => {
        if (!alive) return
        setS(d); setUseType(d.commercialUseType ?? '')
        if (d.emergencyContact) setEm({ name: d.emergencyContact.name ?? '', phone: d.emergencyContact.phone ?? '', email: d.emergencyContact.email ?? '' })
        const existing = d.occupants?.length ? d.occupants : (d.tenant ? [d.tenant] : [])
        if (existing.length) setOccs(existing.map(o => ({ name: o.name ?? '', phone: o.phone ?? '', email: o.email ?? '' })))
      })
      .catch(() => { if (alive) setError('Could not load your unit.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  const patch = (extra: Partial<Status>) => setS(prev => prev ? { ...prev, ...extra } : prev)

  async function post(body: Record<string, unknown>, path = '') {
    const res = await fetch(`/api/owner/compliance/${token}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const j = await res.json(); if (!res.ok) throw new Error(j?.error ?? 'failed'); return j
  }

  async function setOccupancy(status: Occ) {
    setSavingOccupancy(status); setError(null)
    try { const j = await post({ status }); patch({ occupancy: status, missing: j.missing }) }
    catch (e) { setError((e as Error).message) } finally { setSavingOccupancy(null) }
  }
  async function confirmContact() {
    setConfirming(true); setError(null)
    try { const j = await post({ confirmContact: true }); patch({ contactConfirmedAt: new Date().toISOString(), missing: j.missing }) }
    catch (e) { setError((e as Error).message) } finally { setConfirming(false) }
  }
  async function requestChange() {
    if (!changeText.trim()) { setError('Describe the change.'); return }
    setError(null)
    try { await post({ contactChangeRequest: changeText }); setChangeSaved(true) }
    catch (e) { setError((e as Error).message) }
  }
  async function saveEmergency() {
    if (!em.name.trim()) { setError("Enter the emergency contact's name."); return }
    setSavingEm(true); setError(null)
    try { const j = await post({ emergencyContact: em }); patch({ missing: j.missing }); setEmSaved(true) }
    catch (e) { setError((e as Error).message) } finally { setSavingEm(false) }
  }
  async function saveOccupants() {
    setSavingOccs(true); setError(null)
    try { const j = await post({ occupants: occs }, '/tenant'); patch({ missing: j.missing }); setOccsSaved(true) }
    catch (e) { setError((e as Error).message) } finally { setSavingOccs(false) }
  }
  async function saveUseType() {
    setSavingUseType(true); setError(null)
    try { const j = await post({ commercialUseType: useType }); patch({ commercialUseType: useType, missing: j.missing }); setUseTypeSaved(true) }
    catch (e) { setError((e as Error).message) } finally { setSavingUseType(false) }
  }
  async function reallyDeclareType(itemKey: string, declaredType: string) {
    setSavingDeclared(itemKey); setError(null)
    try {
      const res = await fetch(`/api/owner/compliance/${token}/declare-type`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemKey, declaredType }) })
      const j = await res.json(); if (!res.ok) throw new Error(j?.error ?? 'failed'); patch({ missing: j.missing })
    } catch (e) { setError((e as Error).message) } finally { setSavingDeclared(null) }
  }
  async function upload() {
    if (files.length === 0) { setError('Choose at least one file.'); return }
    setBusy(true); setError(null); setDone(null)
    try {
      const fd = new FormData(); files.forEach(f => fd.append('files', f))
      const res = await fetch(`/api/owner/compliance/${token}/upload`, { method: 'POST', body: fd })
      const j = await res.json(); if (!res.ok) throw new Error(j?.error ?? 'upload failed')
      setDone(`Thank you — ${j.saved} file(s) received. PMI will review and file them.`); setFiles([])
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  if (loading) return <p style={{ fontSize: 13, color: '#6b7280' }}>Loading…</p>
  if (!s) return <p style={{ fontSize: 14, color: '#991b1b' }}>{error ?? 'Could not load your unit.'}</p>

  const uploadMissing = s.missing.filter(m => !FIELD_ITEMS.has(m.key))
  const confirmed = !!s.contactConfirmedAt

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 2px' }}>Your unit documents</h1>
      <div style={{ fontSize: 13, color: '#4b5563' }}>{s.ownerName ? `${s.ownerName} · ` : ''}{s.associationName}{s.unit ? ` · Unit ${s.unit}` : ''}</div>
      <p style={{ fontSize: 13, color: '#4b5563', margin: '14px 0 18px', lineHeight: 1.5 }}>
        Help us keep your file current. Confirm your details, tell us how the unit is used, and upload anything we’re still missing.
      </p>

      {/* Your info on file — confirm or request a change (Contact Information) */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, marginBottom: 16 }}>
        <div style={sectionLabel}>Your contact information on file</div>
        <div style={{ fontSize: 14, color: '#111827', fontWeight: 600 }}>{s.ownerName ?? '—'}</div>
        {s.emails.map(e => <div key={e} style={{ fontSize: 13, color: '#374151' }}>✉ {e}</div>)}
        {s.phones.map(p => <div key={p} style={{ fontSize: 13, color: '#374151' }}>📞 {p}</div>)}
        {s.emails.length === 0 && s.phones.length === 0 && <div style={{ fontSize: 13, color: '#9a3412' }}>No email or phone on file — please request they be added.</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button onClick={confirmContact} disabled={confirming || confirmed} style={primaryBtn(confirmed)}>
            {confirmed ? '✓ Confirmed' : confirming ? 'Saving…' : 'Confirm these are correct'}
          </button>
          <button onClick={() => setShowChange(v => !v)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Request a change
          </button>
        </div>
        {showChange && (
          <div style={{ marginTop: 10 }}>
            <textarea value={changeText} onChange={e => { setChangeText(e.target.value); setChangeSaved(false) }} placeholder="What should we update? (new email, phone, mailing address…)" rows={3} style={{ ...inp, resize: 'vertical' }} />
            <button onClick={requestChange} disabled={changeSaved} style={primaryBtn(changeSaved)}>{changeSaved ? '✓ Sent to PMI' : 'Send change request'}</button>
          </div>
        )}
      </div>

      {/* Emergency contact — fields, not a file */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, marginBottom: 16 }}>
        <div style={sectionLabel}>Emergency contact</div>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 10px' }}>Someone we can reach in an emergency at your unit (not a document — just their details).</p>
        {s.unitManager && (
          <button onClick={() => { setEm({ name: s.unitManager!.name, phone: s.unitManager!.phone ?? '', email: s.unitManager!.email ?? '' }); setEmSaved(false) }}
            style={{ display: 'inline-block', marginBottom: 10, padding: '6px 12px', borderRadius: 8, border: '1px dashed #9ca3af', background: '#fff', color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Use my unit manager ({s.unitManager.name})
          </button>
        )}
        <input value={em.name} onChange={e => { setEm({ ...em, name: e.target.value }); setEmSaved(false) }} placeholder="Emergency contact name" style={inp} />
        <input value={em.phone} onChange={e => { setEm({ ...em, phone: e.target.value }); setEmSaved(false) }} placeholder="Phone" inputMode="tel" style={inp} />
        <input value={em.email} onChange={e => { setEm({ ...em, email: e.target.value }); setEmSaved(false) }} placeholder="Email (optional)" inputMode="email" style={inp} />
        <button onClick={saveEmergency} disabled={savingEm} style={primaryBtn(emSaved)}>{savingEm ? 'Saving…' : emSaved ? '✓ Saved' : 'Save emergency contact'}</button>
      </div>

      {/* Occupancy */}
      <div style={sectionLabel}>How is this unit used?</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {OCC.map(o => {
          const active = s.occupancy === o.key
          return (
            <button key={o.key} onClick={() => setOccupancy(o.key)} disabled={!!savingOccupancy} style={{ flex: '1 1 150px', textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer', border: active ? '2px solid #f26a1b' : '1px solid #d1d5db', background: active ? '#fff7ed' : '#fff' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: active ? '#c2410c' : '#111827' }}>{savingOccupancy === o.key ? 'Saving…' : o.label}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{o.hint}</div>
            </button>
          )
        })}
      </div>

      {/* Commercial use type */}
      {s.kind === 'commercial' && (
        <div style={{ border: '1px solid #dbeafe', background: '#eff6ff', borderRadius: 8, padding: 14, marginBottom: 20 }}>
          <div style={{ ...sectionLabel, color: '#1e40af' }}>What is this unit used for?</div>
          <input value={useType} onChange={e => { setUseType(e.target.value); setUseTypeSaved(false) }} placeholder="e.g. Retail, Restaurant, Professional office, Warehouse" style={inp} />
          <button onClick={saveUseType} disabled={savingUseType || !useType.trim()} style={primaryBtn(useTypeSaved)}>{savingUseType ? 'Saving…' : useTypeSaved ? '✓ Saved' : 'Save'}</button>
        </div>
      )}

      {/* Occupants — only when leased; supports multiple */}
      {s.occupancy === 'leased' && (
        <div style={{ border: '1px solid #fed7aa', background: '#fff7ed', borderRadius: 8, padding: 14, marginBottom: 20 }}>
          <div style={{ ...sectionLabel, color: '#9a3412' }}>Tenant &amp; occupants</div>
          <p style={{ fontSize: 12, color: '#9a3412', margin: '0 0 10px' }}>So we can reach the people living here for their renters insurance (HO-4) and registrations. Add everyone on the lease.</p>
          {occs.map((o, i) => (
            <div key={i} style={{ borderTop: i ? '1px dashed #fdba74' : 'none', paddingTop: i ? 10 : 0, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#9a3412', marginBottom: 6 }}>{i === 0 ? 'Primary tenant' : `Occupant ${i + 1}`}</div>
                {i > 0 && <button onClick={() => { setOccs(occs.filter((_, j) => j !== i)); setOccsSaved(false) }} style={{ background: 'none', border: 'none', color: '#9a3412', cursor: 'pointer', fontSize: 12 }}>Remove</button>}
              </div>
              <input value={o.name} onChange={e => { const n = [...occs]; n[i] = { ...o, name: e.target.value }; setOccs(n); setOccsSaved(false) }} placeholder="Full name" style={inp} />
              <input value={o.phone} onChange={e => { const n = [...occs]; n[i] = { ...o, phone: e.target.value }; setOccs(n); setOccsSaved(false) }} placeholder="Phone" inputMode="tel" style={inp} />
              <input value={o.email} onChange={e => { const n = [...occs]; n[i] = { ...o, email: e.target.value }; setOccs(n); setOccsSaved(false) }} placeholder="Email" inputMode="email" style={inp} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <button onClick={() => { setOccs([...occs, { name: '', phone: '', email: '' }]); setOccsSaved(false) }} style={{ padding: '8px 14px', borderRadius: 8, border: '1px dashed #fb923c', background: '#fff', color: '#c2410c', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ Add another occupant</button>
            <button onClick={saveOccupants} disabled={savingOccs} style={primaryBtn(occsSaved)}>{savingOccs ? 'Saving…' : occsSaved ? '✓ Saved — PMI will reach out' : 'Save tenant & occupants'}</button>
          </div>
        </div>
      )}

      {/* Missing docs (contact + emergency handled above) */}
      <div style={sectionLabel}>Documents we still need {s.occupancy ? '' : '(answer above to tailor this list)'}</div>
      {uploadMissing.length === 0 ? (
        <div style={{ padding: 14, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, fontSize: 14, color: '#065f46', marginBottom: 18 }}>✓ Nothing else to upload — thank you!</div>
      ) : (
        <ul style={{ margin: '0 0 18px', padding: 0, listStyle: 'none' }}>
          {uploadMissing.map(m => {
            const options = INSURANCE_TYPE_OPTIONS[m.key]
            return (
              <li key={m.key} style={{ fontSize: 14, color: '#374151', padding: '7px 0', borderTop: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: '#dc2626' }}>•</span>{m.label}
                  {options && (
                    <select value={m.declaredType ?? ''} disabled={savingDeclared === m.key} onChange={e => reallyDeclareType(m.key, e.target.value)} style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 6 }}>
                      <option value="" disabled>What type do you carry?</option>
                      {options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  )}
                </div>
                {m.key === 'unit.ownership' && (
                  <div style={{ fontSize: 12, color: '#6b7280', margin: '3px 0 0 16px' }}>
                    Upload your recorded <strong>Deed</strong>, or your property record from the{' '}
                    <a href={s.appraiser.url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>{s.appraiser.name}</a>.
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Upload */}
      <div style={sectionLabel}>Upload your documents</div>
      {done ? (
        <div style={{ padding: 14, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, fontSize: 14, color: '#065f46' }}>✓ {done}
          <div style={{ marginTop: 10 }}><button onClick={() => setDone(null)} style={{ background: 'none', border: 'none', color: '#065f46', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0 }}>Upload more</button></div>
        </div>
      ) : (
        <>
          <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,application/pdf,image/*" onChange={e => setFiles(Array.from(e.target.files ?? []))} style={{ display: 'block', width: '100%', fontSize: 13, marginBottom: 12 }} />
          {files.length > 0 && <ul style={{ margin: '0 0 12px', padding: 0, listStyle: 'none', fontSize: 12, color: '#4b5563' }}>{files.map((f, i) => <li key={i}>• {f.name} ({(f.size / 1024 / 1024).toFixed(1)} MB)</li>)}</ul>}
          {error && <div style={{ fontSize: 13, color: '#991b1b', marginBottom: 10 }}>⚠ {error}</div>}
          <button onClick={upload} disabled={busy} style={{ width: '100%', padding: 11, borderRadius: 8, border: 'none', cursor: busy ? 'default' : 'pointer', background: busy ? '#9ca3af' : '#f26a1b', color: '#fff', fontSize: 14, fontWeight: 700 }}>{busy ? 'Uploading…' : 'Upload'}</button>
          <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 10 }}>PDF, JPG, PNG accepted. PMI reviews each before filing.</p>
        </>
      )}
      {error && !busy && <div style={{ fontSize: 13, color: '#991b1b', marginTop: 10 }}>⚠ {error}</div>}
    </div>
  )
}
