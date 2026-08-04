'use client'

// The applicant's Pet Registration fill step, rendered by the generic e-sign
// page when a pet_registration document still needs its data. One card per pet
// (up to the association's limit), each with a vaccination-record upload; plus
// veterinarian contact. On save it writes the payload and the page continues
// to review + verified e-sign.

import { useState } from 'react'

export interface PetClient {
  type?: string; name?: string; breed?: string; color?: string; weight?: string
  age?: string; sex?: string; altered?: boolean; license?: string; rabiesDate?: string
  vaccinationDoc?: { path: string; filename: string } | null
  serviceAnimal?: boolean
}
export interface PetPayloadClient {
  associationLegalName?: string
  petLimit?: number
  pets?: PetClient[]
  vetName?: string
  vetPhone?: string
}

const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 14, border: '1px solid #d1d5db', borderRadius: 6 }
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }
const cell: React.CSSProperties = { flex: '1 1 45%', minWidth: 120 }
const emptyPet = (): PetClient => ({ type: 'Dog', sex: 'Unknown', altered: false, serviceAnimal: false })

export function PetRegistrationFill({ token, petLimit, onFilled }: { token: string; petLimit: number; onFilled: () => void }) {
  const [pets, setPets] = useState<PetClient[]>([emptyPet()])
  const [vetName, setVetName] = useState('')
  const [vetPhone, setVetPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState<string | null>(null)

  const setPet = (i: number, patch: Partial<PetClient>) => setPets(ps => ps.map((p, j) => j === i ? { ...p, ...patch } : p))
  const addPet = () => setPets(ps => ps.length < petLimit ? [...ps, emptyPet()] : ps)
  const removePet = (i: number) => setPets(ps => ps.filter((_, j) => j !== i))

  async function uploadVax(i: number, file: File) {
    setErr(null)
    try {
      const u = await fetch(`/api/esign/${token}/upload-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name }) })
      const uj = await u.json(); if (!u.ok) throw new Error(uj.error || 'upload failed')
      const put = await fetch(uj.signedUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } })
      if (!put.ok) throw new Error('upload failed')
      setPet(i, { vaccinationDoc: { path: uj.path, filename: file.name } })
    } catch (e) { setErr(`Vaccination upload: ${(e as Error).message}`) }
  }

  async function save() {
    setErr(null)
    if (!pets.some(p => (p.name ?? '').trim())) { setErr('Please enter at least one pet’s name.'); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/esign/${token}/fill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pets, vetName, vetPhone }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not save')
      onFilled()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {pets.map((p, i) => (
        <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Pet {i + 1}</div>
            {pets.length > 1 && <button onClick={() => removePet(i)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Remove</button>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <div style={cell}><label style={lbl}>Type</label><select style={inp} value={p.type} onChange={e => setPet(i, { type: e.target.value })}><option>Dog</option><option>Cat</option><option>Other</option></select></div>
            <div style={cell}><label style={lbl}>Name</label><input style={inp} value={p.name ?? ''} onChange={e => setPet(i, { name: e.target.value })} /></div>
            <div style={cell}><label style={lbl}>Breed</label><input style={inp} value={p.breed ?? ''} onChange={e => setPet(i, { breed: e.target.value })} /></div>
            <div style={cell}><label style={lbl}>Color</label><input style={inp} value={p.color ?? ''} onChange={e => setPet(i, { color: e.target.value })} /></div>
            <div style={cell}><label style={lbl}>Weight (lb)</label><input style={inp} value={p.weight ?? ''} onChange={e => setPet(i, { weight: e.target.value })} inputMode="decimal" /></div>
            <div style={cell}><label style={lbl}>Age</label><input style={inp} value={p.age ?? ''} onChange={e => setPet(i, { age: e.target.value })} /></div>
            <div style={cell}><label style={lbl}>Sex</label><select style={inp} value={p.sex} onChange={e => setPet(i, { sex: e.target.value })}><option>Unknown</option><option>Male</option><option>Female</option></select></div>
            <div style={cell}><label style={lbl}>License / Tag #</label><input style={inp} value={p.license ?? ''} onChange={e => setPet(i, { license: e.target.value })} /></div>
            <div style={cell}><label style={lbl}>Rabies vaccination date</label><input type="date" style={inp} value={p.rabiesDate ?? ''} onChange={e => setPet(i, { rabiesDate: e.target.value })} /></div>
            <div style={cell}>
              <label style={lbl}>Vaccination record</label>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" style={{ fontSize: 12 }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadVax(i, f) }} />
              {p.vaccinationDoc && <div style={{ fontSize: 11, color: '#166534', marginTop: 3 }}>✓ {p.vaccinationDoc.filename}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: 13, color: '#374151' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={!!p.altered} onChange={e => setPet(i, { altered: e.target.checked })} /> Spayed / neutered</label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={!!p.serviceAnimal} onChange={e => setPet(i, { serviceAnimal: e.target.checked })} /> Service animal / ESA</label>
          </div>
        </div>
      ))}

      {pets.length < petLimit && <button onClick={addPet} style={{ alignSelf: 'flex-start', background: '#fff', border: '1px dashed #d1d5db', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151' }}>+ Add another pet ({pets.length}/{petLimit})</button>}

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Veterinarian</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <div style={cell}><label style={lbl}>Name</label><input style={inp} value={vetName} onChange={e => setVetName(e.target.value)} /></div>
          <div style={cell}><label style={lbl}>Phone</label><input style={inp} value={vetPhone} onChange={e => setVetPhone(e.target.value)} inputMode="tel" /></div>
        </div>
      </div>

      {err && <p style={{ color: '#b91c1c', fontSize: 14, margin: 0 }}>⚠ {err}</p>}
      <button onClick={save} disabled={busy} style={{ padding: '12px', fontSize: 15, fontWeight: 700, color: '#fff', background: busy ? '#9ca3af' : '#f26a1b', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}>
        {busy ? 'Saving…' : 'Save & continue to sign →'}
      </button>
    </div>
  )
}

/** Read-only pet summary shown on the review/sign step. */
export function PetSummary({ payload }: { payload: PetPayloadClient }) {
  const pets = payload.pets ?? []
  if (pets.length === 0) return null
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '4px 14px', marginTop: 8 }}>
      {pets.map((p, i) => (
        <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14 }}>
          <strong>{p.name || `Pet ${i + 1}`}</strong> <span style={{ color: '#6b7280' }}>· {[p.type, p.breed, p.sex, p.weight ? `${p.weight} lb` : null].filter(Boolean).join(' · ')}</span>
          {p.vaccinationDoc && <span style={{ color: '#166534', fontSize: 12 }}> · ✓ vax record</span>}
        </div>
      ))}
      {(payload.vetName || payload.vetPhone) && <div style={{ padding: '8px 0', fontSize: 13, color: '#6b7280' }}>Vet: {payload.vetName || '—'}{payload.vetPhone ? ` · ${payload.vetPhone}` : ''}</div>}
    </div>
  )
}
