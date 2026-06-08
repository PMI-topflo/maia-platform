'use client'

// =====================================================================
// StaffSetupMock.tsx
// DESIGN MOCKUP of the Staff Setup page — manage each staffer's profile,
// working hours, and recurring task list (which feeds MAIA's daily
// journal). Static sample data; nothing is wired. For sign-off before we
// build the real tables + APIs.
// =====================================================================

import { useState } from 'react'

type Recurrence = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'on_expiry'
const REC_LABEL: Record<Recurrence, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly', on_expiry: 'On expiry' }
const REC_STYLE: Record<Recurrence, string> = {
  daily: 'bg-teal-100 text-teal-800', weekly: 'bg-green-100 text-green-800',
  monthly: 'bg-indigo-100 text-indigo-800', yearly: 'bg-sky-100 text-sky-800', on_expiry: 'bg-amber-100 text-amber-800',
}

interface Task { id: string; title: string; source: 'maia' | 'manual'; recurrence: Recurrence; due: string | null; expires?: string | null }
interface Hours { day: string; in: string; out: string; lunch: number; off?: boolean }
interface Staff {
  id: string; name: string; role: string; alias: string
  personalEmail: string; companyEmail: string; personalPhone: string; companyPhone: string
  hours: Hours[]; tasks: Task[]
}

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const stdHours = (lunch = 45): Hours[] => WD.map(d => ({ day: d, in: '09:00', out: '17:00', lunch, off: d === 'Sat' || d === 'Sun' }))

const STAFF: Staff[] = [
  {
    id: '1', name: 'Paola Gonzalez', role: 'Maintenance Coordinator', alias: 'paola',
    personalEmail: 'paola.g@gmail.com', companyEmail: 'service@topfloridaproperties.com', personalPhone: '(305) 555-0188', companyPhone: '(305) 555-0140',
    hours: stdHours(45),
    tasks: [
      { id: 't1', title: 'Daily work-order triage', source: 'maia', recurrence: 'daily', due: 'Today' },
      { id: 't2', title: 'Renew elevator permit — Abbott', source: 'maia', recurrence: 'on_expiry', due: 'Aug 18', expires: '2026-09-01' },
      { id: 't3', title: 'Monthly vendor COI check', source: 'manual', recurrence: 'monthly', due: 'Jun 30' },
      { id: 't4', title: 'Quarterly fire-alarm test follow-up', source: 'maia', recurrence: 'yearly', due: 'Sep 18' },
    ],
  },
  {
    id: '2', name: 'Karen Setton', role: 'Financial Manager', alias: 'karen',
    personalEmail: 'karen.s@gmail.com', companyEmail: 'billing@topfloridaproperties.com', personalPhone: '(305) 555-0101', companyPhone: '(305) 555-0102',
    hours: stdHours(60),
    tasks: [
      { id: 't5', title: 'Monthly financials close', source: 'maia', recurrence: 'monthly', due: 'Jun 30' },
      { id: 't6', title: 'Annual budget preparation — all assocs', source: 'maia', recurrence: 'yearly', due: 'Oct 1' },
    ],
  },
  {
    id: '3', name: 'Jonathan Mendez', role: 'Accounts Receivable', alias: 'jonathan',
    personalEmail: 'j.mendez@gmail.com', companyEmail: 'ar@topfloridaproperties.com', personalPhone: '(305) 555-0133', companyPhone: '(305) 555-0134',
    hours: stdHours(30),
    tasks: [{ id: 't7', title: 'Daily reconciliation review', source: 'maia', recurrence: 'daily', due: 'Today' }],
  },
  {
    id: '4', name: 'Isabela Lopez', role: 'Accounts Payable', alias: 'isabela',
    personalEmail: 'isa.lopez@gmail.com', companyEmail: 'ap@topfloridaproperties.com', personalPhone: '(305) 555-0155', companyPhone: '(305) 555-0156',
    hours: stdHours(45),
    tasks: [{ id: 't8', title: 'Weekly AP payment run', source: 'manual', recurrence: 'weekly', due: 'Fri' }],
  },
  {
    id: '5', name: 'Fabio Setton', role: 'Association Strategist', alias: 'fabio',
    personalEmail: 'fabio@gmail.com', companyEmail: 'pmi@pmitop.com', personalPhone: '(305) 555-0111', companyPhone: '(305) 555-0112',
    hours: stdHours(60),
    tasks: [{ id: 't9', title: 'Annual D&O insurance renewal', source: 'maia', recurrence: 'yearly', due: 'Dec 15' }],
  },
]

