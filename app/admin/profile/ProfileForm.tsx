'use client'

import { useState, type FormEvent } from 'react'

interface StaffProfile {
  id:             string
  name:           string | null
  email:          string | null
  personal_email: string | null
  phone:          string | null
  role:           string | null
  department:     string | null
  active:         boolean | null
}

interface Props {
  initial:    StaffProfile
  loginEmail: string
}

const labelCls = 'block mb-1 text-[0.62rem] font-medium uppercase tracking-[0.1em] text-gray-500 [font-family:var(--font-mono)]'
const inputCls = 'w-full bg-white border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#f26a1b] focus:shadow-[0_0_0_3px_rgba(242,106,27,.15)] transition-shadow'

export default function ProfileForm({ initial, loginEmail }: Props) {
  const [name,           setName]           = useState(initial.name           ?? '')
  const [email,          setEmail]          = useState(initial.email          ?? '')
  const [personalEmail,  setPersonalEmail]  = useState(initial.personal_email ?? '')
  const [phone,          setPhone]          = useState(initial.phone          ?? '')
  const [role,           setRole]           = useState(initial.role           ?? '')
  const [department,     setDepartment]     = useState(initial.department     ?? '')
  const [busy,           setBusy]           = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [savedAt,        setSavedAt]        = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) { setError('Work email is required'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/admin/me', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, email, personal_email: personalEmail, phone, role, department }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Update failed')
      setSavedAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className={labelCls}>Name</label>
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
        </div>

        <div>
          <label className={labelCls}>Work email *</label>
          <input type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} placeholder="name@pmitop.com" />
          <p className="text-[0.7rem] text-gray-500 mt-1">Primary work address. Used as the assignee on tickets and as your @ in <code className="bg-gray-100 px-1 rounded">@assign</code>.</p>
        </div>

        <div>
          <label className={labelCls}>Personal email</label>
          <input type="email" className={inputCls} value={personalEmail} onChange={e => setPersonalEmail(e.target.value)} placeholder="(optional backup)" />
          <p className="text-[0.7rem] text-gray-500 mt-1">Alternate address for OTP login. Setting this means tasks assigned to <em>either</em> email show up on your Control Panel.</p>
        </div>

        <div>
          <label className={labelCls}>Phone</label>
          <input type="tel" className={inputCls} value={phone} onChange={e => setPhone(e.target.value)} />
        </div>

        <div>
          <label className={labelCls}>Role</label>
          <input className={inputCls} value={role} onChange={e => setRole(e.target.value)} placeholder="Manager, Associate…" />
        </div>

        <div className="md:col-span-2">
          <label className={labelCls}>Department</label>
          <input className={inputCls} value={department} onChange={e => setDepartment(e.target.value)} />
        </div>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
      {savedAt && !error && <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">Saved at {savedAt}.</div>}

      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <div className="text-[0.7rem] text-gray-400 [font-family:var(--font-mono)]">
          Signed in as <span className="text-gray-700">{loginEmail}</span>
        </div>
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
