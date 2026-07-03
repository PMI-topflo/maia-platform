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

import { cookies } from 'next/headers'
import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import AssociationPortalGate from '@/components/AssociationPortalGate'
import PortalDocuments from '@/components/PortalDocuments'
import MobileAppButton from '@/components/MobileAppButton'
import ContactTickets from '@/components/ContactTickets'
import AskMaiaButton from '@/components/AskMaiaButton'
import ApplicationButton from '@/components/ApplicationButton'
import FinancialsAccessButton from '@/components/FinancialsAccessButton'
import PortalLangBar from '@/components/PortalLangBar'
import { normalizePortalLang, portalStrings, isRtl } from '@/lib/portal-i18n'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { portalConfig } from '@/lib/association-portal-config'
import { signAchToken } from '@/lib/owner-portal-token'
import { isAccountInCollections } from '@/lib/owner-ledger-flow'
import LedgerRequestButton from '@/components/LedgerRequestButton'

const TYPE_LABEL: Record<string, string> = {
  condo: 'Condominium', hoa: 'HOA', coop: 'Co-op', 'co-op': 'Co-op', commercial: 'Commercial',
  master_hoa: 'Master HOA',
}
// Friendly label for an association_type; prettify unknown values (master_hoa → "Master HOA").
const prettyType = (t: string) => TYPE_LABEL[t.toLowerCase()] ?? t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export default async function AssociationPortal({ code, lang }: { code: string; lang?: string }) {
  const upper = code.toUpperCase()

  // The page itself is public — the board wants the general public to read an
  // association's PUBLIC documents without identifying. The identity hero +
  // public-document list are visible to everyone; the login gate below still
  // protects all resident-only features (balances, full documents, requests).
  // Resident data is rendered as children of the client-side gate, which only
  // mounts them after a verified session — so nothing private is in the public
  // HTML. Public documents come from a separate is_public-only endpoint.
  const sessTok = (await cookies()).get(SESSION_COOKIE)?.value
  const sess = sessTok ? await verifySession(sessTok) : null
  const allowed = sess?.persona === 'staff' || (sess?.associationCode ?? '').toUpperCase() === upper
  // Show the public-docs section to anyone who won't already see the full
  // gated list (the public + wrong-association visitors), plus staff for QA.
  const showPublicDocs = !allowed || sess?.persona === 'staff'

  // Default to the resident's saved language preference (a ?lang= URL param —
  // e.g. from the in-page language picker — still overrides it).
  let effectiveLang = lang
  if (!effectiveLang && sess && sess.persona !== 'staff' && sess.userId != null) {
    const { data: pref } = await supabaseAdmin
      .from('resident_language_prefs')
      .select('lang')
      .eq('persona', sess.persona)
      .eq('persona_record_id', String(sess.userId))
      .maybeSingle()
    if (pref?.lang) effectiveLang = pref.lang
  }

  const L = normalizePortalLang(effectiveLang)
  const t = portalStrings(L)
  const rtl = isRtl(L)
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

  // Owners get the new in-MAIA "Set up autopay (ACH)" link (replaces the old
  // Google-Drive ACH form) — a secure per-account token to the online form.
  // Also check the SAME collections gate voice/text already enforce — a
  // blocked owner must not be sent to WebAxis to pay; assessments go through
  // the collection agency instead.
  let achHref: string | null = null
  let ownerAccount: string | null = null
  let inCollections = false
  if (sess?.persona === 'owner' && sess.userId != null) {
    const { data: ow } = await supabaseAdmin
      .from('owners').select('account_number').eq('id', sess.userId).maybeSingle()
    if (ow?.account_number) {
      ownerAccount = String(ow.account_number)
      achHref = `/owner/ach/${await signAchToken(upper, ownerAccount)}`
      inCollections = await isAccountInCollections(upper, ownerAccount)
    }
  }

  return (
    <main className="assoc-page" dir={rtl ? 'rtl' : 'ltr'}>
      <div className="assoc-topbar">
        <span className="assoc-topbar-l">💬 CHAT WITH MAIA 24/7 · WE SPEAK ENGLISH, SPANISH, PORTUGUESE, FRENCH, CREOLE, HEBREW &amp; RUSSIAN</span>
        <AskMaiaButton label="ASK MAIA →" className="assoc-topbar-r" />
      </div>

      <SiteHeader subtitle={`${t.headerSubtitle.toUpperCase()} · ${name}`} />

      {/* Association identity — visible to the public BEFORE login so a
          resident knows exactly which association portal they're on. */}
      <div className="assoc-hero">
        <div className="assoc-hero-inner">
          <span className="assoc-logo" aria-hidden />
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 400, lineHeight: 1.15 }}>{name}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.85, marginTop: '0.35rem' }}>
              {t.siteLabel}{type ? ` · ${type}` : ''}{statute ? ` · ${statute}` : ''}
            </div>
            {address && <div style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: '0.2rem' }}>{address}</div>}
          </div>
          <div style={{ marginInlineStart: 'auto' }}>
            <PortalLangBar current={L} label={t.langLabel} />
          </div>
        </div>
      </div>

      {/* The gate renders the PUBLIC top row (intro on the left, optional
          resident login on the right) for visitors, or the resident body for a
          logged-in resident. Public sections (actions, docs, contact) follow
          below for everyone who isn't a logged-in resident of this association. */}
      <AssociationPortalGate
        assocCode={upper}
        assocName={name}
        lang={L}
        publicHeader={
          <>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', maxWidth: '52ch' }}>{t.publicIntro}</p>
            <p style={{ color: 'var(--muted)', fontSize: '0.82rem', maxWidth: '52ch', marginTop: '0.4rem', opacity: 0.85 }}>🔒 {t.publicMoreInfo}</p>
          </>
        }
      >

        {/* Quick Actions — first thing an owner sees after login. */}
        <section className="section">
          <h2 className="section-title">{t.quickActions}</h2>

          {inCollections && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '1rem 1.1rem', marginBottom: '1rem', fontSize: '0.88rem', color: '#7f1d1d', lineHeight: 1.6 }}>
              Your account is currently with our collection agency, so payments and account statements aren&rsquo;t available here. Please contact them directly:
              <br />📞 (800) 875-9221 &nbsp;·&nbsp; ✉️ info@schwartzvays.com &nbsp;·&nbsp; 🌐 schwartzvays.com
            </div>
          )}

          <div className="prow-grid">
            {!inCollections && (
              <a href="https://pmitfp.cincwebaxis.com/" target="_blank" rel="noreferrer" className="prow">
                <div className="prow-orb">💳</div>
                <div className="prow-info">
                  <div className="prow-t">{t.payTitle}</div>
                  <div className="prow-d">{t.payDesc}</div>
                </div>
                <div className="prow-btn">{t.payBtn}</div>
              </a>
            )}

            {achHref && !inCollections && (
              <a href={achHref} className="prow">
                <div className="prow-orb">🏦</div>
                <div className="prow-info">
                  <div className="prow-t">{t.achTitle}</div>
                  <div className="prow-d">{t.achDesc}</div>
                </div>
                <div className="prow-btn">{t.achBtn}</div>
              </a>
            )}

            {ownerAccount && !inCollections && (
              <LedgerRequestButton assocCode={upper} />
            )}

            <MobileAppButton lang={L} />

            {!cfg.hideEstoppel && (
              <a href="https://topfloridaproperties.condocerts.com/resale/" target="_blank" rel="noreferrer" className="prow">
                <div className="prow-orb">🖨️</div>
                <div className="prow-info">
                  <div className="prow-t">{t.estoppelTitle}</div>
                  <div className="prow-d">{t.estoppelDesc}</div>
                </div>
                <div className="prow-btn">{t.estoppelBtn}</div>
              </a>
            )}

            {!cfg.hideApplication && (
              <ApplicationButton assocCode={upper} lang={L} />
            )}
          </div>
        </section>

        {/* Documents — hosted IN MAIA (no Google Drive). Fetched client-side
            after login so signed URLs never appear in the public page. */}
        <PortalDocuments assocCode={upper} lang={L} />

        {/* Contact */}
        <div className="sh">
          <div className="sh-orb">📞</div>
          <div className="sh-t">{t.contactTitle}</div>
          <div className="sh-s">{t.contactHours}</div>
          <div className="sh-line" />
        </div>

        {/* Contact a department by opening a tracked MAIA ticket (no published
            phone/email — keeps the conversation on platform). */}
        <ContactTickets
          openLabel={t.openTicket}
          labels={{ ar: t.contactAR, maintenance: t.contactMaint, compliance: t.contactCompliance, billing: t.contactBilling }}
        />

      </AssociationPortalGate>

      {/* PUBLIC sections (no login) — actions for non-residents, the public
          documents, and how to reach us. Hidden from a logged-in resident of
          this association (they see the full gated body above). */}
      {showPublicDocs && (
        <>
          {/* Public actions — prospective tenants/buyers (Application), closing
              agents (Estoppel), and service providers (Vendor registration). */}
          <section className="section">
            <h2 className="section-title">{t.quickActions}</h2>
            <div className="prow-grid">
              {!cfg.hideApplication && (
                <ApplicationButton assocCode={upper} lang={L} publicOnly />
              )}

              {!cfg.hideEstoppel && (
                <a href="https://topfloridaproperties.condocerts.com/resale/" target="_blank" rel="noreferrer" className="prow">
                  <div className="prow-orb">🖨️</div>
                  <div className="prow-info">
                    <div className="prow-t">{t.estoppelTitle}</div>
                    <div className="prow-d">{t.estoppelDesc}</div>
                  </div>
                  <div className="prow-btn">{t.estoppelBtn}</div>
                </a>
              )}

              <Link href="/register/vendor" className="prow">
                <div className="prow-orb">🛠️</div>
                <div className="prow-info">
                  <div className="prow-t">{t.vendorTitle}</div>
                  <div className="prow-d">{t.vendorDesc}</div>
                </div>
                <div className="prow-btn">{t.vendorBtn}</div>
              </Link>

              {/* Budget & financials are NOT openly public — identify (applicant/
                  agent) to start registration, or owners log in. */}
              <FinancialsAccessButton lang={L} assocCode={upper} />
            </div>
          </section>

          <PortalDocuments assocCode={upper} lang={L} publicOnly />

          <div className="sh">
            <div className="sh-orb">📞</div>
            <div className="sh-t">{t.contactTitle}</div>
            <div className="sh-s">{t.contactHours}</div>
            <div className="sh-line" />
          </div>

          {/* Contact a department by opening a tracked MAIA ticket — same
              on-platform mechanism as the logged-in view above (no
              published phone/email), just usable before identifying. */}
          <ContactTickets
            openLabel={t.openTicket}
            labels={{ ar: t.contactAR, maintenance: t.contactMaint, compliance: t.contactCompliance, billing: t.contactBilling }}
            assocCode={upper}
          />

          <section className="section" style={{ paddingTop: 0 }}>
            <AskMaiaButton label="💬 ASK MAIA →" className="prow-btn" />
          </section>
        </>
      )}
    </main>
  )
}
