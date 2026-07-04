'use client'

import { useState } from 'react'

type TabKey = 'owner' | 'board' | 'unit_manager' | 'building_manager' | 'agent' | 'vendor' | 'staff'

interface Prefill { fullName?: string; email?: string; phone?: string; association?: string }

interface Props {
  associations: Array<{ association_code: string; association_name: string }>
  onClose: () => void
  onAdded: () => void
  initialTab?: TabKey
  prefill?: Prefill
}

/** Maps a generic {fullName, email, phone} prefill onto the field names
 *  each tab actually uses (owner/board split into first/last name; agent
 *  keeps one full_name field; etc). Used when opening from an external
 *  source (e.g. the pre-registrations dashboard) that only has a single
 *  name string, not pre-split first/last. */
function prefillForTab(tab: TabKey, p?: Prefill): Record<string, string> {
  if (!p) return {}
  const [first, ...rest] = (p.fullName ?? '').trim().split(/\s+/)
  const last = rest.join(' ')
  const assocCode = p.association ?? ''
  switch (tab) {
    case 'owner':
      return { first_name: first ?? '', last_name: last, emails: p.email ?? '', phone: p.phone ?? '', association_code: assocCode }
    case 'board':
      return { first_name: first ?? '', last_name: last, email: p.email ?? '', phone: p.phone ?? '', association_code: assocCode }
    case 'unit_manager':
    case 'building_manager':
      return { first_name: first ?? '', last_name: last, email: p.email ?? '', phone: p.phone ?? '', association_code: assocCode }
    case 'agent':
      return { full_name: p.fullName ?? '', email: p.email ?? '', phone: p.phone ?? '' }
    case 'vendor':
      return { company_name: p.fullName ?? '', email: p.email ?? '', phone: p.phone ?? '' }
    case 'staff':
      return { name: p.fullName ?? '', email: p.email ?? '', phone: p.phone ?? '' }
    default:
      return {}
  }
}

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'owner',            label: 'Unit Owner',         icon: '🏠' },
  { key: 'board',            label: 'Board Member',       icon: '👥' },
  { key: 'unit_manager',     label: 'Unit Manager',       icon: '🏢' },
  { key: 'building_manager', label: 'Bldg Manager',       icon: '🏗️' },
  { key: 'agent',            label: 'Agent',              icon: '🤝' },
  { key: 'vendor',           label: 'Vendor',             icon: '🔧' },
  { key: 'staff',            label: 'Staff Member',       icon: '🔒' },
]

const inputCls  = 'w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#f26a1b] transition-colors'
const labelCls  = 'block text-[0.6rem] font-mono uppercase tracking-[0.1em] text-gray-400 mb-1'
const gridTwo   = 'grid grid-cols-2 gap-3'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={labelCls}>{label}</label>{children}</div>
}

