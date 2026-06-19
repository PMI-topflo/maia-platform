// =====================================================================
// components/AssociationPortal.tsx
//
// The ONE shared resident-portal body. Every /[association] route is a
// 4-line shell that renders <AssociationPortal code="…" />. Collapses 25
// near-identical 280-line pages into a single source of truth.
//
// Layout (consistent with the rest of the app):
//   • assoc-topbar (WhatsApp/SMS banner)
//   • SiteHeader (brand + account menu)
//   • Association identity hero — name + type + address, so a resident AND
//     the public immediately know which association they're on (this was
//     missing before — SiteHeader's subtitle is no longer rendered).
//   • AssociationPortalGate — public sees the identify/login card; once in,
//     owners/board/tenant see the body below.
//   • Body: Quick Actions FIRST (Pay HOA, Mobile App, Estoppel*, Application*)
//     → Documents → Forms & Downloads → Contact.  (*toggled per association.)
//
// The staff-flavored "Communications & Tickets" stats widget was removed
// from the owner view — staff have that on the admin hub.
// =====================================================================

import SiteHeader from '@/components/SiteHeader'
import AssociationPortalGate from '@/components/AssociationPortalGate'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { portalConfig } from '@/lib/association-portal-config'

const TYPE_LABEL: Record<string, string> = {
  condo: 'Condominium', hoa: 'HOA', coop: 'Co-op', 'co-op': 'Co-op', commercial: 'Commercial',
  master_hoa: 'Master HOA',
}
// Friendly label for an association_type; prettify unknown values (master_hoa → "Master HOA").
const prettyType = (t: string) => TYPE_LABEL[t.toLowerCase()] ?? t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const DOC_CARDS = [
  { icon: '📋', name: 'Rules & Regulations' }, { icon: '📝', name: 'Tenant Applications' },
  { icon: '💰', name: 'Financials' }, { icon: '🔧', name: 'Maintenance' },
  { icon: '📅', name: 'Board Minutes' }, { icon: '🏠', name: 'Leases & Resale' },
  { icon: '📁', name: 'Condo Docs' }, { icon: '🛡️', name: 'Insurance Files' },
  { icon: '🏦', name: 'ACH Forms' }, { icon: '✉️', name: 'Welcome Letters' },
  { icon: '📊', name: 'Budget' }, { icon: '❓', name: 'FAQ' }, { icon: '⚠️', name: 'Violations' },
]

