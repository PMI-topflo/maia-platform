'use client'

import { useState, useEffect, useCallback } from 'react'
import TwoFactorAuth from '@/components/TwoFactorAuth'

// ── Types ─────────────────────────────────────────────────────────────────────

type GateState = 'loading' | 'login' | '2fa' | 'portal' | 'not-found' | 'previous-member' | 'wrong-assoc'

type MatchedRole =
  | { type: 'staff' }
  | { type: 'owner';  owner_id: number; association_code: string; association_name: string; firstName?: string; lastName?: string }
  | { type: 'board';  board_member_id: string; association_code: string; association_name: string; position: string | null; firstName?: string; lastName?: string }
  | { type: 'tenant'; association_code: string; association_name: string; firstName?: string; lastName?: string }

interface SessionData {
  persona:         string
  contactName:     string
  associationCode: string
  displayName:     string
  userId:          string | number
}

interface PrevMemberDetails {
  name:      string
  assocName: string
  endDate:   string | null
}

interface Props {
  assocCode: string
  assocName: string
  children:  React.ReactNode
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PERSONA_LABEL: Record<string, string> = {
  owner:  'Unit Owner',
  board:  'Board Member',
  tenant: 'Tenant',
  staff:  'PMI Staff',
}

const PERSONA_ICON: Record<string, string> = {
  owner:  '🔑',
  board:  '🗳️',
  tenant: '🏠',
  staff:  '🏢',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AssociationPortalGate({ assocCode, assocName, children }: Props) {
  const [state,              setState]             = useState<GateState>('loading')
  const [session,            setSession]           = useState<SessionData | null>(null)
  const [identifier,         setIdentifier]        = useState('')
  const [busy,               setBusy]              = useState(false)
  const [error,              setError]             = useState('')
  const [pendingRole,        setPendingRole]       = useState<MatchedRole | null>(null)
  const [lookupEmail,        setLookupEmail]       = useState('')
  const [lookupPhone,        setLookupPhone]       = useState('')
  const [prevDetails,        setPrevDetails]       = useState<PrevMemberDetails | null>(null)
  const [wrongAssocSession,  setWrongAssocSession] = useState<SessionData | null>(null)

  // Staff preview mode (?preview=visitor|owner) — lets staff see the portal
  // the way a visitor (public login screen) or a logged-in unit owner sees it,
  // instead of always landing on their own staff view.
  const preview = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('preview')
    : null

  const checkSession = useCallback(async () => {
    // Visitor preview: short-circuit to the public identify/login screen even
    // though a staff session exists.
    if (preview === 'visitor') { setState('login'); return }
    try {
      const res  = await fetch('/api/auth/check-session')
      if (!res.ok) { setState('login'); return }
      const data = await res.json()
      if (!data.valid) { setState('login'); return }

      const s = data.session as SessionData
      if (s.persona === 'staff' || s.associationCode === assocCode) {
        setSession(s)
        setState('portal')
      } else {
        // Valid session but for a different association
        setWrongAssocSession(s)
        setState('wrong-assoc')
      }
    } catch {
      setState('login')
    }
  }, [assocCode, preview])

  useEffect(() => { checkSession() }, [checkSession])

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')

    const trimmed = identifier.trim()
    const isEmail = trimmed.includes('@')
    const email   = isEmail ? trimmed : ''
    const phone   = !isEmail ? trimmed : ''

    try {
      const res  = await fetch('/api/association-lookup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, phone, associationCode: assocCode }),
      })
      const data = await res.json()

      if (!data.found) {
        if (data.reason === 'previous_member') {
          setPrevDetails(data.details)
          setState('previous-member')
        } else {
          setState('not-found')
        }
        return
      }

      const role = (data.roles as MatchedRole[])[0]
      setPendingRole(role)
      setLookupEmail(email)
      setLookupPhone(phone)
      setState('2fa')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    await fetch('/api/auth/check-session', { method: 'DELETE' })
    setSession(null)
    setWrongAssocSession(null)
    setPendingRole(null)
    setIdentifier('')
    setError('')
    setState('login')
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  if (state === 'loading') {
    return (
      <div className="flex justify-center py-16">
        <div className="text-gray-400 text-sm animate-pulse">Loading…</div>
      </div>
    )
  }

  // ── Portal (authenticated) ────────────────────────────────────────────────

  if (state === 'portal' && session) {
    return (
      <div>
        {preview === 'owner' && <PreviewBanner mode="owner" />}
        <div className="section" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#f26a1b]/10 flex items-center justify-center text-xl shrink-0">
                {PERSONA_ICON[session.persona] ?? '👤'}
              </div>
              <div>
                <div className="font-semibold text-gray-900">{session.contactName}</div>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  <span className="bg-[#f26a1b]/10 text-[#f26a1b] px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide">
                    {PERSONA_LABEL[session.persona] ?? session.persona}
                  </span>
                  <span className="text-xs text-gray-500">{session.displayName}</span>
                </div>
              </div>
            </div>
            <button
              onClick={signOut}
              className="text-xs text-gray-400 hover:text-gray-700 whitespace-nowrap transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
        {children}
      </div>
    )
  }

  // ── 2FA (OTP step) ────────────────────────────────────────────────────────

  if (state === '2fa' && pendingRole) {
    return (
      <div className="flex justify-center py-10 px-6">
        <div className="w-full max-w-sm bg-[#141414] border border-white/10 rounded-2xl p-8">
          <TwoFactorAuth
            role={pendingRole}
            email={lookupEmail}
            phone={lookupPhone}
            lang="en"
            onVerified={async () => { await checkSession() }}
            onBack={() => setState('login')}
          />
        </div>
      </div>
    )
  }

  // ── Previous member (blocked) ──────────────────────────────────────────────

  if (state === 'previous-member' && prevDetails) {
    return (
      <div className="flex justify-center py-10 px-6">
        <div className="w-full max-w-sm bg-white border border-amber-200 rounded-2xl p-8 shadow-sm">
          <div className="text-center mb-6">
            <div className="text-3xl mb-3">📋</div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Previous Resident</h2>
            <p className="text-sm text-gray-600">
              <strong>{prevDetails.name}</strong>, our records show your membership at{' '}
              <strong>{prevDetails.assocName}</strong> ended
              {prevDetails.endDate ? ` on ${new Date(prevDetails.endDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}.
            </p>
          </div>
          <p className="text-sm text-gray-500 text-center mb-6">
            If you believe this is an error, please contact PMI directly.
          </p>
          <a
            href="mailto:PMI@topfloridaproperties.com"
            className="block w-full text-center bg-[#f26a1b] hover:bg-[#f58140] text-white font-semibold text-sm py-2.5 rounded-lg transition-colors mb-3"
          >
            Contact PMI →
          </a>
          <button
            onClick={() => { setState('login'); setPrevDetails(null); setIdentifier('') }}
            className="block w-full text-center text-xs text-gray-400 hover:text-gray-700 transition-colors py-1"
          >
            Try a different account
          </button>
        </div>
      </div>
    )
  }

  // ── Not found ─────────────────────────────────────────────────────────────

  if (state === 'not-found') {
    return (
      <div className="flex justify-center py-10 px-6">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div className="text-center mb-6">
            <div className="text-3xl mb-3">🔍</div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Not Found</h2>
            <p className="text-sm text-gray-600">
              We couldn&apos;t find an account matching <strong>{identifier}</strong> in the{' '}
              {assocName} database.
            </p>
          </div>
          <p className="text-xs text-gray-400 text-center mb-6">
            New resident? Your record may not be set up yet. Contact PMI to get started.
          </p>
          <a
            href="mailto:PMI@topfloridaproperties.com"
            className="block w-full text-center bg-[#f26a1b] hover:bg-[#f58140] text-white font-semibold text-sm py-2.5 rounded-lg transition-colors mb-3"
          >
            Contact PMI →
          </a>
          <button
            onClick={() => { setState('login'); setIdentifier(''); setError('') }}
            className="block w-full text-center text-xs text-gray-400 hover:text-gray-700 transition-colors py-1"
          >
            ← Try again
          </button>
        </div>
      </div>
    )
  }

  // ── Wrong association (has valid session for different assoc) ──────────────

  if (state === 'wrong-assoc' && wrongAssocSession) {
    return (
      <div className="flex justify-center py-10 px-6">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div className="text-center mb-6">
            <div className="text-3xl mb-3">🔀</div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Different Association</h2>
            <p className="text-sm text-gray-600">
              You&apos;re signed in as <strong>{wrongAssocSession.contactName}</strong> for{' '}
              <strong>{wrongAssocSession.displayName}</strong>. This portal is for{' '}
              <strong>{assocName}</strong>.
            </p>
          </div>
          <button
            onClick={signOut}
            className="block w-full text-center bg-[#f26a1b] hover:bg-[#f58140] text-white font-semibold text-sm py-2.5 rounded-lg transition-colors mb-3"
          >
            Sign out and switch
          </button>
          <a
            href="/"
            className="block w-full text-center text-xs text-gray-400 hover:text-gray-700 transition-colors py-1"
          >
            Back to main portal
          </a>
        </div>
      </div>
    )
  }

  // ── Login form (default) ──────────────────────────────────────────────────

  return (
    <div>
    {preview === 'visitor' && <PreviewBanner mode="visitor" />}
    <div className="flex justify-center py-10 px-6">
      <div className="w-full max-w-sm">
        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div className="text-center mb-7">
            <div className="text-3xl mb-3">🔐</div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Resident Portal</h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              Enter your email or phone number to access your documents and account information.
            </p>
          </div>

          <form onSubmit={handleLookup} className="space-y-4">
            <div>
              <label className="block text-[0.68rem] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Email or Phone Number
              </label>
              <input
                type="text"
                value={identifier}
                onChange={e => { setIdentifier(e.target.value); setError('') }}
                placeholder="your@email.com or (305) 555-0100"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#f26a1b]/30 focus:border-[#f26a1b] transition-shadow"
                autoFocus
                autoComplete="email"
                dir="ltr"
              />
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={busy || identifier.trim().length < 5}
              className="w-full bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
            >
              {busy ? 'Looking up…' : 'Continue →'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          Not a resident?{' '}
          <a href="/" className="text-[#f26a1b] hover:underline">
            Visit main site
          </a>
        </p>
      </div>
    </div>
    </div>
  )
}

// Slim banner shown only in staff preview mode so it's obvious this is a
// preview of the resident experience, not the staff's own view.
function PreviewBanner({ mode }: { mode: 'owner' | 'visitor' }) {
  return (
    <div style={{
      background: '#fff7ed', borderBottom: '1px solid #fed7aa', color: '#9a3412',
      fontFamily: 'var(--font-mono)', fontSize: '0.66rem', textTransform: 'uppercase',
      letterSpacing: '0.08em', textAlign: 'center', padding: '0.4rem 1rem',
    }}>
      👁 Staff preview — {mode === 'owner' ? 'viewing as a logged-in unit owner' : 'viewing as a public visitor'}
    </div>
  )
}
