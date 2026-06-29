'use client'

// =====================================================================
// FinancialsAccessButton.tsx
//
// Budget & financial statements are NOT openly public. This Quick Action
// (public side) opens a modal that asks the visitor to identify their role —
// Tenant Applicant, Buyer Applicant, Listing Agent, or Applicant's Agent —
// and explains the documents are available once they START THEIR REGISTRATION.
// Owners access them after logging in (the "Residents — log in" affordance).
//
// Each role routes to the registration / application start (Rentvine). Actual
// delivery of the financials after registration completes is handled staff-side
// / a future enhancement — this is the gated entry path the board asked for.
// =====================================================================

import { useEffect, useState } from 'react'
import { normalizePortalLang, portalStrings } from '@/lib/portal-i18n'

const REGISTER_URL = 'https://pmitopfloridaproperties.rentvine.com/public/apply?unitID=38'

export default function FinancialsAccessButton({ lang }: { lang?: string }) {
  const t = portalStrings(normalizePortalLang(lang))
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open])

  const roles: { key: string; label: string }[] = [
    { key: 'tenant_applicant', label: t.roleTenant },
    { key: 'buyer_applicant',  label: t.roleBuyer },
    { key: 'listing_agent',    label: t.roleListing },
    { key: 'applicant_agent',  label: t.roleApplicantAgent },
  ]

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="prow" style={{ width: '100%', textAlign: 'left', font: 'inherit' }}>
        <div className="prow-orb">📊</div>
        <div className="prow-info">
          <div className="prow-t">🔒 {t.finTitle}</div>
          <div className="prow-d">{t.finDesc}</div>
        </div>
        <div className="prow-btn">{t.finBtn}</div>
      </button>

      {open && (
        <div
          role="dialog" aria-modal="true" aria-label={t.finTitle}
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(13,13,13,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--card, #fff)', borderRadius: 6, border: '1px solid var(--border)', maxWidth: 460, width: '100%', padding: '1.6rem 1.5rem 1.5rem', boxShadow: '0 20px 60px rgba(13,13,13,.35)', position: 'relative', maxHeight: '85vh', overflowY: 'auto' }}
          >
            <button type="button" onClick={() => setOpen(false)} aria-label="Close"
              style={{ position: 'absolute', top: 10, right: 12, background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1, color: 'var(--muted)' }}>
              &times;
            </button>

            <div style={{ textAlign: 'center', fontSize: '2.2rem', lineHeight: 1 }}>📊</div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 400, textAlign: 'center', margin: '0.6rem 0 1rem', color: 'var(--navy)' }}>
              {t.finTitle}
            </h3>

            <p style={{ fontSize: '0.9rem', color: 'var(--navy)', margin: '0 0 1.1rem', lineHeight: 1.5 }}>
              {t.finModalText}
            </p>

            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.5rem' }}>
              {t.finWho}
            </div>
            <div className="prow-grid" style={{ padding: 0, margin: '0 0 1.1rem' }}>
              {roles.map(r => (
                <a
                  key={r.key}
                  href={`${REGISTER_URL}&role=${r.key}`}
                  target="_blank"
                  rel="noreferrer"
                  className="prow"
                  style={{ textDecoration: 'none' }}
                >
                  <div className="prow-orb">📝</div>
                  <div className="prow-info">
                    <div className="prow-t">{r.label}</div>
                  </div>
                  <div className="prow-btn">→</div>
                </a>
              ))}
            </div>

            <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: 0, lineHeight: 1.45 }}>
              🔑 {t.finOwnerNote}
            </p>
          </div>
        </div>
      )}
    </>
  )
}
