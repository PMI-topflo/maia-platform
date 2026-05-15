// =====================================================================
// app/tenant/page.tsx
// HOA-tenant portal (tenants_hoa — data lives in `association_tenants`).
// Residential tenants from RENTVINE will get their own portal later;
// this one is for tenants registered against an association.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'

export const dynamic = 'force-dynamic'

interface TenantRow {
  id:                string
  first_name:        string | null
  last_name:         string | null
  email:             string | null
  phone:             string | null
  association_code:  string
  association_name:  string | null
  unit_number:       string | null
  status:            string | null
  lease_start_date:  string | null
  lease_end_date:    string | null
}

function statusBadge(status: string | null): { label: string; bg: string; color: string } {
  switch ((status ?? '').toLowerCase()) {
    case 'active':   return { label: 'Active lease',  bg: '#dcfce7', color: '#15803d' }
    case 'previous': return { label: 'Previous tenant', bg: '#e5e7eb', color: '#374151' }
    case 'expired':  return { label: 'Lease expired',   bg: '#fee2e2', color: '#b91c1c' }
    default:         return { label: status ?? 'Unknown', bg: '#fef9c3', color: '#a16207' }
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  return Math.ceil(ms / 86_400_000)
}

export default async function TenantPortalPage() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'tenant') redirect('/')

  // Resolve the tenant record by login email + association code.
  const loginEmail = typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : ''
  const assocCode  = (session.associationCode || '').toUpperCase()

  if (!loginEmail || !assocCode) redirect('/')

  // Pick the most recently-active lease record for this tenant + association.
  const { data: tenantRows } = await supabaseAdmin
    .from('association_tenants')
    .select('id, first_name, last_name, email, phone, association_code, association_name, unit_number, status, lease_start_date, lease_end_date')
    .eq('association_code', assocCode)
    .ilike('email', loginEmail)
    .order('lease_start_date', { ascending: false })
    .limit(1)

  const tenant = (tenantRows?.[0] ?? null) as TenantRow | null
  if (!tenant) redirect('/')

  // Association metadata for the address + portal link.
  const { data: assocRow } = await supabaseAdmin
    .from('associations')
    .select('association_name, address, city, state, zip_code')
    .eq('association_code', assocCode)
    .maybeSingle()

  const assocName     = tenant.association_name || assocRow?.association_name || assocCode
  const assocSlug     = assocCode.toLowerCase()
  const buildingAddr  = [assocRow?.address, assocRow?.city, assocRow?.state, assocRow?.zip_code].filter(Boolean).join(', ')

  // Document folders (Rules / FAQ / Welcome — anything the association published).
  // Building-manager portal hardcodes a longer list; tenants get the resident-relevant subset.
  const TENANT_FOLDER_TYPES = ['Rules & Regulations', 'FAQ', 'Welcome Letters', 'Maintenance']
  const { data: driveFolders } = await supabaseAdmin
    .from('association_drive_folders')
    .select('folder_type, drive_link')
    .eq('association_code', assocCode)
    .eq('active', true)
    .in('folder_type', TENANT_FOLDER_TYPES)
    .order('folder_type')

  const displayName  = [tenant.first_name, tenant.last_name].filter(Boolean).join(' ') || 'Tenant'
  const badge        = statusBadge(tenant.status)
  const daysLeft     = daysUntil(tenant.lease_end_date)
  const daysLeftText =
    daysLeft === null ? '—' :
    daysLeft <  0     ? `Expired ${Math.abs(daysLeft)}d ago` :
    daysLeft === 0    ? 'Ends today' :
    `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
  const daysLeftTone =
    daysLeft === null ? 'var(--muted)' :
    daysLeft <  0     ? '#b91c1c' :
    daysLeft <= 30    ? '#a16207' :
    'var(--navy)'

  const folderIconMap: Record<string, string> = {
    'Rules & Regulations': '📋',
    'Maintenance':         '🔧',
    'Welcome Letters':     '✉️',
    'FAQ':                 '❓',
  }

  return (
    <main className="assoc-page">
      <div className="assoc-topbar">
        <span className="assoc-topbar-l">WHATSAPP &amp; SMS 24/7 · +1 (786) 686-3223 · WE SPEAK ENGLISH, SPANISH, FRENCH &amp; PORTUGUESE</span>
        <span className="assoc-topbar-r">305.900.5077</span>
      </div>

      <SiteHeader subtitle={`TENANT PORTAL · ${assocName}`} />

      {/* Lease card */}
      <div className="section">
        <h2 className="section-title">My Lease</h2>
      </div>

      <div className="prow-grid" style={{ marginTop: 0 }}>
        <div className="prow" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%' }}>
            <div className="prow-orb">🏘</div>
            <div className="prow-info">
              <div className="prow-t">{displayName}</div>
              <div className="prow-d">
                Unit {tenant.unit_number ?? '—'} · {assocName}
              </div>
            </div>
            <span style={{ marginLeft: 'auto', background: badge.bg, color: badge.color, borderRadius: 9999, padding: '0.15rem 0.7rem', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {badge.label}
            </span>
          </div>

          {/* Lease dates */}
          <div style={{ width: '100%', borderTop: '1px solid var(--border)', paddingTop: '0.65rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>Start</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--navy)', marginTop: 2 }}>{fmtDate(tenant.lease_start_date)}</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>End</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--navy)', marginTop: 2 }}>{fmtDate(tenant.lease_end_date)}</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>Time remaining</div>
              <div style={{ fontSize: '0.85rem', color: daysLeftTone, marginTop: 2, fontWeight: daysLeft !== null && daysLeft <= 30 ? 600 : 400 }}>{daysLeftText}</div>
            </div>
          </div>

          {/* Address */}
          {buildingAddr && (
            <div style={{ width: '100%', borderTop: '1px solid var(--border)', paddingTop: '0.65rem' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: '0.2rem' }}>Building address</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--navy)' }}>{buildingAddr}</div>
            </div>
          )}

          {/* Contact info — read-only for now; edit lands in a follow-up */}
          {(tenant.email || tenant.phone) && (
            <div style={{ width: '100%', borderTop: '1px solid var(--border)', paddingTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: '0.2rem' }}>
                Contact on file
              </div>
              {tenant.email && (
                <div style={{ fontSize: '0.8rem', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>✉</span> {tenant.email}
                </div>
              )}
              {tenant.phone && (
                <div style={{ fontSize: '0.8rem', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>📞</span> {tenant.phone}
                </div>
              )}
              <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                Need to update? Email <a href="mailto:pmi@pmitop.com" style={{ color: 'var(--orange)' }}>pmi@pmitop.com</a> — in-place editing is coming soon.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="section" style={{ paddingTop: '1.5rem' }}>
        <h2 className="section-title">Quick Actions</h2>
      </div>

      <div className="prow-grid" style={{ marginTop: 0 }}>
        <Link href="/tenant/maintenance" className="prow">
          <div className="prow-orb">🔧</div>
          <div className="prow-info">
            <div className="prow-t">Report a maintenance issue</div>
            <div className="prow-d">Create a ticket for the management team to dispatch</div>
          </div>
          <div className="prow-btn">Start</div>
        </Link>

        <a href={`/${assocSlug}`} className="prow">
          <div className="prow-orb">📋</div>
          <div className="prow-info">
            <div className="prow-t">Building rules &amp; ARC</div>
            <div className="prow-d">View the {assocName} resident portal</div>
          </div>
          <div className="prow-btn">Open</div>
        </a>

        <a href="https://wa.me/17866863223" target="_blank" rel="noreferrer" className="prow">
          <div className="prow-orb">💬</div>
          <div className="prow-info">
            <div className="prow-t">WhatsApp the management team</div>
            <div className="prow-d">Reach PMI directly via WhatsApp / SMS 24/7</div>
          </div>
          <div className="prow-btn">Chat</div>
        </a>
      </div>

      {/* Document folders */}
      {driveFolders && driveFolders.length > 0 && (
        <>
          <div className="section" style={{ paddingTop: '1.5rem' }}>
            <h2 className="section-title">Resident Documents</h2>
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
                  <div className="prow-d">View in Google Drive</div>
                </div>
                <div className="prow-btn">Open</div>
              </a>
            ))}
          </div>
        </>
      )}

      {/* MAIA chat widget */}
      <div className="section" style={{ paddingTop: '1.5rem' }}>
        <h2 className="section-title">Ask MAIA</h2>
      </div>
      <div style={{ padding: '0 1rem 2rem' }}>
        <iframe
          src="/widget"
          title="MAIA"
          style={{ width: '100%', height: 520, border: '1px solid var(--border)', borderRadius: 8, background: '#0d0d0d' }}
        />
      </div>
    </main>
  )
}
