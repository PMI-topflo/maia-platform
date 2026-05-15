'use client'

// =====================================================================
// components/PersonaProfileForm.tsx
// Shared self-edit form for the non-staff personas (owner / tenant /
// board / unit_manager / building_manager). Saves directly to
// /api/me — that endpoint splits the patch into safe fields (apply
// immediately) vs email (queue pending approval).
// =====================================================================

import { useState, type FormEvent } from 'react'

export interface PersonaProfileInitial {
  id:               string
  name:             string
  current_email:    string | null
  phone:            string | null
  association_code: string | null
  association_name: string | null
  unit_number:      string | null
  extra:            Record<string, string | null>
}

export interface PersonaProfileFormProps {
  initial:          PersonaProfileInitial
  persona:          'owner' | 'tenant' | 'board' | 'unit_manager' | 'building_manager'
  pendingProposed?: string | null
}

const labelCls = 'block mb-1 text-[0.62rem] font-medium uppercase tracking-[0.1em] text-gray-500 [font-family:var(--font-mono)]'
const inputCls = 'w-full bg-white border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#f26a1b] focus:shadow-[0_0_0_3px_rgba(242,106,27,.15)] transition-shadow'

const PERSONA_LABEL: Record<PersonaProfileFormProps['persona'], string> = {
  owner:            'Unit Owner',
  tenant:           'Tenant',
  board:            'Board Member',
  unit_manager:     'Unit Manager',
  building_manager: 'Building Manager',
}

export default function PersonaProfileForm({ initial, persona, pendingProposed }: PersonaProfileFormProps) {
  // Board persona keeps a single `name`; the others split into first/last.
  const splitsName = persona !== 'board'
  const [firstName,  setFirstName]  = useState(initial.extra.first_name ?? '')
  const [lastName,   setLastName]   = useState(initial.extra.last_name  ?? '')
  const [boardName,  setBoardName]  = useState(initial.name)
  const [email,      setEmail]      = useState(initial.current_email ?? '')
  const [phone,      setPhone]      = useState(initial.phone ?? '')
  const [phone2,     setPhone2]     = useState(initial.extra.phone_2 ?? '')
  const [address,    setAddress]    = useState(initial.extra.address ?? '')
  const [company,    setCompany]    = useState(initial.extra.company_name ?? '')
  const [busy,       setBusy]       = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [savedAt,    setSavedAt]    = useState<string | null>(null)
  const [pendingMsg, setPendingMsg] = useState<string | null>(pendingProposed ? `Pending approval for ${pendingProposed}` : null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const patch: Record<string, string | null> = { phone }
    if (splitsName) {
      patch.first_name = firstName
      patch.last_name  = lastName
    } else {
      patch.name = boardName
    }
    if (persona === 'owner') {
      patch.phone_2 = phone2
      patch.address = address
    }
    if (persona === 'unit_manager' || persona === 'building_manager') {
      patch.company_name = company
    }
    // Email goes through only if changed
    const trimmed = email.trim().toLowerCase()
    const currentLow = (initial.current_email ?? '').toLowerCase()
    if (trimmed && trimmed !== currentLow && !currentLow.includes(trimmed)) {
      patch.email = trimmed
    }

    try {
      const res  = await fetch('/api/me', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Update failed')
      setSavedAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }))
      if (data.pending_id) {
        setPendingMsg(`Email change submitted — staff will receive an approval email. Your current address keeps working until it's approved.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="bg-white border border-gray-200 rounded-lg p-6 space-y-4 max-w-2xl">
      <div className="text-[0.62rem] font-mono uppercase tracking-[0.1em] text-[#f26a1b]">{PERSONA_LABEL[persona]}</div>
      <div className="text-sm text-gray-500 -mt-2">
        {initial.association_name ?? initial.association_code ?? '—'}
        {initial.unit_number ? ` · Unit ${initial.unit_number}` : ''}
      </div>

      {splitsName ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>First name</label>
            <input className={inputCls} value={firstName} onChange={e => setFirstName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Last name</label>
            <input className={inputCls} value={lastName} onChange={e => setLastName(e.target.value)} />
          </div>
        </div>
      ) : (
        <div>
          <label className={labelCls}>Name</label>
          <input className={inputCls} value={boardName} onChange={e => setBoardName(e.target.value)} />
        </div>
      )}

      <div>
        <label className={labelCls}>Email</label>
        <input
          type="email"
          className={inputCls}
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <p className="text-[0.7rem] text-gray-500 mt-1">
          Your login email. Changes are <strong>not applied immediately</strong> — they need PMI staff approval. You&apos;ll keep using your current address until then.
        </p>
        {pendingMsg && (
          <div className="mt-2 text-[0.78rem] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">{pendingMsg}</div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Phone</label>
          <input type="tel" className={inputCls} value={phone} onChange={e => setPhone(e.target.value)} />
        </div>
        {persona === 'owner' && (
          <div>
            <label className={labelCls}>Secondary phone</label>
            <input type="tel" className={inputCls} value={phone2} onChange={e => setPhone2(e.target.value)} />
          </div>
        )}
        {(persona === 'unit_manager' || persona === 'building_manager') && (
          <div>
            <label className={labelCls}>Company</label>
            <input className={inputCls} value={company} onChange={e => setCompany(e.target.value)} />
          </div>
        )}
      </div>

      {persona === 'owner' && (
        <div>
          <label className={labelCls}>Mailing address</label>
          <input className={inputCls} value={address} onChange={e => setAddress(e.target.value)} />
        </div>
      )}

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
      {savedAt && !error && <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">Saved at {savedAt}.</div>}

      <div className="flex items-center justify-end pt-2 border-t border-gray-100">
        <button
          type="submit"
          disabled={busy}
          className="bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white text-xs font-medium uppercase tracking-wide px-4 py-2 rounded transition-colors [font-family:var(--font-mono)]"
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}