export default async function AssociationPortal({ code }: { code: string }) {
  const upper = code.toUpperCase()
  const { data: row } = await supabaseAdmin
    .from('associations')
    .select('association_name, association_type, florida_statute, principal_address, city, state')
    .eq('association_code', upper)
    .maybeSingle()

  const name = (row?.association_name as string | null) ?? upper
  const type = row?.association_type ? prettyType(String(row.association_type)) : null
  const statute = (row?.florida_statute as string | null) ?? null
  const address = [row?.principal_address, row?.city, row?.state].filter(Boolean).join(', ') || null
  const cfg = portalConfig(upper)

  return (
    <main className="assoc-page">
      <div className="assoc-topbar">
        <span className="assoc-topbar-l">WHATSAPP &amp; SMS 24/7 · +1 (786) 686-3223 · WE SPEAK ENGLISH, SPANISH, FRENCH &amp; PORTUGUESE</span>
        <span className="assoc-topbar-r">305.900.5077</span>
      </div>

      <SiteHeader subtitle={`ASSOCIATION PORTAL · ${name}`} />

      {/* Association identity — visible to the public BEFORE login so a
          resident knows exactly which association portal they're on. */}
      <div className="assoc-hero">
        <div className="assoc-hero-inner">
          <span className="assoc-logo" aria-hidden />
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 400, lineHeight: 1.15 }}>{name}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.85, marginTop: '0.35rem' }}>
              Resident Portal{type ? ` · ${type}` : ''}{statute ? ` · ${statute}` : ''}
            </div>
            {address && <div style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: '0.2rem' }}>{address}</div>}
          </div>
        </div>
      </div>

      <AssociationPortalGate assocCode={upper} assocName={name}>

        {/* Quick Actions — first thing an owner sees after login. */}
        <section className="section">
          <h2 className="section-title">Quick Actions</h2>
          <div className="prow-grid">
            <a href="https://pmitfp.cincwebaxis.com/" target="_blank" rel="noreferrer" className="prow">
              <div className="prow-orb">💳</div>
              <div className="prow-info">
                <div className="prow-t">Pay HOA Fees</div>
                <div className="prow-d">Access your balance, make payments, set up ACH autopay</div>
              </div>
              <div className="prow-btn">Open Portal</div>
            </a>

            <a href="https://pmitfp.cincwebaxis.com/" target="_blank" rel="noreferrer" className="prow">
              <div className="prow-orb">🏦</div>
              <div className="prow-info">
                <div className="prow-t">PMI Mobile App</div>
                <div className="prow-d">Pay fees &middot; Approve invoices &middot; Manage your account on the go</div>
              </div>
              <div className="prow-btn">Download</div>
            </a>

            {!cfg.hideEstoppel && (
              <a href="https://secure.condocerts.com/resale/" target="_blank" rel="noreferrer" className="prow">
                <div className="prow-orb">🖨️</div>
                <div className="prow-info">
                  <div className="prow-t">Estoppel Request &ndash; Condocerts</div>
                  <div className="prow-d">Required for property sale or refinancing &middot; 5&ndash;7 business days</div>
                </div>
                <div className="prow-btn">Submit</div>
              </a>
            )}

            {!cfg.hideApplication && (
              <a href="https://pmitopfloridaproperties.rentvine.com/public/apply" target="_blank" rel="noreferrer" className="prow">
                <div className="prow-orb">🏠</div>
                <div className="prow-info">
                  <div className="prow-t">Tenant / Buyer Application</div>
                  <div className="prow-d">Board approval required &middot; Background and credit check included</div>
                </div>
                <div className="prow-btn">Apply Now</div>
              </a>
            )}
          </div>
        </section>

        {/* Documents */}
        <section className="section">
          <div className="dcard-name">Association Documents</div>
          <div className="dcard-tag">Open Folder</div>
          <div className="dcard-grid">
            {DOC_CARDS.map(d => (
              <a key={d.name} href={cfg.docsFolder} target="_blank" rel="noreferrer" className="dcard">
                <div className="dcard-icon">{d.icon}</div>
                <div className="dcard-name">{d.name}</div>
              </a>
            ))}
          </div>
        </section>

        {/* Forms & Downloads */}
        <div className="sh">
          <div className="sh-orb">📥</div>
          <div className="sh-t">Forms &amp; Downloads</div>
          <div className="sh-s">Official PMI forms &ndash; valid for all associations</div>
          <div className="sh-line" />
        </div>

        <div className="prow-grid">
          <a href="https://drive.google.com/uc?export=download&id=1PDg2ffZurrHZ_BL704IKtOdyziMunYMt" download className="prow">
            <div className="prow-orb">📄</div>
            <div className="prow-info">
              <div className="prow-t">ACH Authorization Form</div>
              <div className="prow-d">Set up automatic HOA fee payments &middot; FREE &middot; Processed on the 10th</div>
            </div>
            <div className="prow-btn">Download</div>
          </a>

          <a href={cfg.docsFolder} target="_blank" rel="noreferrer" className="prow">
            <div className="prow-orb">📋</div>
            <div className="prow-info">
              <div className="prow-t">ARC Request Form</div>
              <div className="prow-d">Required for any exterior modification &middot; Must be approved before work begins</div>
            </div>
            <div className="prow-btn">Open</div>
          </a>

          <a href="https://drive.google.com/uc?export=download&id=1PDg2ffZurrHZ_BL704IKtOdyziMunYMt" download className="prow">
            <div className="prow-orb">🏢</div>
            <div className="prow-info">
              <div className="prow-t">Vendor ACH Form</div>
              <div className="prow-d">For vendors receiving payments electronically &middot; Send to billing@topfloridaproperties.com</div>
            </div>
            <div className="prow-btn">Download</div>
          </a>
        </div>

        {/* Contact */}
        <div className="sh">
          <div className="sh-orb">📞</div>
          <div className="sh-t">Contact PMI Top Florida Properties</div>
          <div className="sh-s">Monday&ndash;Thursday 10AM&ndash;5PM &middot; Friday 10AM&ndash;3PM</div>
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
            <a href="tel:3059005077" className="contact-phone">(305) 900-5077</a><a href="https://wa.me/17866863223" target="_blank" rel="noreferrer" className="contact-phone" style={{ color: '#25d366' }}>💬 (786) 686-3223</a>
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

      </AssociationPortalGate>
    </main>
  )
}
