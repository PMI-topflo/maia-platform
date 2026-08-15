'use client'

// The Animal Information & Reasonable Accommodation Questionnaire — the fill
// step for a `pet_registration` document, rendered by the generic e-sign page.
//
// ONE form, three branches. The questions narrow deliberately so that an
// applicant is never asked about a disability unnecessarily:
//
//   animal type? → pet | service animal | assistance animal | not sure
//   service      → is it a dog? → is the task readily apparent?
//                  → only if NOT: is it required by a disability, and what task?
//   assistance   → is the disability apparent? is the need for THIS animal apparent?
//                  → only if NOT: the narrow supporting information the law permits
//
// There is no field here for a diagnosis, a condition, its severity, or
// medical records, and there must never be one. The branching lives in
// lib/animal-questionnaire.ts so this form and the signed PDF cannot drift.

import { useState } from 'react'
import {
  effectiveBranch, asksServiceTaskDetail, asksDisabilityDocumentation, asksNeedDocumentation,
  asksProviderDetail, asksPerAnimalNeed, missingAnswers, certificationFor,
  requiresVaccinationRecord, requiresPhoto,
  REQUEST_TYPE_LABEL, REQUEST_TYPE_BLURB,
  type AnimalQuestionnaire, type AnimalRequestType,
} from '@/lib/animal-questionnaire'

export interface PetClient {
  type?: string; name?: string; breed?: string; color?: string; weight?: string
  age?: string; sex?: string; altered?: boolean; license?: string; rabiesDate?: string
  vaccinationDoc?: { path: string; filename: string } | null
  photo?: { path: string; filename: string } | null
  serviceAnimal?: boolean
}
export interface PetPayloadClient {
  associationLegalName?: string
  petLimit?: number
  pets?: PetClient[]
  vetName?: string
  vetPhone?: string
  questionnaire?: AnimalQuestionnaire
}

const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 14, border: '1px solid #d1d5db', borderRadius: 6 }
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }
const cell: React.CSSProperties = { flex: '1 1 45%', minWidth: 120 }
const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: 14 }
const qTitle: React.CSSProperties = { fontWeight: 700, fontSize: 14, color: '#1f2a44' }
const qHelp: React.CSSProperties = { fontSize: 12.5, color: '#6b7280', marginTop: 3, lineHeight: 1.5 }
const noteBox: React.CSSProperties = { background: '#f0fdf6', border: '1px solid #cdeedd', borderRadius: 8, padding: '9px 11px', fontSize: 12.5, color: '#166534', lineHeight: 1.5 }
const warnBox: React.CSSProperties = { background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '9px 11px', fontSize: 12.5, color: '#92400e', lineHeight: 1.5 }
const emptyPet = (): PetClient => ({ type: 'Dog', sex: 'Unknown', altered: false, serviceAnimal: false })

function Choice<T extends string>({ value, onChange, options }: {
  value: T | undefined; onChange: (v: T) => void; options: { key: T; label: string; blurb?: string }[]
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 8 }}>
      {options.map(o => {
        const on = value === o.key
        return (
          <button key={o.key} type="button" onClick={() => onChange(o.key)}
            style={{ textAlign: 'left', border: `1.5px solid ${on ? '#f26a1b' : '#e2e5ec'}`, background: on ? '#fff7f0' : '#fff', borderRadius: 9, padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: '#1f2a44' }}>{o.label}</div>
            {o.blurb && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, lineHeight: 1.45 }}>{o.blurb}</div>}
          </button>
        )
      })}
    </div>
  )
}

const YES_NO = [{ key: 'yes' as const, label: 'Yes' }, { key: 'no' as const, label: 'No' }]

