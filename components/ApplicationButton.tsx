'use client'

// =====================================================================
// ApplicationButton.tsx
//
// The "Tenant / Buyer Application" Quick Action. Instead of jumping
// straight to the background-check site, it pops up a screen that:
//   1. Reminds the resident to DOWNLOAD the application package and
//      follow the instructions — the package is this association's
//      "Application Forms" document(s), uploaded in MAIA.
//   2. Links out to run the background check (Rentvine).
//
// The package links come from the same session-gated endpoint the
// portal's Documents section uses (/api/portal/documents), filtered to
// the "Application Forms" category. This row only renders inside the
// logged-in gate, so the fetch is always authenticated.
// =====================================================================

import { useEffect, useState } from 'react'
import { normalizePortalLang, portalStrings } from '@/lib/portal-i18n'

const BACKGROUND_CHECK_URL = 'https://pmitopfloridaproperties.rentvine.com/public/apply?unitID=38'
const APPLICATION_FORMS_LABEL = 'Application Forms'

interface PortalDoc { id: string; category_label: string; filename: string; download_url: string }
interface PortalDocGroup { docs: PortalDoc[] }

export default function ApplicationButton({ assocCode, lang, publicOnly }: { assocCode: string; lang?: string; publicOnly?: boolean }) {
  const t = portalStrings(normalizePortalLang(lang))
  const [open, setOpen] = useState(false)
  const [pkg, setPkg] = useState<PortalDoc[] | null>(null)  // null = not yet loaded

  // Close on Escape + lock body scroll while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  // Lazily fetch the association's "Application Forms" docs when first opened.
  // Public visitors (prospective tenants/buyers aren't logged-in residents) use
  // the no-login endpoint, which returns only is_public documents.
  useEffect(() => {
    if (!open || pkg !== null) return
    const docsUrl = publicOnly
      ? `/api/portal/documents/public?assoc=${encodeURIComponent(assocCode)}`
      : `/api/portal/documents?assoc=${encodeURIComponent(assocCode)}`
    fetch(docsUrl, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: { groups?: PortalDocGroup[] }) => {
        const docs = (d.groups ?? [])
          .flatMap(g => g.docs ?? [])
          .filter(doc => doc.category_label === APPLICATION_FORMS_LABEL)
        setPkg(docs)
      })
      .catch(() => setPkg([]))
  }, [open, pkg, assocCode, publicOnly])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="prow"
        style={{ width: '100%', textAlign: 'left', font: 'inherit' }}
      >
        <div className="prow-orb">🏠</div>
        <div className="prow-info">
          <div className="prow-t">{t.appTitle}</div>
          <div className="prow-d">{t.appDesc}</div>
        </div>
        <div className="prow-btn">{t.appBtn}</div>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Tenant / Buyer Application"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(13,13,13,.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1.25rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--card, #fff)', borderRadius: 6,
              border: '1px solid var(--border)',
              maxWidth: 460, width: '100%',
              padding: '1.6rem 1.5rem 1.5rem',
              boxShadow: '0 20px 60px rgba(13,13,13,.35)',
              position: 'relative',
              maxHeight: '85vh', overflowY: 'auto',
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                position: 'absolute', top: 10, right: 12,
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '1.3rem', lineHeight: 1, color: 'var(--muted)',
              }}
            >
              &times;
            </button>

            <div style={{ textAlign: 'center', fontSize: '2.2rem', lineHeight: 1 }}>🏠</div>
            <h3 style={{
              fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 400,
              textAlign: 'center', margin: '0.6rem 0 1.25rem', color: 'var(--navy)',
            }}>
              {t.appModalTitle}
            </h3>

            {/* Step 1 — download the application package */}
            <p style={{ fontSize: '0.9rem', color: 'var(--navy)', margin: '0 0 0.75rem', lineHeight: 1.5 }}>
              <strong>{t.appDownloadPkg}</strong> {t.appFollowInstr}
            </p>

            {pkg === null && (
              <p style={{ color: 'var(--muted)', fontSize: '0.8rem', margin: '0 0 1rem' }}>{t.appPkgLoading}</p>
            )}

            {pkg !== null && pkg.length === 0 && (
              <p style={{ color: 'var(--muted)', fontSize: '0.8rem', margin: '0 0 1rem', lineHeight: 1.5 }}>
                {t.appPkgEmpty}
              </p>
            )}

            {pkg !== null && pkg.length > 0 && (
              <div className="prow-grid" style={{ padding: 0, margin: '0 0 1.25rem' }}>
                {pkg.map(doc => (
                  <a key={doc.id} href={doc.download_url} target="_blank" rel="noreferrer" className="prow" style={{ textDecoration: 'none' }}>
                    <div className="prow-orb">📄</div>
                    <div className="prow-info">
                      <div className="prow-t">{t.appPkgLabel}</div>
                      <div className="prow-d">{doc.filename}</div>
                    </div>
                    <div className="prow-btn">{t.download}</div>
                  </a>
                ))}
              </div>
            )}

            {/* Step 2 — run the background check */}
            <p style={{ fontSize: '0.9rem', color: 'var(--navy)', margin: '0.5rem 0 0.75rem', lineHeight: 1.5 }}>
              {t.appReviewThen}
            </p>
            <a href={BACKGROUND_CHECK_URL} target="_blank" rel="noreferrer" className="prow" style={{ textDecoration: 'none' }}>
              <div className="prow-orb">🔎</div>
              <div className="prow-info">
                <div className="prow-t">{t.appBgTitle}</div>
                <div className="prow-d">{t.appBgDesc}</div>
              </div>
              <div className="prow-btn">{t.appBgBtn}</div>
            </a>
          </div>
        </div>
      )}
    </>
  )
}
