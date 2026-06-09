'use client'

// =====================================================================
// StaffSetupClient.tsx — the real Staff Setup page. Master-detail: pick a
// staffer → edit profile + working hours (saved to pmi_staff) and manage
// their recurring task list (staff_tasks: add / reassign / remove). Tasks
// feed MAIA's Daily News journal.
// =====================================================================

import { useState } from 'react'

const RECUR = ['daily', 'weekly', 'monthly', 'yearly', 'on_expiry', 'once'] as const
type Recurrence = typeof RECUR[number]
const REC_LABEL: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly', on_expiry: 'On expiry', once: 'Once' }
const REC_STYLE: Record<string, string> = {
  daily: 'bg-teal-100 text-teal-800', weekly: 'bg-green-100 text-green-800', monthly: 'bg-indigo-100 text-indigo-800',
  yearly: 'bg-sky-100 text-sky-800', on_expiry: 'bg-amber-100 text-amber-800', once: 'bg-gray-100 text-gray-600',
}
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export interface HoursRow { day: string; in: string; out: string; lunch: number; off: boolean }
export interface StaffTask { id: string; assignee_email: string; title: string; source: 'maia' | 'manual'; recurrence: string; next_due: string | null; expiry_date: string | null; notes: string | null }
export interface StaffMember {
  id: string; name: string; email: string; role: string | null
  alias: string | null; personal_email: string | null; personal_phone: string | null; phone: string | null
  working_hours: HoursRow[] | null; tasks: StaffTask[]
}

function defaultHours(): HoursRow[] {
  return WD.map(d => ({ day: d, in: '09:00', out: '17:00', lunch: 45, off: d === 'Sat' || d === 'Sun' }))
}

