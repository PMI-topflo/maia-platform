// =====================================================================
// app/admin/profile/page.tsx
// Staff's own pmi_staff row — view and edit name, work + personal
// email, phone, role, department. The PATCH endpoint at /api/admin/me
// only allows touching the current session's own row.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveStaffByLoginEmail } from '@/lib/staff-lookup'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import ProfileForm from './ProfileForm'

export const metadata = { title: 'My Profile — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function StaffProfilePage() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  const loginEmail = typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : ''

  // Use the canonical resolver so name-derived aliases like
  // fabio@pmitop.com find the right row when the column values store
  // pmi@pmitop.com / pmi@topfloridaproperties.com.
  const resolved = loginEmail ? await resolveStaffByLoginEmail(loginEmail) : null
  const { data: profile } = resolved
    ? await supabaseAdmin
        .from('pmi_staff')
        .select('id, name, email, personal_email, alt_emails, phone, role, department, active')
        .eq('id', resolved.id)
        .maybeSingle()
    : { data: null }

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-md mx-auto px-6 py-6">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">My Profile</h1>
        <p className="text-sm text-gray-500 mb-6">
          Edit your staff record. Setting <strong>personal email</strong> alongside your work email lets you log in with either address — and lets the Control Panel pick up tasks assigned to either.
        </p>

        {profile ? (
          <ProfileForm initial={profile} loginEmail={loginEmail} />
        ) : (
          <div className="bg-white border border-amber-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-amber-800 uppercase tracking-wide mb-2 [font-family:var(--font-mono)]">No staff record found</h2>
            <p className="text-sm text-gray-700">
              We couldn&apos;t find a <code className="bg-gray-100 px-1 rounded">pmi_staff</code> row for{' '}
              <span className="font-mono text-gray-900">{loginEmail || '(no session email)'}</span>. Ask another admin to add you via the <em>Add Person</em> button on any owners/communications dashboard, or run a one-line SQL insert via Supabase Studio. Once a row exists you can come back here to edit the rest.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
