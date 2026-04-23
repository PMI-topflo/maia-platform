'use client'

import { useState, useTransition, useEffect } from 'react'
import { Owner, Association, updateOwner, createOwner } from '../actions'

type Props = {
  owner: Owner | null
  associations: Association[]
  onClose: () => void
  onSaved: () => void
}

type FormState = {
  first_name: string
  last_name: string
  association_code: string
  association_name: string
  account_number: string
  unit_number: string
  street_number: string
  address: string
  city: string
  state: string
  zip_code: string
  phone: string
  phone_2: string
  phone_3: string
  emails: string
  pmi_service_type: string
  language: string
  verified_status: string
}

const EMPTY: FormState = {
  first_name: '', last_name: '', association_code: '', association_name: '',
  account_number: '', unit_number: '', street_number: '', address: '',
  city: '', state: 'FL', zip_code: '', phone: '', phone_2: '', phone_3: '',
  emails: '', pmi_service_type: 'full management', language: 'en',
  verified_status: 'pending',
}

export default function EditModal({ owner, associations, onClose, onSaved }: Props) {
  const isEdit = owner !== null
  const [form, setForm] = useState<FormState>(() =>
    owner
      ? {
          first_name: owner.first_name ?? '',
          last_name: owner.last_name ?? '',
          association_code: owner.association_code ?? '',
          association_name: owner.association_name ?? '',
          account_number: owner.account_number ?? '',
          unit_number: owner.unit_number ?? '',
          street_number: owner.street_number ?? '',
          address: owner.address ?? '',
          city: owner.city ?? '',
          state: owner.state ?? 'FL',
          zip_code: owner.zip_code ?? '',
          phone: owner.phone ?? '',
          phone_2: owner.phone_2 ?? '',
          phone_3: owner.phone_3 ?? '',
          emails: owner.emails ?? '',
          pmi_service_type: owner.pmi_service_type ?? 'full management',
          language: owner.language ?? 'en',
          verified_status: owner.verified_status ?? 'pending',
        }
      : EMPTY
  )
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  // Sync association_name when code changes
  useEffect(() => {
    if (form.association_code) {
      const found = associations.find(a => a.association_code === form.association_code)
      if (found) setForm(f => ({ ...f, association_name: found.association_name }))
    }
  }, [form.association_code, associations])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = () => {
    if (!form.first_name && !form.last_name) {
      setError('First or last name is required.')
      return
    }
    setError('')
    startTransition(async () => {
      if (isEdit) {
        const result = await updateOwner(owner.id, form)
        if (result.error) { setError(result.error); return }
      } else {
        const result = await createOwner(form)
        if (result.error) { setError(result.error); return }
      }
      onSaved()
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEdit ? `Edit — ${owner.first_name} ${owner.last_name}` : 'Add Homeowner'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5 flex-1">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>
          )}

          {/* Association */}
          <Section title="Association">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Association</Label>
                <select
                  value={form.association_code}
                  onChange={set('association_code')}
                  className={INPUT}
                >
                  <option value="">— Select —</option>
                  {associations.map(a => (
                    <option key={a.association_code} value={a.association_code}>
                      {a.association_code} — {a.association_name}
                    </option>
                  ))}
                </select>
              </div>
              <Field label="Account Number" value={form.account_number} onChange={set('account_number')} placeholder="e.g. 1001" />
              <Field label="Unit Number" value={form.unit_number} onChange={set('unit_number')} placeholder="e.g. 101A" />
            </div>
          </Section>

          {/* Name */}
          <Section title="Owner">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First Name" value={form.first_name} onChange={set('first_name')} />
              <Field label="Last Name" value={form.last_name} onChange={set('last_name')} />
            </div>
          </Section>

          {/* Address */}
          <Section title="Address">
            <div className="grid grid-cols-4 gap-3">
              <Field label="Street #" value={form.street_number} onChange={set('street_number')} placeholder="123" />
              <div className="col-span-3">
                <Field label="Street Address" value={form.address} onChange={set('address')} placeholder="Ocean Dr" />
              </div>
              <div className="col-span-2">
                <Field label="City" value={form.city} onChange={set('city')} />
              </div>
              <Field label="State" value={form.state} onChange={set('state')} placeholder="FL" />
              <Field label="ZIP" value={form.zip_code} onChange={set('zip_code')} />
            </div>
          </Section>

          {/* Contact */}
          <Section title="Contact">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone" value={form.phone} onChange={set('phone')} placeholder="(305) 555-0100" />
              <Field label="Phone 2" value={form.phone_2} onChange={set('phone_2')} />
              <Field label="Phone 3" value={form.phone_3} onChange={set('phone_3')} />
              <Field label="Email(s)" value={form.emails} onChange={set('emails')} placeholder="owner@email.com" />
            </div>
          </Section>

          {/* Settings */}
          <Section title="Settings">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Service Type</Label>
                <select value={form.pmi_service_type} onChange={set('pmi_service_type')} className={INPUT}>
                  <option value="full management">Full Management</option>
                  <option value="financial only">Financial Only</option>
                  <option value="leasing only">Leasing Only</option>
                </select>
              </div>
              <div>
                <Label>Language</Label>
                <select value={form.language} onChange={set('language')} className={INPUT}>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                  <option value="pt">Português</option>
                  <option value="fr">Français</option>
                  <option value="he">עברית</option>
                  <option value="ru">Русский</option>
                </select>
              </div>
              <div>
                <Label>Status</Label>
                <select value={form.verified_status} onChange={set('verified_status')} className={INPUT}>
                  <option value="pending">Pending</option>
                  <option value="verified">Verified</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="text-sm text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="text-sm font-medium bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Homeowner'}
          </button>
        </div>
      </div>
    </div>
  )
}

const INPUT = 'w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-gray-600 mb-1">{children}</label>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  )
}

function Field({
  label, value, onChange, placeholder,
}: {
  label: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
}) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={INPUT}
      />
    </div>
  )
}