export default function StaffSetupClient({ staff }: { staff: StaffMember[] }) {
  const [selId, setSelId] = useState(staff[0]?.id ?? '')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const selected = staff.find(s => s.id === selId) ?? staff[0]
  if (!selected) return <p className="text-sm text-gray-500">No staff members found.</p>

  async function syncTasks() {
    setSyncing(true); setSyncMsg(null)
    try {
      const res = await fetch('/api/admin/staff-tasks/sync', { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'sync failed')
      setSyncMsg(`MAIA synced: ${d.created} new · ${d.updated} updated · ${d.closed} closed. Reloading…`)
      setTimeout(() => window.location.reload(), 1200)
    } catch (e) { setSyncMsg(e instanceof Error ? e.message : String(e)); setSyncing(false) }
  }

  return (
    <div>
    <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
      {syncMsg && <span className="text-xs text-gray-500">{syncMsg}</span>}
      <button onClick={syncTasks} disabled={syncing} className="rounded border border-[#f26a1b] px-3 py-1.5 text-sm font-medium text-[#c2410c] hover:bg-[#fff4ee] disabled:opacity-50">{syncing ? 'Syncing…' : '✦ Sync MAIA tasks'}</button>
    </div>
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
      <aside className="rounded-lg border border-gray-200 bg-white p-2">
        {staff.map(p => (
          <button key={p.id} onClick={() => setSelId(p.id)}
            className={`mb-1 block w-full rounded-md px-3 py-2 text-left ${p.id === selId ? 'bg-[#fff4ee]' : 'hover:bg-gray-50'}`}>
            <div className={`text-sm font-medium ${p.id === selId ? 'text-[#c2410c]' : 'text-gray-900'}`}>{p.name}</div>
            <div className="text-[11px] text-gray-500">{p.role ?? '—'}</div>
          </button>
        ))}
      </aside>

      {/* key remounts the editor with fresh form state when the selection changes */}
      <StaffEditor key={selected.id} staff={selected} allStaff={staff} />
    </div>
    </div>
  )
}

function StaffEditor({ staff, allStaff }: { staff: StaffMember; allStaff: StaffMember[] }) {
  const [name, setName] = useState(staff.name)
  const [role, setRole] = useState(staff.role ?? '')
  const [alias, setAlias] = useState(staff.alias ?? '')
  const [personalEmail, setPersonalEmail] = useState(staff.personal_email ?? '')
  const [companyPhone, setCompanyPhone] = useState(staff.phone ?? '')
  const [personalPhone, setPersonalPhone] = useState(staff.personal_phone ?? '')
  const [hours, setHours] = useState<HoursRow[]>(staff.working_hours && staff.working_hours.length ? staff.working_hours : defaultHours())
  const [tasks, setTasks] = useState<StaffTask[]>(staff.tasks)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingHours, setSavingHours] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  async function patchStaff(patch: Record<string, unknown>) {
    const res = await fetch(`/api/admin/staff-setup/${staff.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) throw new Error((await res.json())?.error ?? `HTTP ${res.status}`)
  }
  async function saveProfile() {
    setSavingProfile(true); setMsg(null)
    try { await patchStaff({ name, role, alias, personal_email: personalEmail, phone: companyPhone, personal_phone: personalPhone }); setMsg('Profile saved.') }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setSavingProfile(false) }
  }
  async function saveHours() {
    setSavingHours(true); setMsg(null)
    try { await patchStaff({ working_hours: hours }); setMsg('Working hours saved.') }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setSavingHours(false) }
  }
  function setRow(i: number, patch: Partial<HoursRow>) { setHours(h => h.map((r, j) => j === i ? { ...r, ...patch } : r)) }

  async function reassign(taskId: string, email: string) {
    if (!email) return
    setTasks(prev => prev.filter(t => t.id !== taskId))
    await fetch(`/api/admin/staff-tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignee_email: email }) }).catch(() => {})
  }
  async function removeTask(taskId: string) {
    if (!window.confirm('Remove this task?')) return
    setTasks(prev => prev.filter(t => t.id !== taskId))
    await fetch(`/api/admin/staff-tasks/${taskId}`, { method: 'DELETE' }).catch(() => {})
  }

  const others = allStaff.filter(s => s.id !== staff.id)

  return (
    <section className="space-y-4">
      {msg && <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{msg}</div>}

      {/* Profile */}
      <Card title={`${staff.name} · ${staff.role ?? 'Staff'}`} action={savingProfile ? 'Saving…' : 'Save'} onAction={saveProfile} disabled={savingProfile}>
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Field label="Full name"><Input v={name} set={setName} /></Field>
          <Field label="Role"><Input v={role} set={setRole} /></Field>
          <Field label="Alias"><Input v={alias} set={setAlias} placeholder="paola" /></Field>
          <Field label="Company email (login)"><div className="rounded border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-500">{staff.email}</div></Field>
          <Field label="Personal email"><Input v={personalEmail} set={setPersonalEmail} placeholder="name@gmail.com" /></Field>
          <Field label="Company phone"><Input v={companyPhone} set={setCompanyPhone} /></Field>
          <Field label="Personal phone"><Input v={personalPhone} set={setPersonalPhone} /></Field>
        </div>
      </Card>

      {/* Working hours */}
      <Card title="Working hours" action={savingHours ? 'Saving…' : 'Save'} onAction={saveHours} disabled={savingHours}>
        <p className="mb-2 text-[11px] text-gray-400">Flexible lunch — enter the number of minutes.</p>
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400">
            <th className="pb-1 text-left font-semibold">Day</th><th className="pb-1 text-left font-semibold">Off</th>
            <th className="pb-1 text-left font-semibold">Check-in</th><th className="pb-1 text-left font-semibold">Check-out</th><th className="pb-1 text-left font-semibold">Lunch (min)</th>
          </tr></thead>
          <tbody>
            {hours.map((h, i) => (
              <tr key={h.day} className="border-t border-gray-100">
                <td className="py-1.5 font-medium text-gray-900">{h.day}</td>
                <td className="py-1.5"><input type="checkbox" checked={h.off} onChange={e => setRow(i, { off: e.target.checked })} /></td>
                <td className="py-1.5"><input type="time" disabled={h.off} value={h.in} onChange={e => setRow(i, { in: e.target.value })} className="rounded border border-gray-300 px-1.5 py-0.5 text-sm disabled:bg-gray-50 disabled:text-gray-300" /></td>
                <td className="py-1.5"><input type="time" disabled={h.off} value={h.out} onChange={e => setRow(i, { out: e.target.value })} className="rounded border border-gray-300 px-1.5 py-0.5 text-sm disabled:bg-gray-50 disabled:text-gray-300" /></td>
                <td className="py-1.5"><input type="number" min={0} max={180} disabled={h.off} value={h.lunch} onChange={e => setRow(i, { lunch: Number(e.target.value) })} className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-sm disabled:bg-gray-50 disabled:text-gray-300" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Tasks */}
      <Card title="Tasks &amp; reminders" action="+ Add task" onAction={() => setAddOpen(true)}>
        <p className="mb-2 text-[11px] text-amber-700">★ MAIA lists each person&apos;s upcoming tasks in their Daily News journal. <span className="font-semibold">MAIA</span> tasks are auto-created (permit/inspection renewals, recurring maintenance); reassign moves a task to another staffer.</p>
        {tasks.length === 0 ? <p className="text-xs text-gray-400">No tasks yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className="pb-1 text-left font-semibold">Task</th><th className="pb-1 text-left font-semibold">Source</th>
              <th className="pb-1 text-left font-semibold">Recurrence</th><th className="pb-1 text-left font-semibold">Next / Expires</th>
              <th className="pb-1 text-left font-semibold">Reassign</th><th className="pb-1"></th>
            </tr></thead>
            <tbody>
              {tasks.map(t => (
                <tr key={t.id} className="border-t border-gray-100">
                  <td className="py-1.5 font-medium text-gray-900">{t.title}</td>
                  <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${t.source === 'maia' ? 'bg-[#fae8ff] text-[#86198f]' : 'bg-gray-100 text-gray-600'}`}>{t.source === 'maia' ? 'MAIA' : 'Manual'}</span></td>
                  <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${REC_STYLE[t.recurrence]}`}>{REC_LABEL[t.recurrence] ?? t.recurrence}</span></td>
                  <td className="py-1.5 text-gray-700">{t.next_due ?? '—'}{t.expiry_date && <span className="text-gray-400"> · exp {t.expiry_date}</span>}</td>
                  <td className="py-1.5">
                    <select className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600" value="" onChange={e => reassign(t.id, e.target.value)}>
                      <option value="">Move to…</option>
                      {others.map(o => <option key={o.id} value={o.email}>{o.name}</option>)}
                    </select>
                  </td>
                  <td className="py-1.5 text-right"><button onClick={() => removeTask(t.id)} className="text-xs text-gray-400 hover:text-red-600">Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {addOpen && <AddTaskModal assignee={staff.email} onClose={() => setAddOpen(false)} onCreated={t => { setTasks(prev => [...prev, t]); setAddOpen(false) }} />}
    </section>
  )
}

function Card({ title, action, onAction, disabled, children }: { title: string; action?: string; onAction?: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {action && onAction && <button onClick={onAction} disabled={disabled} className="text-xs font-medium text-[#f26a1b] hover:text-[#d85a14] disabled:text-gray-300">{action}</button>}
      </div>
      {children}
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wide text-gray-400">{label}</span>{children}</label>
}
function Input({ v, set, placeholder }: { v: string; set: (s: string) => void; placeholder?: string }) {
  return <input value={v} onChange={e => set(e.target.value)} placeholder={placeholder} className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" />
}

function AddTaskModal({ assignee, onClose, onCreated }: { assignee: string; onClose: () => void; onCreated: (t: StaffTask) => void }) {
  const [title, setTitle] = useState('')
  const [recurrence, setRecurrence] = useState<Recurrence>('monthly')
  const [nextDue, setNextDue] = useState('')
  const [expiry, setExpiry] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!title.trim()) { setErr('Task title is required.'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/admin/staff-tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignee_email: assignee, title: title.trim(), recurrence, next_due: nextDue || null, expiry_date: recurrence === 'on_expiry' ? (expiry || null) : null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      onCreated(data.task as StaffTask)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/45 p-4">
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
        <div className="text-base font-bold text-gray-900">Add task</div>
        <div className="mt-4 space-y-3">
          <Field label="Task"><Input v={title} set={setTitle} placeholder="Monthly vendor COI check" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Recurrence">
              <select value={recurrence} onChange={e => setRecurrence(e.target.value as Recurrence)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                {RECUR.map(r => <option key={r} value={r}>{REC_LABEL[r]}</option>)}
              </select>
            </Field>
            {recurrence === 'on_expiry'
              ? <Field label="Expiry date"><input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>
              : <Field label="Next due (optional)"><input type="date" value={nextDue} onChange={e => setNextDue(e.target.value)} className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>}
          </div>
        </div>
        {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded bg-[#f26a1b] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d85a14] disabled:opacity-50">{busy ? 'Saving…' : 'Add task'}</button>
        </div>
      </div>
    </div>
  )
}
