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
//   - My Account  → goes to the current persona's portal landing page
//   - My Profile  → STAFF ONLY — edit own pmi_staff row
//   - My Personas → only shown when the user actually has more than one
//                   persona on file. Loads lazily from /api/auth/my-roles
//                   (each persona table is scanned for rows matching the
//                   session login email).
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

interface ResolvedRole {
  type:              'staff' | 'owner' | 'tenant' | 'board' | 'unit_manager' | 'building_manager'
  href:              string
  label:             string
  association_name?: string | null
}

export default function UserMenu() {
  const [session,     setSession]     = useState<SessionInfo | null>(null)
  const [open,        setOpen]        = useState(false)
  const [showSwitch,  setShowSwitch]  = useState(false)
  const [roles,       setRoles]       = useState<ResolvedRole[] | null>(null)
  const ref           = useRef<HTMLDivElement>(null)
  const rolesFetchedRef = useRef(false)
  const rolesLoading  = showSwitch && roles === null

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

  // Lazily resolve actual personas when the "My Personas" section is
  // expanded for the first time. Avoids hammering the DB on every page
  // load — most visits won't open the menu, let alone this submenu.
  // The ref dedupes; we don't call setState synchronously in this effect
  // so renders stay clean.
  useEffect(() => {
    if (!showSwitch || rolesFetchedRef.current) return
    rolesFetchedRef.current = true
    fetch('/api/auth/my-roles')
      .then(r => r.ok ? r.json() : { roles: [] })
      .then((data: { roles: ResolvedRole[] }) => setRoles(data.roles ?? []))
      .catch(() => setRoles([]))
  }, [showSwitch])

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
          background: '#f8fafc', border: '1px solid #e2e8f0',
          color: '#334155', borderRadius: 6, padding: '0.35rem 0.6rem',
          fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 500,
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

          {/* My Profile — per-persona edit pages. Staff edits the
              pmi_staff row directly (no approval). Non-staff personas
              edit their own record; login-email changes are approval-
              gated and email staff before they take effect. */}
          {(() => {
            const profileHref =
              session.persona === 'staff'            ? '/admin/profile'             :
              session.persona === 'owner'            ? '/my-account/profile'        :
              session.persona === 'tenant'           ? '/tenant/profile'            :
              session.persona === 'board'            ? '/board/profile'             :
              session.persona === 'unit_manager'     ? '/unit-manager/profile'      :
              session.persona === 'building_manager' ? '/building-manager/profile'  :
              null
            const sub = session.persona === 'staff'
              ? 'Edit staff record'
              : 'Update contact info'
            if (!profileHref) return null
            return (
              <Link href={profileHref} style={menuItemStyle}>
                <span>My profile</span>
                <span style={{ color: '#9ca3af', fontSize: '0.7rem' }}>{sub}</span>
              </Link>
            )
          })()}

          {/* My Personas — shows only the personas the user is actually
              registered as (looked up against the persona tables on first
              expand). If there's just one role, the section is hidden
              entirely (My Account already covers it). */}
          {(() => {
            // Filter out the user's current persona — they're already there
            // via "My account"; the switcher is for jumping to OTHERS.
            const others = (roles ?? []).filter(r => r.type !== session.persona)
            // Visibility rules:
            //   - If the user already clicked the section open, keep it
            //     visible no matter what the lookup returned. Otherwise
            //     it appears to "open and close" — they click, the fetch
            //     resolves with an empty `others`, and the whole section
            //     unmounts before they can read the empty-state message.
            //   - Pre-expand: show optimistically for staff (since they
            //     might legitimately have other personas), and for
            //     non-staff only after the lookup confirms there's at
            //     least one other persona to switch to.
            const shouldShowHeader = showSwitch || (
              roles === null
                ? session.persona === 'staff'
                : others.length > 0
            )
            if (!shouldShowHeader) return null
            return (
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
                    {rolesLoading && (
                      <div style={{ padding: '0.5rem 1.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>Looking up your other personas…</div>
                    )}
                    {!rolesLoading && others.length === 0 && (
                      <div style={{ padding: '0.5rem 1.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>You only have the {session.persona} persona on file.</div>
                    )}
                    {!rolesLoading && others.map((r, i) => (
                      <Link key={`${r.type}-${i}`} href={r.href} style={{ ...menuItemStyle, paddingLeft: '1.5rem', fontSize: '0.78rem' }}>
                        <span>{r.label}</span>
                        <span style={{ color: '#9ca3af', fontSize: '0.65rem' }}>→</span>
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )
          })()}

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