export default function AddPersonModal({ associations, onClose, onAdded, initialTab, prefill }: Props) {
  const [tab,    setTab]    = useState<TabKey>(initialTab ?? 'owner')
  const [form,   setForm]   = useState<Record<string, string>>(() => prefillForTab(initialTab ?? 'owner', prefill))
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState('')
  const [done,   setDone]   = useState(false)

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  function switchTab(t: TabKey) { setTab(t); setForm(prefillForTab(t, prefill)); setError('') }

  async function submit() {
    setBusy(true); setError('')
    try {
      // For unit_manager, parse managed_units from JSON string back to array
      const data = { ...form }
      if (tab === 'unit_manager' && data.managed_units) {
        try { (data as Record<string, unknown>).managed_units = JSON.parse(data.managed_units) } catch { /* keep as-is */ }
      }
      delete (data as Record<string, unknown>).managed_units_raw
      const res = await fetch('/api/admin/add-person', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: tab, data }),
      })
      const json = await res.json()
      if (!json.ok) { setError(json.error ?? 'Failed to save'); setBusy(false); return }
      setDone(true)
      setTimeout(() => { onAdded(); onClose() }, 1200)
    } catch { setError('Network error') } finally { setBusy(false) }
  }

  const assocSelect = (
    <select className={inputCls} value={form.association_code ?? ''} onChange={set('association_code')}>
      <option value="">Select association…</option>
      {associations.map(a => (
        <option key={a.association_code} value={a.association_code}>
          {a.association_name} ({a.association_code})
        </option>
      ))}
    </select>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">Add New Person</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 flex-shrink-0">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={[
                'flex-1 text-[0.6rem] font-mono uppercase tracking-wider py-3 transition-colors border-b-2',
                tab === t.key
                  ? 'border-[#f26a1b] text-[#f26a1b]'
                  : 'border-transparent text-gray-400 hover:text-gray-600',
              ].join(' ')}
            >
              <span className="block text-base mb-0.5">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Form */}
        <div className="px-6 py-5 overflow-y-auto flex-1">
          {done ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center text-2xl">✓</div>
              <p className="text-sm font-semibold text-gray-700">
                {TABS.find(t => t.key === tab)?.label} added successfully
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {tab === 'owner' && (
                <>
                  <div className={gridTwo}>
                    <Field label="First Name *"><input className={inputCls} value={form.first_name ?? ''} onChange={set('first_name')} /></Field>
                    <Field label="Last Name *"><input className={inputCls} value={form.last_name ?? ''} onChange={set('last_name')} /></Field>
                  </div>
                  <Field label="Association *">{assocSelect}</Field>
                  <div className={gridTwo}>
                    <Field label="Unit Number"><input className={inputCls} value={form.unit_number ?? ''} onChange={set('unit_number')} /></Field>
                    <Field label="Language">
                      <select className={inputCls} value={form.language ?? 'en'} onChange={set('language')}>
                        {['en','es','pt','fr','he','ru'].map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Email"><input type="email" className={inputCls} value={form.emails ?? ''} onChange={set('emails')} /></Field>
                  <Field label="Phone"><input type="tel" className={inputCls} value={form.phone ?? ''} onChange={set('phone')} /></Field>
                  <div className={gridTwo}>
                    <Field label="Address"><input className={inputCls} value={form.address ?? ''} onChange={set('address')} /></Field>
                    <Field label="City"><input className={inputCls} value={form.city ?? ''} onChange={set('city')} /></Field>
                  </div>
                  <div className={gridTwo}>
                    <Field label="State"><input className={inputCls} placeholder="FL" value={form.state ?? ''} onChange={set('state')} /></Field>
                    <Field label="Zip Code"><input className={inputCls} value={form.zip_code ?? ''} onChange={set('zip_code')} /></Field>
                  </div>
                </>
              )}

              {tab === 'board' && (
                <>
                  <div className={gridTwo}>
                    <Field label="First Name *"><input className={inputCls} value={form.first_name ?? ''} onChange={set('first_name')} /></Field>
                    <Field label="Last Name *"><input className={inputCls} value={form.last_name ?? ''} onChange={set('last_name')} /></Field>
                  </div>
                  <Field label="Association *">{assocSelect}</Field>
                  <Field label="Position"><input className={inputCls} placeholder="President, Treasurer, Secretary…" value={form.position ?? ''} onChange={set('position')} /></Field>
                  <Field label="Email"><input type="email" className={inputCls} value={form.email ?? ''} onChange={set('email')} /></Field>
                  <Field label="Phone"><input type="tel" className={inputCls} value={form.phone ?? ''} onChange={set('phone')} /></Field>
                </>
              )}

              {tab === 'unit_manager' && (
                <>
                  <div className={gridTwo}>
                    <Field label="First Name *"><input className={inputCls} value={form.first_name ?? ''} onChange={set('first_name')} /></Field>
                    <Field label="Last Name *"><input className={inputCls} value={form.last_name ?? ''} onChange={set('last_name')} /></Field>
                  </div>
                  <Field label="Association *">{assocSelect}</Field>
                  <Field label="Managed Units">
                    <input
                      className={inputCls}
                      placeholder="e.g. 101, 205, 310 (comma-separated)"
                      value={form.managed_units_raw ?? ''}
                      onChange={e => setForm(f => ({ ...f, managed_units_raw: e.target.value, managed_units: JSON.stringify(e.target.value.split(',').map(s => s.trim()).filter(Boolean)) }))}
                    />
                  </Field>
                  <Field label="Email"><input type="email" className={inputCls} value={form.email ?? ''} onChange={set('email')} /></Field>
                  <Field label="Phone"><input type="tel" className={inputCls} value={form.phone ?? ''} onChange={set('phone')} /></Field>
                  <Field label="Company Name"><input className={inputCls} placeholder="Management company (optional)" value={form.company_name ?? ''} onChange={set('company_name')} /></Field>
                  <Field label="Notes"><input className={inputCls} value={form.notes ?? ''} onChange={set('notes')} /></Field>
                </>
              )}

              {tab === 'building_manager' && (
                <>
                  <div className={gridTwo}>
                    <Field label="First Name *"><input className={inputCls} value={form.first_name ?? ''} onChange={set('first_name')} /></Field>
                    <Field label="Last Name *"><input className={inputCls} value={form.last_name ?? ''} onChange={set('last_name')} /></Field>
                  </div>
                  <Field label="Association *">{assocSelect}</Field>
                  <Field label="Email"><input type="email" className={inputCls} value={form.email ?? ''} onChange={set('email')} /></Field>
                  <Field label="Phone"><input type="tel" className={inputCls} value={form.phone ?? ''} onChange={set('phone')} /></Field>
                  <Field label="Company Name"><input className={inputCls} placeholder="On-site management company (optional)" value={form.company_name ?? ''} onChange={set('company_name')} /></Field>
                  <Field label="Notes"><input className={inputCls} value={form.notes ?? ''} onChange={set('notes')} /></Field>
                </>
              )}

              {tab === 'agent' && (
                <>
                  <Field label="Full Name *"><input className={inputCls} value={form.full_name ?? ''} onChange={set('full_name')} /></Field>
                  <Field label="Email"><input type="email" className={inputCls} value={form.email ?? ''} onChange={set('email')} /></Field>
                  <Field label="Phone"><input type="tel" className={inputCls} value={form.phone ?? ''} onChange={set('phone')} /></Field>
                  <div className={gridTwo}>
                    <Field label="License Number"><input className={inputCls} value={form.license_number ?? ''} onChange={set('license_number')} /></Field>
                    <Field label="License Expiry"><input type="date" className={inputCls} value={form.license_expiry ?? ''} onChange={set('license_expiry')} /></Field>
                  </div>
                  <Field label="Brokerage"><input className={inputCls} value={form.brokerage ?? ''} onChange={set('brokerage')} /></Field>
                </>
              )}

              {tab === 'vendor' && (
                <>
                  <Field label="Company Name *"><input className={inputCls} value={form.company_name ?? ''} onChange={set('company_name')} /></Field>
                  <Field label="Contact Name"><input className={inputCls} value={form.contact_name ?? ''} onChange={set('contact_name')} /></Field>
                  <Field label="Service Type"><input className={inputCls} placeholder="Plumbing, Landscaping, HVAC…" value={form.service_type ?? ''} onChange={set('service_type')} /></Field>
                  <Field label="Email"><input type="email" className={inputCls} value={form.email ?? ''} onChange={set('email')} /></Field>
                  <Field label="Phone"><input type="tel" className={inputCls} value={form.phone ?? ''} onChange={set('phone')} /></Field>
                  <Field label="License Number"><input className={inputCls} value={form.license_number ?? ''} onChange={set('license_number')} /></Field>
                </>
              )}

              {tab === 'staff' && (
                <>
                  <Field label="Name *"><input className={inputCls} value={form.name ?? ''} onChange={set('name')} /></Field>
                  <div className={gridTwo}>
                    <Field label="Work email *"><input type="email" className={inputCls} placeholder="name@pmitop.com" value={form.email ?? ''} onChange={set('email')} /></Field>
                    <Field label="Personal email"><input type="email" className={inputCls} placeholder="optional backup login" value={form.personal_email ?? ''} onChange={set('personal_email')} /></Field>
                  </div>
                  <Field label="Phone"><input type="tel" className={inputCls} value={form.phone ?? ''} onChange={set('phone')} /></Field>
                  <div className={gridTwo}>
                    <Field label="Role"><input className={inputCls} placeholder="Manager, Associate…" value={form.role ?? ''} onChange={set('role')} /></Field>
                    <Field label="Department"><input className={inputCls} value={form.department ?? ''} onChange={set('department')} /></Field>
                  </div>
                  <p className="text-[0.7rem] text-gray-500 leading-snug">Personal email is the alternate address the staff member may use to log in via OTP. Setting both unlocks tasks assigned to either address on the Control Panel.</p>
                </>
              )}

              {error && <p className="text-[0.72rem] text-red-500">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        {!done && (
          <div className="px-6 pb-5 pt-3 border-t border-gray-100 flex gap-3 justify-end flex-shrink-0">
            <button onClick={onClose} className="text-[0.65rem] font-mono uppercase tracking-wider px-4 py-2 rounded border border-gray-200 text-gray-500 hover:border-gray-400 transition-colors">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="text-[0.65rem] font-mono uppercase tracking-wider px-5 py-2 rounded bg-[#f26a1b] text-white hover:bg-[#f58140] disabled:opacity-50 transition-colors"
            >
              {busy ? 'Saving…' : `Add ${TABS.find(t => t.key === tab)?.label}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
