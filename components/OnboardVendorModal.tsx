'use client'

// =====================================================================
// OnboardVendorModal.tsx
// Staff (Paola) onboards a brand-new vendor. Before creating it in CINC,
// MAIA searches existing vendors across name / DBA / email / phone /
// address and surfaces likely duplicates so we don't create a dup. Paola
// can "Use" an existing match (gap-fill) or confirm "Create new". On
// create, the vendor is made in CINC immediately and a secure onboarding
// link is returned (and emailed to the vendor, cc Paola).
// =====================================================================

import { useEffect, useState } from 'react'

interface Match { vendorId: number; name: string; dba: string | null; email: string | null; phone: string | null; address: string | null; score: number; reasons: string[] }
interface VType { id: string; name: string }

export default function OnboardVendorModal({ onClose, prefill }: {
  onClose: () => void
  prefill?: { name?: string | null; email?: string | null }
}) {
  const [name, setName]   = useState(prefill?.name ?? '')
  const [dba, setDba]     = useState('')
  const [email, setEmail] = useState(prefill?.email ?? '')
  const [phone, setPhone] = useState('')
  const [address1, setAddress1] = useState('')
  const [city, setCity]   = useState('')
  const [state, setState] = useState('')
  const [zip, setZip]     = useState('')
  const [vendorTypeId, setVendorTypeId] = useState('')
  const [licenseRequired, setLicenseRequired] = useState(false)
  const [types, setTypes] = useState<VType[]>([])

  const [matches, setMatches] = useState<Match[] | null>(null)  // null = not checked yet
  const [busy, setBusy] = useState<null | 'check' | 'create'>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ link: string; emailed: boolean; linked: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/admin/cinc/vendor-types').then(r => r.json()).then(d => setTypes(d.cincTypes ?? [])).catch(() => null)
  }, [])

  async function check() {
    if (!name.trim()) { setErr('Company name is required.'); return }
    setBusy('check'); setErr(null)
    try {
      const r = await fetch('/api/admin/vendors/onboard', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'check', name, dba, email, phone, address1, city, zip }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? 'check failed')
      setMatches(d.matches ?? [])
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  async function submit(action: 'create' | 'link', cincVendorId?: number) {
    setBusy('create'); setErr(null)
    try {
      const r = await fetch('/api/admin/vendors/onboard', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, cincVendorId, name, dba, email, phone, address1, city, state, zip, vendorTypeId, vendorTypeName: types.find(t => t.id === vendorTypeId)?.name, licenseRequired }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? `${action} failed`)
      setDone({ link: d.link, emailed: !!d.emailed, linked: action === 'link' })
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/50 p-6">
      <div onClick={e => e.stopPropagation()} className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-5 py-3">
          <div className="text-sm font-semibold text-gray-900">Onboard new vendor</div>
          <button onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-700" aria-label="Close">×</button>
        </div>

        <div className="max-h-[75vh] overflow-auto px-5 py-4">
          {done ? (
            <div>
              <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                {done.linked ? 'Using the existing CINC vendor.' : 'Vendor created in CINC ✓'} {done.emailed ? 'The onboarding link was emailed to the vendor (cc Paola).' : 'Share the onboarding link below with the vendor.'}
              </div>
              <label className="text-xs font-medium text-gray-500">Onboarding link</label>
              <div className="mt-1 flex gap-2">
                <input readOnly value={done.link} className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-700" />
                <button onClick={() => { navigator.clipboard?.writeText(done.link); setCopied(true) }} className="rounded bg-[#f26a1b] px-3 py-1.5 text-xs font-semibold text-white">{copied ? 'Copied' : 'Copy'}</button>
              </div>
              <div className="mt-4 text-right"><button onClick={onClose} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Done</button></div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Company name *" v={name} set={setName} span />
                <Field label="DBA (optional)" v={dba} set={setDba} span />
                <Field label="Email" v={email} set={setEmail} />
                <Field label="Phone" v={phone} set={setPhone} />
                <Field label="Address" v={address1} set={setAddress1} span />
                <Field label="City" v={city} set={setCity} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="State" v={state} set={setState} />
                  <Field label="ZIP" v={zip} set={setZip} />
                </div>
                <label className="col-span-2 mt-1 block text-xs font-medium text-gray-500">Trade / type
                  <select value={vendorTypeId} onChange={e => setVendorTypeId(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                    <option value="">— select —</option>
                    {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                <label className="col-span-2 mt-1 flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={licenseRequired} onChange={e => setLicenseRequired(e.target.checked)} />
                  This trade requires a license (collect one)
                </label>
              </div>

              {err && <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

              {matches === null ? (
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={onClose} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
                  <button onClick={check} disabled={busy === 'check'} className="rounded bg-[#f26a1b] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#d85a10] disabled:opacity-50">{busy === 'check' ? 'Checking CINC…' : 'Check for duplicates →'}</button>
                </div>
              ) : (
                <div className="mt-4">
                  {matches.length > 0 ? (
                    <>
                      <div className="mb-2 text-sm font-medium text-amber-800">⚠ Possible existing vendor{matches.length > 1 ? 's' : ''} in CINC — is it one of these?</div>
                      <div className="space-y-2">
                        {matches.map(m => (
                          <div key={m.vendorId} className="flex items-center justify-between rounded-lg border border-gray-200 p-2.5">
                            <div className="min-w-0 text-xs">
                              <div className="font-medium text-gray-900">{m.name}{m.dba ? ` (dba ${m.dba})` : ''}</div>
                              <div className="text-gray-500">{[m.email, m.phone, m.address].filter(Boolean).join(' · ') || '—'}</div>
                              <div className="mt-0.5 text-[10px] uppercase text-amber-700">matched: {m.reasons.join(', ')}</div>
                            </div>
                            <button onClick={() => submit('link', m.vendorId)} disabled={!!busy} className="ml-2 shrink-0 rounded border border-[#16a34a] px-2.5 py-1 text-xs font-medium text-[#16a34a] hover:bg-emerald-50 disabled:opacity-50">Use this</button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex justify-end gap-2">
                        <button onClick={() => setMatches(null)} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">← Edit</button>
                        <button onClick={() => submit('create')} disabled={!!busy} className="rounded bg-[#f26a1b] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#d85a10] disabled:opacity-50">{busy === 'create' ? 'Creating…' : 'None of these — create new'}</button>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-emerald-700">✓ No duplicates found in CINC.</span>
                      <div className="flex gap-2">
                        <button onClick={() => setMatches(null)} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">← Edit</button>
                        <button onClick={() => submit('create')} disabled={!!busy} className="rounded bg-[#f26a1b] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#d85a10] disabled:opacity-50">{busy === 'create' ? 'Creating…' : 'Create vendor & start onboarding'}</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, v, set, span }: { label: string; v: string; set: (s: string) => void; span?: boolean }) {
  return (
    <label className={`block text-xs font-medium text-gray-500 ${span ? 'col-span-2' : ''}`}>{label}
      <input value={v} onChange={e => set(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-900" />
    </label>
  )
}
