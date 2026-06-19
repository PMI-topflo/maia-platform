'use client'

// =====================================================================
// MobileAppButton.tsx
//
// A single Quick-Action row ("PMI Mobile App") that, instead of linking
// straight to one store, pops up a chooser with BOTH store links so the
// resident lands on the right one for their device:
//   • Android → Google Play
//   • iPhone/iPad → Apple App Store
//
// The CINC resident app id is the same across regions; we use the US
// storefront paths since the audience is Florida residents (Apple
// redirects to the visitor's local store on open).
//
// Used on every resident-facing surface (the 25 association portals via
// AssociationPortal, /my-account, /board) so "PMI Mobile App" behaves the
// same everywhere. Renders as a `.prow` row to match the other actions.
// =====================================================================

import { useEffect, useState } from 'react'
import { normalizePortalLang, portalStrings } from '@/lib/portal-i18n'

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.cinc.pmiapp&hl=en_US'
const APPLE_URL = 'https://apps.apple.com/us/app/property-management-inc/id1572855043'

export default function MobileAppButton({ lang }: { lang?: string }) {
  const t = portalStrings(normalizePortalLang(lang))
  const [open, setOpen] = useState(false)

  // Close on Escape; lock body scroll while the chooser is open.
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="prow"
        style={{ width: '100%', textAlign: 'left', font: 'inherit' }}
      >
        <div className="prow-orb">📱</div>
        <div className="prow-info">
          <div className="prow-t">{t.mobileTitle}</div>
          <div className="prow-d">{t.mobileDesc}</div>
        </div>
        <div className="prow-btn">{t.mobileBtn}</div>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Download the PMI Mobile App"
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
              maxWidth: 420, width: '100%',
              padding: '1.6rem 1.5rem 1.5rem',
              boxShadow: '0 20px 60px rgba(13,13,13,.35)',
              position: 'relative',
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

            <div style={{ textAlign: 'center', fontSize: '2.2rem', lineHeight: 1 }}>📱</div>
            <h3 style={{
              fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 400,
              textAlign: 'center', margin: '0.6rem 0 0.25rem', color: 'var(--navy)',
            }}>
              {t.mobModalTitle}
            </h3>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.66rem', textTransform: 'uppercase',
              letterSpacing: '0.06em', textAlign: 'center', color: 'var(--muted)', margin: '0 0 1.25rem',
            }}>
              {t.mobModalChoose}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <a href={APPLE_URL} target="_blank" rel="noreferrer" className="prow" style={{ textDecoration: 'none' }}>
                <div className="prow-orb"></div>
                <div className="prow-info">
                  <div className="prow-t">{t.mobAppStore}</div>
                  <div className="prow-d">{t.mobAppStoreSub}</div>
                </div>
                <div className="prow-btn">{t.open}</div>
              </a>

              <a href={PLAY_URL} target="_blank" rel="noreferrer" className="prow" style={{ textDecoration: 'none' }}>
                <div className="prow-orb">🤖</div>
                <div className="prow-info">
                  <div className="prow-t">{t.mobPlay}</div>
                  <div className="prow-d">{t.mobPlaySub}</div>
                </div>
                <div className="prow-btn">{t.open}</div>
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
