import { redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'

export default async function MyAccountPage(props: {
  searchParams: Promise<{ id?: string; assoc?: string }>
}) {
  const { id, assoc } = await props.searchParams

  // Guard — must have both params
  if (!id || !assoc) redirect('/')

  // Verify owner exists with matching id + association_code (server-side only)
  const { data: owner } = await supabaseAdmin
    .from('owners')
    .select(
      'first_name, last_name, unit_number, emails, phone, phone_2, association_name, association_code, address, city, state, zip_code, account_number'
    )
    .eq('id', id)
    .eq('association_code', assoc.toUpperCase())
    .single()

  if (!owner) redirect('/')

  const displayName = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || 'Unit Owner'
  const assocCode   = owner.association_code.toLowerCase()

  // Parse emails field (may be comma-separated or single)
  const emails = (owner.emails ?? '')
    .split(/[,;]/)
    .map((e: string) => e.trim())
    .filter(Boolean)

  const phones = [owner.phone, owner.phone_2].filter(Boolean)

  const fullAddress = [owner.address, owner.city, owner.state, owner.zip_code]
    .filter(Boolean)
    .join(', ')

  return (
    <main className="assoc-page">

      {/* Top bar */}
      <div className="assoc-topbar">
        <span className="assoc-topbar-l">WHATSAPP &amp; SMS 24/7 · +1 (786) 686-3223 · WE SPEAK ENGLISH, SPANISH, FRENCH &amp; PORTUGUESE</span>
        <span className="assoc-topbar-r">305.900.5077</span>
      </div>

      <SiteHeader subtitle={`MY ACCOUNT · ${owner.association_name}`} />

      {/* Account summary */}
      <div className="section">
        <h2 className="section-title">Account Overview</h2>
      </div>

      <div className="prow-grid" style={{ marginTop: 0 }}>

        <div className="prow" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%' }}>
            <div className="prow-orb">👤</div>
            <div className="prow-info">
              <div className="prow-t">{displayName}</div>
              <div className="prow-d">Unit {owner.unit_number ?? '—'}{owner.account_number ? ` · Account ${owner.account_number}` : ''}</div>
            </div>
          </div>

          {/* Contact info on file */}
          <div style={{ width: '100%', borderTop: '1px solid var(--border)', paddingTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: '0.2rem' }}>
              Contact info on file
            </div>
            {emails.map((e: string) => (
              <div key={e} style={{ fontSize: '0.8rem', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>✉</span> {e}
              </div>
            ))}
            {phones.map((p: string) => (
              <div key={p} style={{ fontSize: '0.8rem', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>📞</span> {p}
              </div>
            ))}
            {fullAddress && (
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.1rem' }}>
                {fullAddress}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Quick Actions */}
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
          <div className="prow-orb">💳</div>
          <div className="prow-info">
            <div className="prow-t">Pay HOA Fees</div>
            <div className="prow-d">View balance, make payments, set up ACH autopay</div>
          </div>
          <div className="prow-btn">Open Portal</div>
        </a>

        <a
          href="https://pmitfp.cincwebaxis.com/"
          target="_blank"
          rel="noreferrer"
          className="prow"
        >
          <div className="prow-orb">🔧</div>
          <div className="prow-info">
            <div className="prow-t">Submit Maintenance Request</div>
            <div className="prow-d">Report issues · Track work orders · Upload photos</div>
          </div>
          <div className="prow-btn">Submit</div>
        </a>

        <a
          href={`/${assocCode}`}
          className="prow"
        >
          <div className="prow-orb">🏢</div>
          <div className="prow-info">
            <div className="prow-t">Association Page</div>
            <div className="prow-d">{owner.association_name}</div>
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

      {/* HOA balance note */}
      <div className="section" style={{ paddingTop: '1.25rem', paddingBottom: '2rem' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted)', lineHeight: 1.6 }}>
          For your current HOA balance and payment history, log in to the{' '}
          <a href="https://pmitfp.cincwebaxis.com/" target="_blank" rel="noreferrer" style={{ color: 'var(--gold)', textDecoration: 'none' }}>
            CincWebAxis owner portal
          </a>
          . For billing questions, contact{' '}
          <a href="mailto:billing@topfloridaproperties.com" style={{ color: 'var(--gold)', textDecoration: 'none' }}>
            billing@topfloridaproperties.com
          </a>
          .
        </p>
      </div>

    </main>
  )
}
