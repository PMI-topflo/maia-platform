'use client'

import { useState, useEffect } from 'react'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'

interface BatchResult {
  renamed: number
  created: number
  already_correct: number
  batch_size: number
}

interface GmailAccount {
  id: string
  gmail_address: string
  display_name: string | null
  active: boolean
  watch_expiry: string | null
  connected_by: string | null
  created_at: string
}

export default function AdminToolsPage() {
  const [running, setRunning]     = useState(false)
  const [log, setLog]             = useState<string[]>([])
  const [totals, setTotals]       = useState({ renamed: 0, created: 0, ok: 0 })
  const [progress, setProgress]   = useState('')
  const [error, setError]         = useState<string | null>(null)
  const [done, setDone]           = useState(false)

  // Gmail accounts state
  const [gmailAccounts, setGmailAccounts]       = useState<GmailAccount[]>([])
  const [gmailLoading, setGmailLoading]         = useState(true)
  const [gmailMsg, setGmailMsg]                 = useState<string | null>(null)

  // Email association code cleanup state
  const [cleanRunning, setCleanRunning] = useState(false)
  const [cleanResult, setCleanResult]   = useState<{ total_tagged: number; kept: number; cleared: number; dry_run: boolean } | null>(null)
  const [cleanError, setCleanError]     = useState<string | null>(null)
  const [disconnecting, setDisconnecting]       = useState<string | null>(null)

  useEffect(() => {
    // Read URL params for connect/error feedback
    const params = new URLSearchParams(window.location.search)
    if (params.get('gmail_connected')) {
      setGmailMsg(`✅ ${decodeURIComponent(params.get('gmail_connected')!)} connected successfully`)
      window.history.replaceState({}, '', '/admin/tools')
    } else if (params.get('gmail_error')) {
      const code = params.get('gmail_error')
      const msgs: Record<string, string> = {
        no_code:          'Authorization was cancelled or denied.',
        token_failed:     'Failed to exchange authorization code. Try again.',
        no_refresh_token: 'No refresh token received. Please revoke access in your Google account and try again.',
        db_failed:        'Failed to save account to database.',
        unexpected:       'An unexpected error occurred.',
      }
      setGmailMsg(`❌ ${msgs[code!] ?? code}`)
      window.history.replaceState({}, '', '/admin/tools')
    }

    // Fetch connected accounts
    fetch('/api/admin/gmail-accounts')
      .then(r => r.json())
      .then(d => setGmailAccounts(d.accounts ?? []))
      .catch(() => setGmailMsg('Failed to load connected accounts'))
      .finally(() => setGmailLoading(false))
  }, [])

  async function disconnect(gmail_address: string) {
    if (!confirm(`Disconnect ${gmail_address}? Their emails will no longer appear in the communications view.`)) return
    setDisconnecting(gmail_address)
    try {
      const res = await fetch('/api/auth/gmail-staff/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gmail_address }),
      })
      if (res.ok) {
        setGmailAccounts((prev: GmailAccount[]) => prev.map((a: GmailAccount) => a.gmail_address === gmail_address ? { ...a, active: false } : a))
        setGmailMsg(`Disconnected ${gmail_address}`)
      }
    } finally {
      setDisconnecting(null)
    }
  }

  async function run(apply: boolean) {
    setRunning(true)
    setLog([])
    setTotals({ renamed: 0, created: 0, ok: 0 })
    setError(null)
    setDone(false)
    setProgress('Starting…')

    let offset = 0
    let totalUnits = 0
    let cumRenamed = 0, cumCreated = 0, cumOk = 0

    try {
      while (true) {
        setProgress(`Processing units ${offset + 1}–${offset + 15}${totalUnits ? ` of ${totalUnits}` : ''}…`)

        const res = await fetch('/api/admin/tools/sync-drive-folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apply, association_code: 'MANXI', offset }),
        })
        const json = await res.json()
        if (!res.ok || !json.ok) throw new Error(json.error ?? 'Request failed')

        totalUnits = json.total
        const s: BatchResult = json.summary
        cumRenamed += s.renamed
        cumCreated += s.created
        cumOk += s.already_correct

        setTotals({ renamed: cumRenamed, created: cumCreated, ok: cumOk })
        setLog((prev: string[]) => [...prev, ...json.log])

        if (json.next_offset == null) break
        offset = json.next_offset
      }

      setProgress(`Done — ${totalUnits} units processed`)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setRunning(false)
    }
  }

  async function runClean(apply: boolean) {
    setCleanRunning(true)
    setCleanResult(null)
    setCleanError(null)
    try {
      const res  = await fetch('/api/admin/tools/clean-email-assoc-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: !apply }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Request failed')
      setCleanResult(json)
    } catch (err) {
      setCleanError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setCleanRunning(false)
    }
  }

  const btnBase: import('react').CSSProperties = {
    padding: '0.6rem 1.2rem', borderRadius: 6, fontWeight: 600,
    cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.5 : 1,
    fontSize: '0.875rem',
  }

  const activeAccounts   = gmailAccounts.filter((a: GmailAccount) => a.active)
  const inactiveAccounts = gmailAccounts.filter((a: GmailAccount) => !a.active)

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main style={{ padding: '2rem', maxWidth: 860, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Admin Tools</h1>
        <p style={{ color: '#6b7280', marginBottom: '2rem' }}>Server-side maintenance tasks + staff configuration</p>

        {/* ── Staff Skills (moved out of the top nav to free space) ─────── */}
        <a
          href="/admin/skills"
          style={{
            display: 'block', textDecoration: 'none',
            border: '1px solid #e5e7eb', borderRadius: 8,
            padding: '1rem 1.25rem', marginBottom: '1.5rem',
            background: '#fff',
            transition: 'border-color 0.15s, background 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = '#f26a1b' }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = '#e5e7eb' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <h2 style={{ fontWeight: 700, margin: 0, fontSize: '1rem', color: '#111' }}>Staff Skills</h2>
              <p style={{ color: '#6b7280', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
                Manage which staff members are tagged for which skills (used by ticket routing + dashboards).
              </p>
            </div>
            <span style={{ color: '#f26a1b', fontWeight: 700, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
              Open →
            </span>
          </div>
        </a>

        {/* ── Gmail Account Connections ─────────────────────────────────── */}
        <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: '1.5rem' }}>
          <div style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontWeight: 700, margin: 0, fontSize: '1rem' }}>Connected Gmail Accounts</h2>
              <p style={{ color: '#6b7280', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
                Staff Gmail inboxes connected to the unified communications view. Each account requires a one-time authorization.
              </p>
            </div>
            <a
              href={`/api/auth/gmail-staff/authorize?connected_by=staff`}
              style={{
                padding: '0.5rem 1rem', background: '#f26a1b', color: '#fff',
                borderRadius: 6, fontWeight: 600, fontSize: '0.8rem',
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              + Connect Gmail
            </a>
          </div>

          {gmailMsg && (
            <div style={{
              padding: '0.75rem 1.25rem',
              background: gmailMsg.startsWith('✅') ? '#f0fdf4' : gmailMsg.startsWith('❌') ? '#fef2f2' : '#fffbeb',
              borderBottom: '1px solid #e5e7eb',
              fontSize: '0.85rem',
              color: gmailMsg.startsWith('✅') ? '#15803d' : gmailMsg.startsWith('❌') ? '#dc2626' : '#92400e',
            }}>
              {gmailMsg}
            </div>
          )}

          <div style={{ padding: '1rem 1.25rem' }}>
            {gmailLoading ? (
              <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: 0 }}>Loading…</p>
            ) : activeAccounts.length === 0 ? (
              <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: 0 }}>
                No Gmail accounts connected yet. Click <strong>+ Connect Gmail</strong> to add one.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {activeAccounts.map((acct: GmailAccount) => (
                  <div key={acct.id} style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.75rem', background: '#f9fafb',
                    border: '1px solid #e5e7eb', borderRadius: 6,
                  }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: acct.active ? '#16a34a' : '#9ca3af', flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#111' }}>
                        {acct.gmail_address}
                        {acct.display_name && (
                          <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: 6 }}>({acct.display_name})</span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 2 }}>
                        {acct.connected_by ? `Connected by ${acct.connected_by} · ` : ''}
                        {acct.watch_expiry
                          ? `Watch expires ${new Date(acct.watch_expiry).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                          : 'Watch not active'}
                      </div>
                    </div>
                    <button
                      onClick={() => disconnect(acct.gmail_address)}
                      disabled={disconnecting === acct.gmail_address}
                      style={{
                        padding: '0.35rem 0.75rem', border: '1px solid #e5e7eb',
                        borderRadius: 4, background: '#fff', color: '#6b7280',
                        fontSize: '0.75rem', cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      {disconnecting === acct.gmail_address ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {inactiveAccounts.length > 0 && (
              <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.75rem', marginBottom: 0 }}>
                {inactiveAccounts.length} disconnected account{inactiveAccounts.length !== 1 ? 's' : ''} hidden
              </p>
            )}

            <div style={{
              marginTop: '1rem', padding: '0.75rem', background: '#fffbeb',
              border: '1px solid #fde68a', borderRadius: 6, fontSize: '0.78rem', color: '#92400e',
            }}>
              <strong>⚠ One-time Google Console step required:</strong> Add{' '}
              <code style={{ background: '#fef3c7', padding: '1px 4px', borderRadius: 3 }}>
                {process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-domain.com'}/api/auth/gmail-staff/callback
              </code>{' '}
              as an authorized redirect URI in your Google Cloud OAuth credentials before connecting the first account.
            </div>
          </div>
        </section>

        {/* ── Drive Folder Sync ─────────────────────────────────────────── */}
        <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb', padding: '1rem 1.25rem' }}>
            <h2 style={{ fontWeight: 700, margin: 0, fontSize: '1rem' }}>Sync Drive Unit Folders — MANXI</h2>
            <p style={{ color: '#6b7280', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
              Renames folders to <code style={{ background: '#f3f4f6', padding: '0 3px', borderRadius: 3, fontSize: '0.75rem' }}>ACCOUNT - ADDRESS</code> format. Processes 15 units at a time.
            </p>
          </div>

          <div style={{ padding: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => run(false)} disabled={running}
              style={{ ...btnBase, border: '1px solid #d1d5db', background: '#fff', color: '#374151' }}>
              Dry Run (preview)
            </button>
            <button
              onClick={() => { if (confirm('Rename Drive folders for real. Continue?')) run(true) }}
              disabled={running}
              style={{ ...btnBase, border: 'none', background: '#f26a1b', color: '#fff' }}>
              Apply Changes
            </button>
            {running && <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>{progress}</span>}
            {error  && <span style={{ fontSize: '0.875rem', color: '#dc2626' }}>{error}</span>}
          </div>

          {(done || log.length > 0) && (
            <div style={{ borderTop: '1px solid #e5e7eb', padding: '1.25rem' }}>
              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
                {[
                  ['Already correct', totals.ok,      '#16a34a'],
                  ['Renamed',         totals.renamed,  '#f26a1b'],
                  ['Created',         totals.created,  '#2563eb'],
                ].map(([label, value, color]) => (
                  <div key={label as string}>
                    <div style={{ color: color as string, fontWeight: 700, fontSize: '1.4rem' }}>{value as number}</div>
                    <div style={{ color: '#6b7280', fontSize: '0.8rem' }}>{label as string}</div>
                  </div>
                ))}
              </div>
              {log.length > 0 && (
                <div style={{ background: '#0d0d0d', borderRadius: 6, padding: '1rem', maxHeight: 360, overflowY: 'auto' }}>
                  {log.map((line: string, i: number) => (
                    <div key={i} style={{
                      fontFamily: 'monospace', fontSize: '0.72rem', lineHeight: 1.7,
                      color: line.startsWith('RENAMED') || line.startsWith('WOULD RENAME') ? '#fbbf24'
                        : line.startsWith('CREATED') || line.startsWith('WOULD CREATE') ? '#60a5fa'
                        : '#9ca3af',
                    }}>
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Email Association Code Cleanup ────────────────────────────── */}
        <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginTop: '1.5rem' }}>
          <div style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb', padding: '1rem 1.25rem' }}>
            <h2 style={{ fontWeight: 700, margin: 0, fontSize: '1rem' }}>Clean Up Email Association Codes</h2>
            <p style={{ color: '#6b7280', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
              Removes incorrectly assigned association codes from email logs where no explicit account-number
              pattern (e.g. <code style={{ background: '#f3f4f6', padding: '0 3px', borderRadius: 3, fontSize: '0.75rem' }}>ESSI16</code>) exists in the subject or body.
              Run <strong>Preview</strong> first to see how many records will be affected.
            </p>
          </div>

          <div style={{ padding: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => runClean(false)}
              disabled={cleanRunning}
              style={{ padding: '0.6rem 1.2rem', borderRadius: 6, fontWeight: 600, fontSize: '0.875rem', border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: cleanRunning ? 'not-allowed' : 'pointer', opacity: cleanRunning ? 0.5 : 1 }}
            >
              {cleanRunning ? 'Running…' : 'Preview (dry run)'}
            </button>
            <button
              onClick={() => { if (confirm('This will permanently clear mis-tagged association codes. Continue?')) runClean(true) }}
              disabled={cleanRunning}
              style={{ padding: '0.6rem 1.2rem', borderRadius: 6, fontWeight: 600, fontSize: '0.875rem', border: 'none', background: '#f26a1b', color: '#fff', cursor: cleanRunning ? 'not-allowed' : 'pointer', opacity: cleanRunning ? 0.5 : 1 }}
            >
              Apply Cleanup
            </button>
            {cleanError && <span style={{ fontSize: '0.875rem', color: '#dc2626' }}>{cleanError}</span>}
          </div>

          {cleanResult && (
            <div style={{ borderTop: '1px solid #e5e7eb', padding: '1.25rem' }}>
              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: cleanResult.dry_run ? '0.75rem' : 0 }}>
                {[
                  ['Total tagged',   cleanResult.total_tagged, '#6b7280'],
                  ['Kept (valid)',    cleanResult.kept,         '#16a34a'],
                  ['Cleared',        cleanResult.cleared,      '#f26a1b'],
                ].map(([label, value, color]) => (
                  <div key={label as string}>
                    <div style={{ color: color as string, fontWeight: 700, fontSize: '1.4rem' }}>{value as number}</div>
                    <div style={{ color: '#6b7280', fontSize: '0.8rem' }}>{label as string}</div>
                  </div>
                ))}
              </div>
              {cleanResult.dry_run && cleanResult.cleared > 0 && (
                <p style={{ fontSize: '0.8rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '0.6rem 0.75rem', margin: '0.75rem 0 0' }}>
                  ⚠ Dry run — {cleanResult.cleared} record{cleanResult.cleared !== 1 ? 's' : ''} would be cleared. Click <strong>Apply Cleanup</strong> to commit.
                </p>
              )}
              {!cleanResult.dry_run && (
                <p style={{ fontSize: '0.8rem', color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '0.6rem 0.75rem', margin: '0.75rem 0 0' }}>
                  ✅ Done — {cleanResult.cleared} record{cleanResult.cleared !== 1 ? 's' : ''} cleared, {cleanResult.kept} kept.
                </p>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
