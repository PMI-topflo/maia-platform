'use client'

// =====================================================================
// components/UserMenu.tsx
//
// Universal top-right account menu — sits in SiteHeader on every page.
// Fetches the current session on mount; renders nothing when there's
// no session (so the same component is safe on public pages like
// /privacy-policy or the homepage pre-login).
//
// Menu items:
//   - My Account  → goes to the persona's portal landing page
//   - My Personas → STAFF ONLY (middleware lets staff access every portal
//                   without re-OTP). Expands inline to list portals.
//   - Sign out    → clears session, redirects to homepage
// =====================================================================

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

interface SessionInfo {
  persona:         'owner' | 'board' | 'staff' | 'tenant' | 'unit_manager' | 'building_manager'
  contactName:     string
  displayName:     string
  associationCode: string
  userId?:         string | number
}

const PORTAL_URLS = {
  staff:            { href: '/admin',            label: 'Staff Dashboard' },
  board:            { href: '/board',            label: 'Board Portal' },
  owner:            { href: '/my-account',       label: 'Owner Portal' },
  tenant:           { href: '/tenant',           label: 'Tenant Portal' },
  unit_manager:     { href: '/unit-manager',     label: 'Unit Manager' },
  building_manager: { href: '/building-manager', label: 'Building Manager' },
} as const

function initialsFrom(name: string, email: string): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/)
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
  }
  if (email) return email.slice(0, 2).toUpperCase()
  return '?'
}

export default function UserMenu() {
  const [session,    setSession]    = useState<SessionInfo | null>(null)
  const [open,       setOpen]       = useState(false)
  const [showSwitch, setShowSwitch] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Load session once.
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/check-session')
      .then(r => r.ok ? r.json() : { valid: false })
      .then((data: { valid: boolean; session?: SessionInfo }) => {
        if (!cancelled && data.valid && data.session) setSession(data.session)
      })
      .catch(() => { /* no session → render nothing */ })
    return () => { cancelled = true }
  }, [])

  // Close on click-outside.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setShowSwitch(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (!session) return null

  const userEmail = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId : ''
  const display   = session.contactName || userEmail || 'Account'
  const initials  = initialsFrom(session.contactName, userEmail)
  const home      = PORTAL_URLS[session.persona] ?? PORTAL_URLS.owner

  async function handleSignOut() {
    try { sessionStorage.removeItem('maia_persona') } catch { /* ignore */ }
    await fetch('/api/auth/check-session', { method: 'DELETE' })
    window.location.href = '/'
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setShowSwitch(false) }}
        title={`Signed in as ${display}`}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
          color: '#fff', borderRadius: 4, padding: '0.35rem 0.6rem',
          fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.04em',
          cursor: 'pointer',
        }}
      >
        <span style={{
          width: 22, height: 22, borderRadius: '50%',
          background: '#f26a1b', color: '#fff', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '0.6rem', fontWeight: 600, letterSpacing: 0,
        }}>{initials}</span>
        <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {display}
        </span>
        <span style={{ opacity: 0.7 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)',
          background: '#fff', color: '#111',
          border: '1px solid #e5e7eb', borderRadius: 6,
          boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
          minWidth: 240, padding: '0.5rem 0',
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
          zIndex: 60,
        }}>
          {/* Identity block */}
          <div style={{ padding: '0.4rem 0.9rem 0.6rem' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 500, color: '#111' }}>{session.contactName || 'Signed in'}</div>
            <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: 2 }}>
              {userEmail || session.persona}
              {session.displayName && ` · ${session.displayName}`}
            </div>
          </div>

          <div style={{ height: 1, background: '#f3f4f6', margin: '0.25rem 0' }} />

          {/* My Account */}
          <Link href={home.href} style={menuItemStyle}>
            <span>My account</span>
            <span style={{ color: '#9ca3af', fontSize: '0.7rem' }}>{home.label}</span>
          </Link>

          {/* My Profile — staff only (edit own pmi_staff row) */}
          {session.persona === 'staff' && (
            <Link href="/admin/profile" style={menuItemStyle}>
              <span>My profile</span>
              <span style={{ color: '#9ca3af', fontSize: '0.7rem' }}>Edit staff record</span>
            </Link>
          )}

          {/* My Personas — staff only */}
          {session.persona === 'staff' && (
            <>
              <button
                type="button"
                onClick={() => setShowSwitch(v => !v)}
                style={{ ...menuItemStyle, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <span>My personas</span>
                <span style={{ color: '#9ca3af', fontSize: '0.7rem' }}>{showSwitch ? '▴' : '▾'}</span>
              </button>
              {showSwitch && (
                <div style={{ background: '#fafafa', padding: '0.25rem 0', borderTop: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6' }}>
                  {(['staff', 'board', 'owner', 'unit_manager', 'building_manager'] as const).map(p => {
                    const portal = PORTAL_URLS[p]
                    return (
                      <Link key={p} href={portal.href} style={{ ...menuItemStyle, paddingLeft: '1.5rem', fontSize: '0.78rem' }}>
                        <span>{portal.label}</span>
                        <span style={{ color: '#9ca3af', fontSize: '0.65rem' }}>→</span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </>
          )}

          <div style={{ height: 1, background: '#f3f4f6', margin: '0.25rem 0' }} />

          {/* Sign out */}
          <button
            type="button"
            onClick={handleSignOut}
            style={{ ...menuItemStyle, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c' }}
          >
            <span>Sign out</span>
            <span style={{ color: '#fca5a5', fontSize: '0.7rem' }}>↩</span>
          </button>
        </div>
      )}
    </div>
  )
}

const menuItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '0.5rem 0.9rem',
  fontSize: '0.82rem', color: '#111',
  textDecoration: 'none',
}
