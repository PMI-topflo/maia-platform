import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'

export const dynamic = 'force-dynamic'

export default async function BuildingManagerPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null

  if (!session || session.persona !== 'building_manager') redirect('/')

  const { data: mgr } = await supabaseAdmin
    .from('building_managers')
    .select('id, first_name, last_name, email, phone, association_code, company_name')
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    .eq('id', String(session!.userId))
    .eq('active', true)
    .single()

  if (!mgr) redirect('/')

  const { data: assocRow } = await supabaseAdmin
    .from('associations')
    .select('association_name, public_website_url')
    .eq('association_code', mgr.association_code)
    .single()

  const assocName = assocRow?.association_name ?? mgr.association_code
  const assocCode = mgr.association_code.toLowerCase()

  const { data: driveFolders } = await supabaseAdmin
    .from('association_drive_folders')
    .select('folder_type, drive_link')
    .eq('association_code', mgr.association_code)
    .eq('active', true)
    .order('folder_type')

  const { count: pendingApps } = await supabaseAdmin
    .from('applications')
    .select('id', { count: 'exact', head: true })
    .eq('association', assocName)
    .eq('board_approval_status', 'pending')

  const displayName = [mgr.first_name, mgr.last_name].filter(Boolean).join(' ')

  const folderIconMap: Record<string, string> = {
    'Rules & Regulations': '📋',
    'Tenant Applications': '📝',
    'Financials': '💰',
    'Maintenance': '🔧',
    'Board Minutes': '📅',
    'Leases and Resale': '🏠',
    'Condo Docs': '📁',
    'Insurance Files': '🛡️',
    'ACH Forms': '🏦',
    'Welcome Letters': '✉️',
    'Budget': '📊',
    'Violations': '⚠️',
    'FAQ': '❓',
  }

  return (
    <main className="assoc-page">
      <div className="assoc-topbar">
        <span className="assoc-topbar-l">WHATSAPP &amp; SMS 24/7 · +1 (786) 686-3223 · WE SPEAK ENGLISH, SPANISH, FRENCH &amp; PORTUGUESE</span>
        <span className="assoc-topbar-r">305.900.5077</span>
      </div>

      <SiteHeader subtitle={`BUILDING MANAGER PORTAL · ${assocName}`} />

      {/* Manager info */}
      <div className="section">
        <h2 className="section-title">Manager Overview</h2>
      </div>

      <div className="prow-grid" style={{ marginTop: 0 }}>
        <div className="prow" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%' }}>
            <div className="prow-orb">🏗️</div>
            <div className="prow-info">
              <div className="prow-t">{displayName}</div>
              <div className="prow-d">
                {mgr.company_name ? `${mgr.company_name} · ` : ''}On-Site Building Manager · {assocName}
              </div>
            </div>
          </div>

          {(mgr.email || mgr.phone) && (
            <div style={{ width: '100%', borderTop: '1px solid var(--border)', paddingTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: '0.2rem' }}>
                Contact on file
              </div>
              {mgr.email && (
                <div style={{ fontSize: '0.8rem', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>✉</span> {mgr.email}
                </div>
              )}
              {mgr.phone && (
                <div style={{ fontSize: '0.8rem', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>📞</span> {mgr.phone}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="section" style={{ paddingTop: '1.5rem' }}>
        <h2 className="section-title">Quick Actions</h2>
      </div>

      <div className="prow-grid" style={{ marginTop: 0 }}>
        <a href={`/${assocCode}`} target="_blank" rel="noreferrer" className="prow">
          <div className="prow-orb">🌐</div>
          <div className="prow-info">
            <div className="prow-t">Association Portal</div>
            <div className="prow-d">View the resident portal for {assocName}</div>
          </div>
          <div className="prow-btn">Open</div>
        </a>

        {(pendingApps ?? 0) > 0 && (
          <div className="prow" style={{ cursor: 'default' }}>
            <div className="prow-orb">⚠️</div>
            <div className="prow-info">
              <div className="prow-t">Pending Applications</div>
              <div className="prow-d">{pendingApps} application{pendingApps !== 1 ? 's' : ''} awaiting board review</div>
            </div>
            <span style={{ marginLeft: 'auto', background: '#fef3c7', color: '#92400e', borderRadius: 9999, padding: '0.15rem 0.6rem', fontSize: '0.75rem', fontWeight: 700 }}>
              {pendingApps}
            </span>
          </div>
        )}
      </div>

      {/* Drive folders */}
      {driveFolders && driveFolders.length > 0 && (
        <>
          <div className="section" style={{ paddingTop: '1.5rem' }}>
            <h2 className="section-title">Association Documents</h2>
          </div>

          <div className="prow-grid" style={{ marginTop: 0 }}>
            {driveFolders.map(folder => (
              <a
                key={folder.folder_type}
                href={folder.drive_link}
                target="_blank"
                rel="noreferrer"
                className="prow"
              >
                <div className="prow-orb">{folderIconMap[folder.folder_type] ?? '📂'}</div>
                <div className="prow-info">
                  <div className="prow-t">{folder.folder_type}</div>
                  <div className="prow-d">View documents in Google Drive</div>
                </div>
                <div className="prow-btn">Open</div>
              </a>
            ))}
          </div>
        </>
      )}

      {/* Contact PMI */}
      <div className="section" style={{ paddingTop: '1.5rem' }}>
        <h2 className="section-title">Contact Management</h2>
      </div>

      <div className="prow-grid" style={{ marginTop: 0 }}>
        <a href="https://wa.me/17866863223" target="_blank" rel="noreferrer" className="prow">
          <div className="prow-orb">💬</div>
          <div className="prow-info">
            <div className="prow-t">WhatsApp — PMI Top Florida</div>
            <div className="prow-d">Chat with the management team directly</div>
          </div>
          <div className="prow-btn">Chat</div>
        </a>

        <a href="tel:+13059005077" className="prow">
          <div className="prow-orb">📞</div>
          <div className="prow-info">
            <div className="prow-t">Call Us</div>
            <div className="prow-d">305.900.5077 — Monday to Friday, 9am–5pm</div>
          </div>
          <div className="prow-btn">Call</div>
        </a>
      </div>

      {/* Sign out lives in the global UserMenu in SiteHeader. */}
    </main>
  )
}
