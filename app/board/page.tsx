import { redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'

export default async function BoardPage(props: {
  searchParams: Promise<{ id?: string; assoc?: string }>
}) {
  const { id, assoc } = await props.searchParams

  if (!id || !assoc) redirect('/')

  const { data: member } = await supabaseAdmin
    .from('board_members')
    .select('id, first_name, last_name, email, phone, position, association_code')
    .eq('id', id)
    .eq('association_code', assoc.toUpperCase())
    .eq('active', true)
    .single()

  if (!member) redirect('/')

  const { data: assocRow } = await supabaseAdmin
    .from('associations')
    .select('association_name, public_website_url')
    .eq('association_code', assoc.toUpperCase())
    .single()

  const assocName = assocRow?.association_name ?? assoc.toUpperCase()
  const assocCode = assoc.toLowerCase()

  const { data: driveFolders } = await supabaseAdmin
    .from('association_drive_folders')
    .select('folder_type, drive_link')
    .eq('association_code', assoc.toUpperCase())
    .eq('active', true)
    .order('folder_type')

  const { count: pendingApps } = await supabaseAdmin
    .from('applications')
    .select('id', { count: 'exact', head: true })
    .eq('association', assocName)
    .eq('board_approval_status', 'pending')

  const displayName = [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Board Member'

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

      <SiteHeader subtitle={`BOARD PORTAL · ${assocName}`} />

      {/* Member info */}
      <div className="section">
        <h2 className="section-title">Board Member Overview</h2>
      </div>

      <div className="prow-grid" style={{ marginTop: 0 }}>
        <div className="prow" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%' }}>
            <div className="prow-orb">👥</div>
            <div className="prow-info">
              <div className="prow-t">{displayName}</div>
              <div className="prow-d">
                {member.position ?? 'Board Member'} · {assocName}
              </div>
            </div>
          </div>

          {(member.email || member.phone) && (
            <div style={{ width: '100%', borderTop: '1px solid var(--border)', paddingTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: '0.2rem' }}>
                Contact on file
              </div>
              {member.email && (
                <div style={{ fontSize: '0.8rem', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>✉</span> {member.email}
                </div>
              )}
              {member.phone && (
                <div style={{ fontSize: '0.8rem', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>📞</span> {member.phone}
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

        <a
          href="https://pmitfp.cincwebaxis.com/"
          target="_blank"
          rel="noreferrer"
          className="prow"
        >
          <div className="prow-orb">🏦</div>
          <div className="prow-info">
            <div className="prow-t">CINC Portal — Financials &amp; Invoices</div>
            <div className="prow-d">Review invoices, approve payments, view financial reports</div>
          </div>
          <div className="prow-btn">Open</div>
        </a>

        {(pendingApps ?? 0) > 0 ? (
          <a
            href={`/admin`}
            className="prow"
          >
            <div className="prow-orb" style={{ position: 'relative' }}>
              📋
              <span style={{ position: 'absolute', top: -4, right: -4, background: 'var(--gold)', color: '#fff', borderRadius: '999px', fontSize: '0.55rem', fontFamily: 'var(--font-mono)', padding: '1px 5px', lineHeight: 1.4 }}>
                {pendingApps}
              </span>
            </div>
            <div className="prow-info">
              <div className="prow-t">Pending Applications</div>
              <div className="prow-d">{pendingApps} application{pendingApps === 1 ? '' : 's'} awaiting board approval</div>
            </div>
            <div className="prow-btn">Review</div>
          </a>
        ) : (
          <div className="prow" style={{ cursor: 'default', opacity: 0.5 }}>
            <div className="prow-orb">📋</div>
            <div className="prow-info">
              <div className="prow-t">Pending Applications</div>
              <div className="prow-d">No applications pending approval</div>
            </div>
          </div>
        )}

        <a
          href={`/${assocCode}`}
          className="prow"
        >
          <div className="prow-orb">🏢</div>
          <div className="prow-info">
            <div className="prow-t">Association Page</div>
            <div className="prow-d">{assocName}</div>
          </div>
          <div className="prow-btn">View</div>
        </a>

        <a
          href="mailto:service@topfloridaproperties.com"
          className="prow"
        >
          <div className="prow-orb">✉️</div>
          <div className="prow-info">
            <div className="prow-t">Contact Management</div>
            <div className="prow-d">service@topfloridaproperties.com · (305) 900-5077</div>
          </div>
          <div className="prow-btn">Email</div>
        </a>

      </div>

      {/* Drive documents */}
      {driveFolders && driveFolders.length > 0 && (
        <>
          <div className="sh" style={{ marginTop: '1.5rem' }}>
            <div className="sh-orb">📁</div>
            <div className="sh-t">Association Documents</div>
            <div className="sh-s">Shared drive folders for {assocName}</div>
            <div className="sh-line" />
          </div>

          <div className="dcard-grid">
            {driveFolders.map(folder => (
              <a
                key={folder.folder_type}
                href={folder.drive_link}
                target="_blank"
                rel="noreferrer"
                className="dcard"
              >
                <div className="dcard-icon">{folderIconMap[folder.folder_type] ?? '📄'}</div>
                <div className="dcard-name">{folder.folder_type}</div>
              </a>
            ))}
          </div>
        </>
      )}

      {/* Coming soon section */}
      <div className="sh" style={{ marginTop: '1.5rem' }}>
        <div className="sh-orb">🚧</div>
        <div className="sh-t">Coming Soon</div>
        <div className="sh-s">Features in development — contact PMI in the meantime</div>
        <div className="sh-line" />
      </div>

      <div className="prow-grid">
        <div className="prow" style={{ cursor: 'default', opacity: 0.55 }}>
          <div className="prow-orb">🗳️</div>
          <div className="prow-info">
            <div className="prow-t">Board Voting &amp; Resolutions</div>
            <div className="prow-d">Digital voting on resolutions and agenda items</div>
          </div>
          <div className="prow-btn" style={{ background: 'var(--muted)' }}>Soon</div>
        </div>

        <div className="prow" style={{ cursor: 'default', opacity: 0.55 }}>
          <div className="prow-orb">📊</div>
          <div className="prow-info">
            <div className="prow-t">Budget &amp; Reserve Reports</div>
            <div className="prow-d">Interactive financials and reserve fund analysis</div>
          </div>
          <div className="prow-btn" style={{ background: 'var(--muted)' }}>Soon</div>
        </div>

        <div className="prow" style={{ cursor: 'default', opacity: 0.55 }}>
          <div className="prow-orb">🔔</div>
          <div className="prow-info">
            <div className="prow-t">Board Notifications</div>
            <div className="prow-d">Alerts for new applications, payments, and maintenance</div>
          </div>
          <div className="prow-btn" style={{ background: 'var(--muted)' }}>Soon</div>
        </div>
      </div>

      {/* Contact */}
      <div className="sh" style={{ marginTop: '1.5rem' }}>
        <div className="sh-orb">📞</div>
        <div className="sh-t">Contact PMI Top Florida Properties</div>
        <div className="sh-s">Monday&ndash;Thursday 10AM&ndash;5PM · Friday 10AM&ndash;3PM</div>
        <div className="sh-line" />
      </div>

      <div className="contact-grid">
        <div className="contact-card">
          <div className="contact-icon">💰</div>
          <div className="contact-label">Accounts Receivable</div>
          <a href="mailto:ar@topfloridaproperties.com" className="contact-link">ar@topfloridaproperties.com</a>
          <a href="tel:3059005105" className="contact-phone">(305) 900-5105</a>
        </div>
        <div className="contact-card">
          <div className="contact-icon">🔧</div>
          <div className="contact-label">Maintenance &amp; Service</div>
          <a href="mailto:service@topfloridaproperties.com" className="contact-link">service@topfloridaproperties.com</a>
          <a href="tel:3059005077" className="contact-phone">(305) 900-5077</a><a href="https://wa.me/17866863223" target="_blank" rel="noreferrer" className="contact-phone" style={{color:"#25d366"}}>💬 (786) 686-3223</a>
        </div>
        <div className="contact-card">
          <div className="contact-icon">⚖️</div>
          <div className="contact-label">Compliance &amp; Support</div>
          <a href="mailto:support@topfloridaproperties.com" className="contact-link">support@topfloridaproperties.com</a>
        </div>
        <div className="contact-card">
          <div className="contact-icon">🧾</div>
          <div className="contact-label">Vendor Billing</div>
          <a href="mailto:billing@topfloridaproperties.com" className="contact-link">billing@topfloridaproperties.com</a>
        </div>
      </div>

    </main>
  )
}