export default function StaffSetupMock() {
  const [selId, setSelId] = useState(STAFF[0].id)
  const s = STAFF.find(x => x.id === selId)!
  const others = STAFF.filter(x => x.id !== selId)

  return (
    <div>
      <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <strong>Design mockup</strong> — sample data, nothing saves yet. Approve the layout and I&apos;ll wire it to real staff records + tasks, and feed the upcoming tasks into MAIA&apos;s Daily News journal.
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        {/* Staff list */}
        <aside className="rounded-lg border border-gray-200 bg-white p-2">
          {STAFF.map(p => (
            <button key={p.id} onClick={() => setSelId(p.id)}
              className={`mb-1 block w-full rounded-md px-3 py-2 text-left ${p.id === selId ? 'bg-[#fff4ee]' : 'hover:bg-gray-50'}`}>
              <div className={`text-sm font-medium ${p.id === selId ? 'text-[#c2410c]' : 'text-gray-900'}`}>{p.name}</div>
              <div className="text-[11px] text-gray-500">{p.role}</div>
            </button>
          ))}
          <button className="mt-1 w-full rounded-md border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-500 hover:border-[#f26a1b] hover:text-[#f26a1b]">+ Add staff member</button>
        </aside>

        {/* Detail */}
        <section className="space-y-4">
          {/* Profile */}
          <Card title={`${s.name} · ${s.role}`} action="Edit">
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <F label="Full name" v={s.name} />
              <F label="Alias" v={s.alias} />
              <F label="Company email" v={s.companyEmail} />
              <F label="Personal email" v={s.personalEmail} />
              <F label="Company phone" v={s.companyPhone} />
              <F label="Personal phone" v={s.personalPhone} />
            </div>
          </Card>

          {/* Working hours */}
          <Card title="Working hours" action="Edit">
            <p className="mb-2 text-[11px] text-gray-400">Flexible lunch — enter the number of minutes, not fixed times.</p>
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400">
                <th className="pb-1 text-left font-semibold">Day</th><th className="pb-1 text-left font-semibold">Check-in</th>
                <th className="pb-1 text-left font-semibold">Check-out</th><th className="pb-1 text-left font-semibold">Lunch (min)</th>
              </tr></thead>
              <tbody>
                {s.hours.map(h => (
                  <tr key={h.day} className="border-t border-gray-100">
                    <td className="py-1.5 font-medium text-gray-900">{h.day}</td>
                    {h.off ? <td className="py-1.5 text-gray-400" colSpan={3}>Off</td> : (<>
                      <td className="py-1.5 tabular-nums text-gray-700">{h.in}</td>
                      <td className="py-1.5 tabular-nums text-gray-700">{h.out}</td>
                      <td className="py-1.5 tabular-nums text-gray-700">{h.lunch}</td>
                    </>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Tasks */}
          <Card title="Tasks &amp; reminders" action="+ Add task">
            <p className="mb-2 text-[11px] text-amber-700">★ MAIA reads these and lists each person&apos;s upcoming tasks in their Daily News journal. Tasks marked <span className="font-semibold">MAIA</span> are auto-created (permit renewals, monthly closes…); reassign moves a task to another staffer.</p>
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400">
                <th className="pb-1 text-left font-semibold">Task</th><th className="pb-1 text-left font-semibold">Source</th>
                <th className="pb-1 text-left font-semibold">Recurrence</th><th className="pb-1 text-left font-semibold">Next / Expires</th>
                <th className="pb-1 text-left font-semibold">Reassign</th><th className="pb-1"></th>
              </tr></thead>
              <tbody>
                {s.tasks.map(t => (
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className="py-1.5 font-medium text-gray-900">{t.title}</td>
                    <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${t.source === 'maia' ? 'bg-[#fae8ff] text-[#86198f]' : 'bg-gray-100 text-gray-600'}`}>{t.source === 'maia' ? 'MAIA' : 'Manual'}</span></td>
                    <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${REC_STYLE[t.recurrence]}`}>{REC_LABEL[t.recurrence]}</span></td>
                    <td className="py-1.5 text-gray-700">{t.due}{t.expires && <span className="text-gray-400"> · exp {t.expires}</span>}</td>
                    <td className="py-1.5">
                      <select className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600" defaultValue="">
                        <option value="" disabled>Move to…</option>
                        {others.map(o => <option key={o.id}>{o.name}</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 text-right"><button className="text-xs text-gray-400 hover:text-red-600">Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      </div>
    </div>
  )
}

function Card({ title, action, children }: { title: string; action?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {action && <button className="text-xs font-medium text-[#f26a1b] hover:text-[#d85a14]">{action}</button>}
      </div>
      {children}
    </div>
  )
}
function F({ label, v }: { label: string; v: string }) {
  return <div><div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div><div className="text-sm text-gray-900">{v}</div></div>
}
