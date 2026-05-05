'use client'

export default function SignOutButton() {
  async function handleSignOut() {
    await fetch('/api/auth/check-session', { method: 'DELETE' })
    window.location.href = '/'
  }

  return (
    <button
      onClick={handleSignOut}
      style={{ background: 'none', border: 'none', fontSize: '0.78rem', color: 'var(--muted)', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
    >
      Sign out
    </button>
  )
}
