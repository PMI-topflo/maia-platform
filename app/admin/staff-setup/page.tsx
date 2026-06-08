// =====================================================================
// app/admin/staff-setup/page.tsx
// Staff Setup — manage each staffer's profile, working hours, and
// recurring task list (which feeds MAIA's Daily News journal). Wired to
// pmi_staff + staff_tasks.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import StaffSetupClient, { type StaffMember, type StaffTask, type HoursRow } from './StaffSetupClient'

export const metadata = { title: 'Staff Setup — PMI Top Florida' }
export const dynamic = 'force-dynamic'

const localPart = (e: string | null | undefined) => (e ?? '').toLowerCase().split('@')[0]
function isHuman(s: { email?: string | null; role?: string | null; name?: string | null }): boolean {
  if (localPart(s.email) === 'maia') return false
  return !/\b(ai|bot|system|automation)\b/i.test(`${s.role ?? ''} ${s.name ?? ''}`)
}

export default async function StaffSetupPage() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  // select('*') so the page still loads before the new columns are applied.
  const [{ data: staffRows }, { data: taskRows }] = await Promise.all([
    supabaseAdmin.from('pmi_staff').select('*').eq('active', true).order('name'),
    supabaseAdmin.from('staff_tasks').select('id, assignee_email, title, source, recurrence, next_due, expiry_date, notes').eq('active', true),
  ])

  const tasksByEmail = new Map<string, StaffTask[]>()
  for (const t of (taskRows ?? []) as StaffTask[]) {
    const k = (t.assignee_email ?? '').toLowerCase()
    const arr = tasksByEmail.get(k) ?? []; arr.push(t); tasksByEmail.set(k, arr)
  }

  const staff: StaffMember[] = ((staffRows ?? []) as Record<string, unknown>[])
    .filter(r => isHuman(r as { email?: string | null; role?: string | null; name?: string | null }))
    .map(r => ({
      id:             String(r.id),
      name:           String(r.name ?? r.email ?? '—'),
      email:          String(r.email ?? ''),
      role:           (r.role as string | null) ?? null,
      alias:          (r.alias as string | null) ?? null,
      personal_email: (r.personal_email as string | null) ?? null,
      personal_phone: (r.personal_phone as string | null) ?? null,
      phone:          (r.phone as string | null) ?? null,
      working_hours:  (Array.isArray(r.working_hours) ? r.working_hours : null) as HoursRow[] | null,
      tasks:          tasksByEmail.get(String(r.email ?? '').toLowerCase()) ?? [],
    }))

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Staff Setup</h1>
          <Link href="/admin/staff-performance" className="text-xs font-medium text-[#f26a1b] hover:underline">← Staff performance</Link>
        </div>
        <StaffSetupClient staff={staff} />
      </main>
    </div>
  )
}
