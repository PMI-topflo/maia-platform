// =====================================================================
// /admin/addon — "Connect the Gmail add-on"
//
// Shows the signed-in staffer their personal add-on token (mint once,
// paste into the Gmail add-on's settings) + the API base URL. Staff-gated
// by middleware; the token authenticates the add-on AS this staffer.
// =====================================================================

import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { signAddonToken } from '@/lib/addon-token'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Gmail add-on — PMI Top Florida' }

export default async function AddonConnectPage() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  const email   = session?.persona === 'staff' && typeof session.userId === 'string' ? session.userId.toLowerCase() : null

  const apiBase    = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
  const addonToken = email ? await signAddonToken(email) : null

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="GMAIL ADD-ON"><AdminNav /></SiteHeader>
      <div style={{ maxWidth: 720, margin: '24px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Connect the Gmail add-on</h1>
        {!email ? (
          <p style={{ fontSize: 14, color: '#991b1b' }}>Sign in as a staff member to generate your add-on token.</p>
        ) : (
          <>
            <p style={{ fontSize: 14, color: '#4b5563', lineHeight: 1.6 }}>
              Open the <strong>Maia</strong> panel in Gmail (right sidebar), go to its settings, and paste these two values once.
              The token authenticates the add-on as <strong>{email}</strong>. Keep it private; re-load this page to mint a fresh one (the old one keeps working until it expires).
            </p>

            <label style={labelStyle}>API base URL</label>
            <input readOnly value={apiBase} style={fieldStyle} onClick={e => (e.target as HTMLInputElement).select()} />

            <label style={labelStyle}>Your add-on token</label>
            <textarea readOnly value={addonToken ?? ''} rows={4} style={{ ...fieldStyle, fontFamily: 'var(--font-mono, monospace)', fontSize: 11, resize: 'vertical' }} onClick={e => (e.target as HTMLTextAreaElement).select()} />

            <p style={{ fontSize: 12, color: '#6b7280', marginTop: 12 }}>
              Tip: click a field to select it, then copy. Valid for 1 year.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', marginTop: 16, marginBottom: 4, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280' }
const fieldStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff' }
