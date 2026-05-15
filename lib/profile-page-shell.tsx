// =====================================================================
// lib/profile-page-shell.tsx
// Shared server-side scaffold for non-staff profile pages. Each
// persona route (e.g. /my-account/profile) wraps this with its own
// persona constant — keeps the five page files tiny.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { type Persona, lookupPersonaRecord } from '@/lib/profile-change'
import SiteHeader from '@/components/SiteHeader'
import PersonaProfileForm from '@/components/PersonaProfileForm'

interface ShellProps {
  persona:       Persona
  redirectIfNot: string  // path to send the visitor to if their session is wrong persona
  title:         string  // SiteHeader subtitle text
}

export default async function PersonaProfileShell({ persona, redirectIfNot, title }: ShellProps) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== persona) redirect(redirectIfNot)

  const record = await lookupPersonaRecord(persona, {
    userId:          session.userId,
    associationCode: session.associationCode,
  })

  let pendingProposed: string | null = null
  if (record) {
    const { data } = await supabaseAdmin
      .from('pending_profile_changes')
      .select('proposed_value')
      .eq('persona',           persona)
      .eq('persona_record_id', record.id)
      .eq('field',             'email')
      .eq('status',            'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    pendingProposed = data?.proposed_value ?? null
  }

  return (
    <main className="assoc-page">
      <div className="assoc-topbar">
        <span className="assoc-topbar-l">WHATSAPP &amp; SMS 24/7 · +1 (786) 686-3223 · WE SPEAK ENGLISH, SPANISH, FRENCH &amp; PORTUGUESE</span>
        <span className="assoc-topbar-r">305.900.5077</span>
      </div>

      <SiteHeader subtitle={title} />

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--navy)', marginBottom: '.25rem' }}>My Profile</h1>
        <p style={{ fontSize: '.85rem', color: 'var(--muted)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
          Update your contact details. Login-email changes are reviewed by PMI staff before they take effect — you&apos;ll keep using your current address until the change is approved.
        </p>

        {record ? (
          <PersonaProfileForm initial={record} persona={persona} pendingProposed={pendingProposed} />
        ) : (
          <div className="prow" style={{ background: '#fef3c7', border: '1px solid #fcd34d', padding: '1rem', borderRadius: 6 }}>
            <div className="prow-info">
              <div className="prow-t">Profile not found</div>
              <div className="prow-d" style={{ marginTop: 4 }}>
                We couldn&apos;t locate your record for this persona. Contact PMI at <a href="mailto:pmi@pmitop.com" style={{ color: 'var(--orange)' }}>pmi@pmitop.com</a> to investigate.
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
