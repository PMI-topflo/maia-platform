import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'

export const dynamic = 'force-dynamic'

export default async function UnitManagerPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null

  if (!session || session.persona !== 'unit_manager') redirect('/')

  const { data: mgr } = await supabaseAdmin
    .from('unit_managers')
    .select('id, first_name, last_name, email, phone, association_code, managed_units, company_name')
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
  const units: string[] = mgr.managed_units ?? []

  // Load owner records for the managed units
  const { data: ownerRows } = units.length > 0
    ? await supabaseAdmin
        .from('owners')
        .select('id, account_number, unit_number, first_name, last_name, emails, phone, status, street_number, address')
        .eq('association_code', mgr.association_code)
        .in('unit_number', units)
        .order('unit_number')
    : { data: [] }

  // Load latest applications for managed units
  const { data: applications } = units.length > 0
    ? await supabaseAdmin
        .from('applications')
        .select('id, unit_number, applicant_name, application_type, status, board_approval_status, created_at')
        .eq('association', assocName)
        .in('unit_number', units)
        .order('created_at', { ascending: false })
        .limit(20)
    : { data: [] }

  const displayName = [mgr.first_name, mgr.last_name].filter(Boolean).join(' ')

  return (
    <main className="assoc-page">
      <div className="assoc-topbar">
        <span className="assoc-topbar-l">WHATSAPP &amp; SMS 24/7 · +1 (786) 686-3223 · WE SPEAK ENGLISH, SPANISH, FRENCH &amp; PORTUGUESE</span>
        <span className="assoc-topbar-r">305.900.5077</span>
      </div>

      <SiteHeader subtitle={`UNIT MANAGER PORTAL · ${assocName}`} />

      {/* Manager info */}
      <div className="section">
        <h2 className="section-title">Manager Overview</h2>
      </div>

      <div className="prow-grid" style={{ marginTop: 0 }}>
        <div className="prow" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%' }}>
            <div className="prow-orb">🏢</div>
            <div className="prow-info">
              <div className="prow-t">{displayName}</div>
              <div className="prow-d">
                {mgr.company_name ? `${mgr.company_name} · ` : ''}Unit Manager · {assocName}
              </div>
            </div>
          </div>

          <div style={{ width: '100%', borderTop: '1px solid var(--border)', paddingTop: '0.65rem' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: '0.4rem' }}>
              Managed Units
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {units.length > 0 ? units.map(u => (
                <span key={u} style={{ background: 'var(--orange)', color: '#fff', borderRadius: 4, padding: '0.15rem 0.55rem', fontSize: '0.75rem', fontWeight: 600 }}>
                  Unit {u}
                </span>
              )) : (
                <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>No units assigned yet</span>
              )}
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

      {/* Owners / residents */}
      <div className="section" style={{ paddingTop: '1.5rem' }}>
        <h2 className="section-title">Unit Owners / Residents</h2>
      </div>

      <div className="prow-grid" style={{ marginTop: 0 }}>
        {ownerRows && ownerRows.length > 0 ? ownerRows.map(owner => (
          <div key={owner.id} className="prow" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%' }}>
              <div className="prow-orb">🏠</div>
              <div className="prow-info">
                <div className="prow-t">Unit {owner.unit_number} — {[owner.first_name, owner.last_name].filter(Boolean).join(' ') || 'Unknown'}</div>
                <div className="prow-d">
                  {[owner.street_number, owner.address].filter(Boolean).join(' ')}
                  {owner.account_number ? ` · Acct ${owner.account_number}` : ''}
                  {owner.status === 'previous' ? ' · (Previous)' : ''}
                </div>
              </div>
            </div>
            {(owner.emails || owner.phone) && (
              <div style={{ paddingLeft: '3.25rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {owner.emails && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--navy)' }}>✉ {owner.emails}</div>
                )}
                {owner.phone && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--navy)' }}>📞 {owner.phone}</div>
                )}
              </div>
            )}
          </div>
        )) : (
          <div className="prow" style={{ cursor: 'default' }}>
            <div className="prow-info">
              <div className="prow-d">No owners found for the assigned units.</div>
            </div>
          </div>
        )}
      </div>

      {/* Applications */}
      {applications && applications.length > 0 && (
        <>
          <div className="section" style={{ paddingTop: '1.5rem' }}>
            <h2 className="section-title">Applications — Managed Units</h2>
          </div>

          <div className="prow-grid" style={{ marginTop: 0 }}>
            {applications.map(app => {
              const statusColor =
                app.board_approval_status === 'approved' ? '#16a34a'
                : app.board_approval_status === 'rejected' ? '#dc2626'
                : '#f26a1b'
              return (
                <div key={app.id} className="prow" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'flex-start', gap: '0.35rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%' }}>
                    <div className="prow-orb">📋</div>
                    <div className="prow-info">
                      <div className="prow-t">{app.applicant_name || 'Applicant'} — Unit {app.unit_number}</div>
                      <div className="prow-d">{app.application_type ?? 'Application'}</div>
                    </div>
                    <span style={{ marginLeft: 'auto', fontSize: '0.7rem', fontWeight: 600, color: statusColor, background: `${statusColor}18`, borderRadius: 4, padding: '0.15rem 0.5rem', whiteSpace: 'nowrap' }}>
                      {(app.board_approval_status ?? app.status ?? 'pending').replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </div>
                  <div style={{ paddingLeft: '3.25rem', fontSize: '0.72rem', color: 'var(--muted)' }}>
                    {new Date(app.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
              )
            })}
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

        {assocRow?.public_website_url && (
          <a href={assocRow.public_website_url} target="_blank" rel="noreferrer" className="prow">
            <div className="prow-orb">🌐</div>
            <div className="prow-info">
              <div className="prow-t">Association Website</div>
              <div className="prow-d">{assocName} community portal</div>
            </div>
            <div className="prow-btn">Visit</div>
          </a>
        )}
      </div>

      {/* Sign out lives in the global UserMenu in SiteHeader. */}
    </main>
  )
}
