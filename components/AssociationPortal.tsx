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
import { redirect } from 'next/navigation'
import SiteHeader from '@/components/SiteHeader'
import AssociationPortalGate from '@/components/AssociationPortalGate'
import PortalDocuments from '@/components/PortalDocuments'
import MobileAppButton from '@/components/MobileAppButton'
import ContactTickets from '@/components/ContactTickets'
import ApplicationButton from '@/components/ApplicationButton'
import PortalLangBar from '@/components/PortalLangBar'
import { normalizePortalLang, portalStrings, isRtl } from '@/lib/portal-i18n'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { portalConfig } from '@/lib/association-portal-config'

const TYPE_LABEL: Record<string, string> = {
  condo: 'Condominium', hoa: 'HOA', coop: 'Co-op', 'co-op': 'Co-op', commercial: 'Commercial',
  master_hoa: 'Master HOA',
}
// Friendly label for an association_type; prettify unknown values (master_hoa → "Master HOA").
const prettyType = (t: string) => TYPE_LABEL[t.toLowerCase()] ?? t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export default async function AssociationPortal({ code, lang }: { code: string; lang?: string }) {
  const upper = code.toUpperCase()

  // Association portals are private — not public micro-sites. A visitor must
  // identify on the main page first; only PMI staff (incl. "view portal as"
  // previews) and a logged-in resident OF THIS association may see it. Anyone
  // else is bounced to the main page to identify (which then routes residents
  // back to their own association). No name/address leaks to the public.
  const sessTok = (await cookies()).get(SESSION_COOKIE)?.value
  const sess = sessTok ? await verifySession(sessTok) : null
  const allowed = sess?.persona === 'staff' || (sess?.associationCode ?? '').toUpperCase() === upper
  if (!allowed) redirect('/')

  const L = normalizePortalLang(lang)
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

  return (
    <main className="assoc-page" dir={rtl ? 'rtl' : 'ltr'}>
      <div className="assoc-topbar">
        <span className="assoc-topbar-l">💬 CHAT WITH MAIA 24/7 · WE SPEAK ENGLISH, SPANISH, PORTUGUESE, FRENCH, CREOLE, HEBREW &amp; RUSSIAN</span>
        <span className="assoc-topbar-r">ASK MAIA →</span>
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
              {t.residentPortal}{type ? ` · ${type}` : ''}{statute ? ` · ${statute}` : ''}
            </div>
            {address && <div style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: '0.2rem' }}>{address}</div>}
          </div>
          <div style={{ marginInlineStart: 'auto' }}>
            <PortalLangBar current={L} label={t.langLabel} />
          </div>
        </div>
      </div>

      <AssociationPortalGate assocCode={upper} assocName={name} lang={L}>

        {/* Quick Actions — first thing an owner sees after login. */}
        <section className="section">
          <h2 className="section-title">{t.quickActions}</h2>
          <div className="prow-grid">
            <a href="https://pmitfp.cincwebaxis.com/" target="_blank" rel="noreferrer" className="prow">
              <div className="prow-orb">💳</div>
              <div className="prow-info">
                <div className="prow-t">{t.payTitle}</div>
                <div className="prow-d">{t.payDesc}</div>
              </div>
              <div className="prow-btn">{t.payBtn}</div>
            </a>

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
    </main>
  )
}