export function PetRegistrationFill({ token, petLimit, onFilled }: { token: string; petLimit: number; onFilled: () => void }) {
  const [pets, setPets] = useState<PetClient[]>([emptyPet()])
  const [vetName, setVetName] = useState('')
  const [vetPhone, setVetPhone] = useState('')
  const [q, setQ] = useState<AnimalQuestionnaire>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showMissing, setShowMissing] = useState(false)

  const branch = effectiveBranch(q)
  const isAssist = branch === 'service' || branch === 'esa'
  const maxAnimals = isAssist ? Math.max(petLimit, q.esa?.animalCount ?? 1) : petLimit

  const setPet = (i: number, patch: Partial<PetClient>) => setPets(ps => ps.map((p, j) => j === i ? { ...p, ...patch } : p))
  const addPet = () => setPets(ps => ps.length < maxAnimals ? [...ps, emptyPet()] : ps)
  const removePet = (i: number) => setPets(ps => ps.filter((_, j) => j !== i))
  const setService = (patch: Partial<NonNullable<AnimalQuestionnaire['service']>>) => setQ(v => ({ ...v, service: { ...v.service, ...patch } }))
  const setEsa = (patch: Partial<NonNullable<AnimalQuestionnaire['esa']>>) => setQ(v => ({ ...v, esa: { ...v.esa, ...patch } }))

  /** Upload one file and hand back its stored reference. */
  async function upload(file: File): Promise<{ path: string; filename: string }> {
    const u = await fetch(`/api/esign/${token}/upload-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name }) })
    const uj = await u.json(); if (!u.ok) throw new Error(uj.error || 'upload failed')
    const put = await fetch(uj.signedUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } })
    if (!put.ok) throw new Error('upload failed')
    return { path: uj.path, filename: file.name }
  }

  async function uploadVax(i: number, file: File) {
    setErr(null)
    try { setPet(i, { vaccinationDoc: await upload(file) }) }
    catch (e) { setErr(`Vaccination record: ${(e as Error).message}`) }
  }

  async function uploadPhoto(i: number, file: File) {
    setErr(null)
    try { setPet(i, { photo: await upload(file) }) }
    catch (e) { setErr(`Photo: ${(e as Error).message}`) }
  }

  async function uploadSupportingDoc(file: File) {
    setErr(null)
    try {
      const f = await upload(file)
      setEsa({ documentationFiles: [...(q.esa?.documentationFiles ?? []), f] })
    } catch (e) { setErr(`Supporting documentation: ${(e as Error).message}`) }
  }

  // The completeness check reads the actual files, not just the answers: a
  // "yes, it is vaccinated" with no record attached is an unevidenced yes.
  const missing = missingAnswers(q, pets)
  const needVax = requiresVaccinationRecord(q)
  const needPhoto = requiresPhoto(q)

  async function save() {
    setErr(null)
    if (missing.length) { setShowMissing(true); return }
    setBusy(true)
    try {
      // The service/assistance branches stamp serviceAnimal on the animals so
      // downstream pet-rule and pet-fee logic can never treat them as pets.
      const outPets = pets.map(p => ({ ...p, serviceAnimal: isAssist ? true : !!p.serviceAnimal }))
      const r = await fetch(`/api/esign/${token}/fill`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pets: outPets, vetName, vetPhone, questionnaire: q, rulesAck: certificationFor(q) }),
      })
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not save')
      onFilled()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Q2 — what type of request. (Q1, "do you have an animal", is answered
          on the application itself before this form is ever created.) */}
      <div style={card}>
        <div style={qTitle}>What type of request are you making?</div>
        <div style={qHelp}>Please select the option that best describes the animal.</div>
        <Choice<AnimalRequestType>
          value={q.requestType}
          onChange={v => setQ({ requestType: v })}
          options={(['pet', 'service', 'esa', 'unsure'] as const).map(k => ({ key: k, label: REQUEST_TYPE_LABEL[k], blurb: REQUEST_TYPE_BLURB[k] }))}
        />
      </div>

      {branch === 'unsure' && (
        <div style={noteBox}>
          No further questions. Save below and management will follow up to work out which category applies. You are not
          required to disclose a diagnosis or any medical records at any point.
        </div>
      )}

      {/* ── SERVICE ANIMAL ─────────────────────────────────────────── */}
      {q.requestType === 'service' && (
        <div style={card}>
          <div style={qTitle}>Is the animal a dog?</div>
          <Choice value={q.service?.isDog} onChange={v => setService({ isDog: v })} options={YES_NO} />
          {q.service?.isDog === 'no' && (
            <div style={{ ...noteBox, marginTop: 10 }}>
              The remaining questions are the assistance-animal questions — an animal that is not a dog may still qualify
              for a reasonable accommodation under fair housing laws.
            </div>
          )}
        </div>
      )}

      {branch === 'service' && (
        <div style={card}>
          <div style={qTitle}>Is it readily apparent what work or task the dog performs?</div>
          <div style={qHelp}>
            For example, it may be readily apparent that the dog is guiding a person who is blind, or providing
            observable mobility assistance.
          </div>
          <Choice value={q.service?.taskApparent} onChange={v => setService({ taskApparent: v })} options={YES_NO} />

          {q.service?.taskApparent === 'yes' && (
            <div style={{ ...noteBox, marginTop: 10 }}>
              Nothing further about your disability will be asked.
            </div>
          )}

          {asksServiceTaskDetail(q) && (
            <div style={{ marginTop: 14, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
              <div style={qTitle}>Is the animal required because of a disability?</div>
              <Choice value={q.service?.requiredForDisability} onChange={v => setService({ requiredForDisability: v })} options={YES_NO} />

              <div style={{ ...qTitle, marginTop: 14 }}>What work or task has the animal been trained to perform?</div>
              <div style={{ ...warnBox, marginTop: 6 }}>
                Describe the work or task only. <strong>Do not provide your diagnosis or medical records</strong> — they
                are not required and will not be reviewed.
              </div>
              <textarea rows={3} style={{ ...inp, marginTop: 8, resize: 'vertical' }}
                value={q.service?.taskDescription ?? ''} onChange={e => setService({ taskDescription: e.target.value })} />
            </div>
          )}

          <div style={{ ...qTitle, marginTop: 14 }}>Is the animal currently vaccinated and licensed as required by law?</div>
          <Choice value={q.service?.vaccinatedAndLicensed} onChange={v => setService({ vaccinatedAndLicensed: v })} options={YES_NO} />
        </div>
      )}

      {/* ── ASSISTANCE ANIMAL / ESA ────────────────────────────────── */}
      {branch === 'esa' && (
        <div style={card}>
          <div style={qTitle}>Are you requesting a reasonable accommodation because of a disability?</div>
          <div style={qHelp}>You are not required to disclose your specific diagnosis or the severity of your disability.</div>
          <Choice value={q.esa?.requestingAccommodation} onChange={v => setEsa({ requestingAccommodation: v })} options={YES_NO} />

          {q.esa?.requestingAccommodation === 'yes' && (
            <>
              <div style={{ ...qTitle, marginTop: 16 }}>Is your disability readily apparent, or already known to the Association?</div>
              <Choice value={q.esa?.disabilityApparent} onChange={v => setEsa({ disabilityApparent: v })}
                options={[
                  { key: 'yes' as const, label: 'Yes' },
                  { key: 'no' as const, label: 'No' },
                  { key: 'defer' as const, label: 'Prefer that Management determine whether additional documentation is necessary' },
                ]} />

              <div style={{ ...qTitle, marginTop: 16 }}>Is the disability-related need for this particular animal readily apparent?</div>
              <Choice value={q.esa?.needApparent} onChange={v => setEsa({ needApparent: v })}
                options={[{ key: 'yes' as const, label: 'Yes' }, { key: 'no' as const, label: 'No' }, { key: 'unsure' as const, label: 'Unsure' }]} />

              {!asksDisabilityDocumentation(q) && !asksNeedDocumentation(q) && q.esa?.disabilityApparent && q.esa?.needApparent && (
                <div style={{ ...noteBox, marginTop: 12 }}>
                  Because both are readily apparent, no supporting documentation is being requested.
                </div>
              )}

              <div style={{ ...qTitle, marginTop: 16 }}>How many assistance animals are you requesting?</div>
              <input type="number" min={1} style={{ ...inp, marginTop: 8, maxWidth: 120 }}
                value={q.esa?.animalCount ?? 1} onChange={e => setEsa({ animalCount: Math.max(1, Number(e.target.value) || 1) })} />
              {asksPerAnimalNeed(q) && (
                <div style={{ ...qHelp, marginTop: 6 }}>
                  Where more than one assistance animal is requested, documentation may be requested establishing the
                  disability-related need for each animal.
                </div>
              )}

              {(asksDisabilityDocumentation(q) || asksNeedDocumentation(q)) && (
                <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
                  <div style={qTitle}>Do you have reliable supporting documentation?</div>
                  <div style={qHelp}>
                    Documentation may come from an appropriately qualified healthcare practitioner, a governmental
                    disability determination, disability benefits documentation, or another reliable source permitted by
                    law. It should establish that you have a qualifying impairment and that the animal provides
                    assistance or therapeutic emotional support related to it — <strong>without disclosing your
                    diagnosis</strong>.
                  </div>
                  <Choice value={q.esa?.documentation} onChange={v => setEsa({ documentation: v })}
                    options={[
                      { key: 'attached' as const, label: 'Yes — attached' },
                      { key: 'separate' as const, label: 'Yes — I will provide it separately' },
                      { key: 'unnecessary' as const, label: 'I believe documentation is unnecessary because my disability and need are readily apparent' },
                      { key: 'none' as const, label: 'No' },
                    ]} />

                  {q.esa?.documentation === 'attached' && (
                    <div style={{ marginTop: 10 }}>
                      <label style={lbl}>Attach the supporting documentation</label>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" style={{ fontSize: 12 }}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadSupportingDoc(f) }} />
                      {(q.esa?.documentationFiles ?? []).map((f, i) => (
                        <div key={i} style={{ fontSize: 11, color: '#166534', marginTop: 3, display: 'flex', gap: 8, alignItems: 'center' }}>
                          ✓ {f.filename}
                          <button type="button" onClick={() => setEsa({ documentationFiles: (q.esa?.documentationFiles ?? []).filter((_, j) => j !== i) })}
                            style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Remove</button>
                        </div>
                      ))}
                      <div style={{ ...qHelp, marginTop: 6 }}>
                        Send only what establishes a qualifying impairment and the animal&apos;s connection to it.
                        <strong> Do not send your diagnosis, records of treatment, or your medical file.</strong>
                      </div>
                    </div>
                  )}

                  {q.esa?.documentation === 'separate' && (
                    <div style={{ ...noteBox, marginTop: 10 }}>
                      Save this form now — you can send the documentation later and staff will attach it to this request.
                    </div>
                  )}
                </div>
              )}

              {asksProviderDetail(q) && (
                <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
                  <div style={qTitle}>Healthcare professional</div>
                  <div style={qHelp}>Identification only — never the content of your care.</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
                    <div style={cell}><label style={lbl}>Name</label><input style={inp} value={q.esa?.provider?.name ?? ''} onChange={e => setEsa({ provider: { ...q.esa?.provider, name: e.target.value } })} /></div>
                    <div style={cell}><label style={lbl}>Professional title</label><input style={inp} value={q.esa?.provider?.title ?? ''} onChange={e => setEsa({ provider: { ...q.esa?.provider, title: e.target.value } })} /></div>
                    <div style={cell}><label style={lbl}>License number (if available)</label><input style={inp} value={q.esa?.provider?.licenseNumber ?? ''} onChange={e => setEsa({ provider: { ...q.esa?.provider, licenseNumber: e.target.value } })} /></div>
                    <div style={cell}><label style={lbl}>State of licensure</label><input style={inp} value={q.esa?.provider?.licenseState ?? ''} onChange={e => setEsa({ provider: { ...q.esa?.provider, licenseState: e.target.value } })} /></div>
                    <div style={cell}><label style={lbl}>Telephone / email</label><input style={inp} value={q.esa?.provider?.contact ?? ''} onChange={e => setEsa({ provider: { ...q.esa?.provider, contact: e.target.value } })} /></div>
                  </div>

                  <div style={{ ...qTitle, marginTop: 16 }}>Was the documentation obtained only from an online ESA registration or certificate website?</div>
                  <div style={qHelp}>For example an ESA identification card, registry, certificate, vest, patch, or registration purchased online.</div>
                  <Choice value={q.esa?.onlineRegistryOnly} onChange={v => setEsa({ onlineRegistryOnly: v })}
                    options={[{ key: 'yes' as const, label: 'Yes' }, { key: 'no' as const, label: 'No' }, { key: 'na' as const, label: 'Not applicable' }]} />
                  {q.esa?.onlineRegistryOnly === 'yes' && (
                    <div style={{ ...warnBox, marginTop: 8 }}>
                      Such a registration or certificate <strong>by itself</strong> may not be sufficient documentation of
                      a disability or of a disability-related need. It is not disqualifying — you may be asked for
                      something more.
                    </div>
                  )}

                  <div style={{ ...qTitle, marginTop: 16 }}>If your healthcare professional is licensed outside Florida</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
                    <div style={cell}><label style={lbl}>State where provider is licensed</label><input style={inp} placeholder="Leave blank if Florida" value={q.esa?.outOfState?.licenseState ?? ''} onChange={e => setEsa({ outOfState: { ...q.esa?.outOfState, licenseState: e.target.value } })} /></div>
                  </div>
                  {(q.esa?.outOfState?.licenseState ?? '').trim() && (
                    <>
                      <div style={{ ...qTitle, marginTop: 14, fontSize: 13.5 }}>Has this provider personally provided you healthcare or professional services?</div>
                      <Choice value={q.esa?.outOfState?.hasTreatedYou} onChange={v => setEsa({ outOfState: { ...q.esa?.outOfState, hasTreatedYou: v } })} options={YES_NO} />
                      <div style={{ ...qTitle, marginTop: 14, fontSize: 13.5 }}>Has this provider given you in-person care on at least one occasion?</div>
                      <Choice value={q.esa?.outOfState?.inPersonAtLeastOnce} onChange={v => setEsa({ outOfState: { ...q.esa?.outOfState, inPersonAtLeastOnce: v } })}
                        options={[{ key: 'yes' as const, label: 'Yes' }, { key: 'no' as const, label: 'No' }, { key: 'na' as const, label: 'Not applicable / Florida provider' }]} />
                    </>
                  )}
                </div>
              )}

              <div style={{ ...qTitle, marginTop: 16 }}>Is the assistance animal currently vaccinated and licensed as required by law?</div>
              <Choice value={q.esa?.vaccinatedAndLicensed} onChange={v => setEsa({ vaccinatedAndLicensed: v })} options={YES_NO} />
            </>
          )}
        </div>
      )}

      {/* ── THE ANIMAL(S) — Q3 for a pet, Q12 for an assistance animal ── */}
      {branch && branch !== 'unsure' && (
        <>
          {pets.map((p, i) => (
            <div key={i} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{isAssist ? 'Animal' : 'Pet'} {i + 1}</div>
                {pets.length > 1 && <button onClick={() => removePet(i)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Remove</button>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <div style={cell}><label style={lbl}>Type / species</label><select style={inp} value={p.type} onChange={e => setPet(i, { type: e.target.value })}><option>Dog</option><option>Cat</option><option>Other</option></select></div>
                <div style={cell}><label style={lbl}>Name</label><input style={inp} value={p.name ?? ''} onChange={e => setPet(i, { name: e.target.value })} /></div>
                <div style={cell}><label style={lbl}>Breed, if known</label><input style={inp} value={p.breed ?? ''} onChange={e => setPet(i, { breed: e.target.value })} /></div>
                <div style={cell}><label style={lbl}>Color / description</label><input style={inp} value={p.color ?? ''} onChange={e => setPet(i, { color: e.target.value })} /></div>
                <div style={cell}><label style={lbl}>Approximate weight (lb)</label><input style={inp} value={p.weight ?? ''} onChange={e => setPet(i, { weight: e.target.value })} inputMode="decimal" /></div>
                <div style={cell}><label style={lbl}>Age</label><input style={inp} value={p.age ?? ''} onChange={e => setPet(i, { age: e.target.value })} /></div>
                <div style={cell}><label style={lbl}>Sex</label><select style={inp} value={p.sex} onChange={e => setPet(i, { sex: e.target.value })}><option>Unknown</option><option>Male</option><option>Female</option></select></div>
                <div style={cell}><label style={lbl}>License / tag #</label><input style={inp} value={p.license ?? ''} onChange={e => setPet(i, { license: e.target.value })} /></div>
                <div style={cell}><label style={lbl}>Rabies vaccination date</label><input type="date" style={inp} value={p.rabiesDate ?? ''} onChange={e => setPet(i, { rabiesDate: e.target.value })} /></div>
                <div style={cell}>
                  <label style={lbl}>Vaccination / licensing record{needVax ? ' *' : ''}</label>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" style={{ fontSize: 12 }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadVax(i, f) }} />
                  {p.vaccinationDoc
                    ? <div style={{ fontSize: 11, color: '#166534', marginTop: 3 }}>✓ {p.vaccinationDoc.filename}</div>
                    : needVax
                      ? <div style={{ fontSize: 11, color: '#b45309', marginTop: 3 }}>Required — you answered that the animal is vaccinated and licensed.</div>
                      : <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>Attach it if you have it.</div>}
                </div>
                <div style={cell}>
                  <label style={lbl}>Photo of the animal{needPhoto ? ' *' : ' (optional)'}</label>
                  <input type="file" accept=".jpg,.jpeg,.png,.heic,.webp" style={{ fontSize: 12 }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(i, f) }} />
                  {p.photo
                    ? <div style={{ fontSize: 11, color: '#166534', marginTop: 3 }}>✓ {p.photo.filename}</div>
                    : <div style={{ fontSize: 11, color: needPhoto ? '#b45309' : '#9ca3af', marginTop: 3 }}>Helps staff and security recognise the animal on the property.</div>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: 13, color: '#374151' }}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={!!p.altered} onChange={e => setPet(i, { altered: e.target.checked })} /> Spayed / neutered</label>
              </div>
            </div>
          ))}

          {pets.length < maxAnimals && (
            <button onClick={addPet} style={{ alignSelf: 'flex-start', background: '#fff', border: '1px dashed #d1d5db', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151' }}>
              + Add another {isAssist ? 'animal' : 'pet'} ({pets.length}/{maxAnimals})
            </button>
          )}

          {branch === 'pet' && (
            <div style={card}>
              <div style={qTitle}>Is the animal currently vaccinated as required by law?</div>
              <Choice value={q.petVaccinated} onChange={v => setQ(s => ({ ...s, petVaccinated: v }))} options={YES_NO} />
              <div style={{ ...qHelp, marginTop: 8 }}>
                The Association’s normal pet rules, restrictions, application procedures and applicable fees will apply.
              </div>
            </div>
          )}

          <div style={card}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Veterinarian</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <div style={cell}><label style={lbl}>Name</label><input style={inp} value={vetName} onChange={e => setVetName(e.target.value)} /></div>
              <div style={cell}><label style={lbl}>Phone</label><input style={inp} value={vetPhone} onChange={e => setVetPhone(e.target.value)} inputMode="tel" /></div>
            </div>
          </div>
        </>
      )}

      {branch && (
        <div style={{ ...noteBox, background: '#f8fbff', border: '1px solid #dbeafe', color: '#1e3a5f' }}>
          <strong>Certification.</strong> {certificationFor(q)}
        </div>
      )}

      {showMissing && missing.length > 0 && (
        <div style={warnBox}>
          <strong>Still needed:</strong>
          <ul style={{ margin: '5px 0 0', paddingLeft: 18 }}>{missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      {err && <p style={{ color: '#b91c1c', fontSize: 14, margin: 0 }}>⚠ {err}</p>}
      <button onClick={save} disabled={busy || !branch} style={{ padding: '12px', fontSize: 15, fontWeight: 700, color: '#fff', background: (busy || !branch) ? '#9ca3af' : '#f26a1b', border: 'none', borderRadius: 8, cursor: (busy || !branch) ? 'default' : 'pointer' }}>
        {busy ? 'Saving…' : 'Save & continue to sign →'}
      </button>
    </div>
  )
}

/** Read-only summary shown on the review/sign step. */
export function PetSummary({ payload }: { payload: PetPayloadClient }) {
  const pets = payload.pets ?? []
  const q = payload.questionnaire
  const branch = effectiveBranch(q)
  if (pets.length === 0 && !branch) return null
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '4px 14px', marginTop: 8 }}>
      {branch && (
        <div style={{ padding: '8px 0', borderBottom: pets.length ? '1px solid #f0f0f0' : undefined, fontSize: 13.5 }}>
          <strong>{REQUEST_TYPE_LABEL[q?.requestType ?? 'pet']}</strong>
          {branch !== 'pet' && branch !== 'unsure' && (
            <div style={{ fontSize: 12, color: '#166534', marginTop: 3, lineHeight: 1.45 }}>
              Not an ordinary pet — no pet fee, deposit, or breed/size restriction applies. No diagnosis or medical
              records were requested.
            </div>
          )}
        </div>
      )}
      {pets.map((p, i) => (
        <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14 }}>
          <strong>{p.name || `Animal ${i + 1}`}</strong> <span style={{ color: '#6b7280' }}>· {[p.type, p.breed, p.sex, p.weight ? `${p.weight} lb` : null].filter(Boolean).join(' · ')}</span>
          {p.vaccinationDoc && <span style={{ color: '#166534', fontSize: 12 }}> · ✓ vax record</span>}
          {p.photo && <span style={{ color: '#166534', fontSize: 12 }}> · ✓ photo</span>}
        </div>
      ))}
      {(payload.vetName || payload.vetPhone) && <div style={{ padding: '8px 0', fontSize: 13, color: '#6b7280' }}>Vet: {payload.vetName || '—'}{payload.vetPhone ? ` · ${payload.vetPhone}` : ''}</div>}
    </div>
  )
}
