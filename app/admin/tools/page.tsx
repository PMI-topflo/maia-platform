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

interface GmailHealth { level: 'ok' | 'cooling' | 'warn' | 'error' | 'off'; text: string; cooldownUntil: string | null }
interface GmailAccount {
  id: string
  gmail_address: string
  display_name: string | null
  active: boolean
  watch_expiry: string | null
  connected_by: string | null
  created_at: string
  last_watch_renewed_at?: string | null
  last_watch_error?:      string | null
  last_watch_error_at?:   string | null
  logged_30d?:            number
  health?:                GmailHealth
}
interface GmailMain {
  gmail_address: string
  logged_30d?:   number
  health?:       GmailHealth
}
// Passive-health badge colors (no Gmail call — derived from the DB).
const HEALTH_BG: Record<GmailHealth['level'], string> = { ok: '#f0fdf4', cooling: '#eff6ff', warn: '#fffbeb', error: '#fef2f2', off: '#f3f4f6' }
const HEALTH_BD: Record<GmailHealth['level'], string> = { ok: '#bbf7d0', cooling: '#bfdbfe', warn: '#fde68a', error: '#fecaca', off: '#e5e7eb' }
const HEALTH_FG: Record<GmailHealth['level'], string> = { ok: '#15803d', cooling: '#1d4ed8', warn: '#92400e', error: '#991b1b', off: '#6b7280' }

export default function AdminToolsPage() {
  const [running, setRunning]     = useState(false)
  const [log, setLog]             = useState<string[]>([])
  const [totals, setTotals]       = useState({ renamed: 0, created: 0, ok: 0 })
  const [progress, setProgress]   = useState('')
  const [error, setError]         = useState<string | null>(null)
  const [done, setDone]           = useState(false)

  // Gmail accounts state
  const [gmailAccounts, setGmailAccounts]       = useState<GmailAccount[]>([])
  const [gmailMain, setGmailMain]               = useState<GmailMain | null>(null)
  const [gmailLoading, setGmailLoading]         = useState(true)
  const [gmailMsg, setGmailMsg]                 = useState<string | null>(null)

  // Migration status
  interface MigrationRow {
    key:         string
    label:       string
    description: string
    filename:    string
    applied:     boolean
    sql:         string
  }
  const [migrations,        setMigrations]        = useState<MigrationRow[]>([])
  const [migrationsLoading, setMigrationsLoading] = useState(true)
  const [openedSqlKey,      setOpenedSqlKey]      = useState<string | null>(null)
  const [canAutoApply,      setCanAutoApply]      = useState(false)
  const [setupSql,          setSetupSql]          = useState('')
  const [setupSqlOpen,      setSetupSqlOpen]      = useState(false)
  const [applyingKey,       setApplyingKey]       = useState<string | null>(null)
  const [applyErrors,       setApplyErrors]       = useState<Record<string, string>>({})

  // Email association code cleanup state
  const [cleanRunning, setCleanRunning] = useState(false)
  const [cleanResult, setCleanResult]   = useState<{ total_tagged: number; kept: number; cleared: number; dry_run: boolean } | null>(null)
  const [cleanError, setCleanError]     = useState<string | null>(null)
  const [disconnecting, setDisconnecting]       = useState<string | null>(null)
  const [renewing,      setRenewing]            = useState<string | null>(null)

  // Gmail account diagnostics
  interface DiagnoseReport {
    account?:          string
    verdict:           string
    error?:            boolean
    tokenOk?:          boolean
    tokenError?:       string | null
    liveHistoryId?:    string | null
    storedHistoryId?:  string | null
    messagesTotal?:    number | null
    recentInboxCount?: number | null
    emailLogs30d?:     number
    watchExpired?:     boolean
  }
  const [diagnosing, setDiagnosing] = useState<string | null>(null)
  const [diagnosis,  setDiagnosis]  = useState<Record<string, DiagnoseReport>>({})
  const [syncing,    setSyncing]    = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<Record<string, string>>({})

  // Dialpad integration state
  interface DialpadStatus {
    ok:                 boolean
    missingMigration?:  boolean
    connected?:         boolean
    hookUrl?:           string | null
    smsSubscriptionId?: string | null
    callSubscriptionId?: string | null
    updatedAt?:         string | null
    staffLinesCount?:   number
    numbersCount?:      number
    error?:             string
  }
  const [dialpadStatus,      setDialpadStatus]     = useState<DialpadStatus | null>(null)
  const [dialpadLoading,     setDialpadLoading]    = useState(true)
  const [dialpadBusy,        setDialpadBusy]       = useState<null | 'setup' | 'sync' | 'backfill'>(null)
  const [dialpadMsg,         setDialpadMsg]        = useState<string | null>(null)
  const [dialpadDaysBack,    setDialpadDaysBack]   = useState(30)

  async function refreshDialpadStatus() {
    try {
      const r = await fetch('/api/admin/dialpad/status')
      const j = await r.json() as DialpadStatus
      setDialpadStatus(j)
    } catch (err) {
      setDialpadStatus({ ok: false, error: (err as Error).message })
    } finally {
      setDialpadLoading(false)
    }
  }

  async function refreshMigrations() {
    try {
      const r = await fetch('/api/admin/migration-status')
      const d = await r.json()
      setMigrations(d.migrations ?? [])
      setCanAutoApply(!!d.canAutoApply)
      setSetupSql(d.setupSql ?? '')
    } catch {
      /* keep whatever we have */
    } finally {
      setMigrationsLoading(false)
    }
  }

  async function applyMigration(key: string) {
    setApplyingKey(key)
    setApplyErrors(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    try {
      const r = await fetch('/api/admin/migrations/apply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ key }),
      })
      const d = await r.json()
      if (d.ok && d.applied) {
        await refreshMigrations()
      } else if (d.needsSetup) {
        setCanAutoApply(false)
        setSetupSqlOpen(true)
        setApplyErrors(prev => ({ ...prev, [key]: 'Install the one-time helper above first, then try again.' }))
      } else {
        setApplyErrors(prev => ({ ...prev, [key]: d.error || 'Migration did not apply — check the SQL in Supabase.' }))
      }
    } catch (err) {
      setApplyErrors(prev => ({ ...prev, [key]: (err as Error).message }))
    } finally {
      setApplyingKey(null)
    }
  }

  async function runDialpadSetup() {
    if (!confirm('Create Dialpad webhook + SMS/call subscriptions now? This calls the Dialpad API.')) return
    setDialpadBusy('setup'); setDialpadMsg(null)
    try {
      const r = await fetch('/api/admin/dialpad/setup', { method: 'POST' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error ?? 'setup failed')
      setDialpadMsg(`Connected — webhook ${j.webhookId}`)
      await refreshDialpadStatus()
    } catch (err) {
      setDialpadMsg(`Error: ${(err as Error).message}`)
    } finally {
      setDialpadBusy(null)
    }
  }

  async function runDialpadSyncStaff() {
    setDialpadBusy('sync'); setDialpadMsg(null)
    try {
      const r = await fetch('/api/admin/dialpad/sync-staff', { method: 'POST' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error ?? 'sync failed')
      setDialpadMsg(`Sync done — ${j.usersFound} users, ${j.usersMapped} mapped to staff, ${j.numbersFound} numbers`)
      await refreshDialpadStatus()
    } catch (err) {
      setDialpadMsg(`Error: ${(err as Error).message}`)
    } finally {
      setDialpadBusy(null)
    }
  }

  async function runDialpadBackfill() {
    if (!confirm(`Backfill the last ${dialpadDaysBack} days of Dialpad calls into general_conversations?`)) return
    setDialpadBusy('backfill'); setDialpadMsg(null)
    try {
      const r = await fetch('/api/admin/dialpad/backfill-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysBack: dialpadDaysBack }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error ?? 'backfill failed')
      setDialpadMsg(`Backfill — found ${j.found}, inserted ${j.inserted}, skipped ${j.skipped}`)
    } catch (err) {
      setDialpadMsg(`Error: ${(err as Error).message}`)
    } finally {
      setDialpadBusy(null)
    }
  }

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
      .then(d => { setGmailAccounts(d.accounts ?? []); setGmailMain(d.main ?? null) })
      .catch(() => setGmailMsg('Failed to load connected accounts'))
      .finally(() => setGmailLoading(false))

    // Fetch migration status
    refreshMigrations()

    // Fetch Dialpad integration status
    refreshDialpadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function renewWatch(gmail_address: string) {
    setRenewing(gmail_address)
    try {
      const res = await fetch(`/api/admin/gmail-accounts/${encodeURIComponent(gmail_address)}/renew-watch`, { method: 'POST' })
      const data = await res.json() as { ok: boolean; error?: string; historyId?: string; isInvalidGrant?: boolean }
      // Refresh the in-memory list on BOTH success and failure so the
      // row reflects the freshly persisted last_watch_renewed_at /
      // last_watch_error / last_watch_error_at columns. Without this,
      // the badge stays WATCH EXPIRED + the button stays "Renew now"
      // even after the server stamped the invalid_grant error.
      const r = await fetch('/api/admin/gmail-accounts').then(x => x.json())
      setGmailAccounts(r.accounts ?? [])
      setGmailMain(r.main ?? null)

      if (data.ok) {
        setGmailMsg(`✅ ${gmail_address} watch renewed`)
      } else {
        setGmailMsg(`❌ ${gmail_address}: ${data.error ?? 'renewal failed'}${data.isInvalidGrant ? ' — reconnect required' : ''}`)
      }
    } catch (err) {
      setGmailMsg(`❌ ${gmail_address}: ${(err as Error).message}`)
    } finally {
      setRenewing(null)
    }
  }

  async function diagnose(gmail_address: string) {
    setDiagnosing(gmail_address)
    try {
      const res  = await fetch(`/api/admin/gmail-accounts/${encodeURIComponent(gmail_address)}/diagnose`, { method: 'POST' })
      const data = await res.json()
      if (data.ok && data.report) {
        setDiagnosis(prev => ({ ...prev, [gmail_address]: data.report }))
      } else {
        setDiagnosis(prev => ({ ...prev, [gmail_address]: { verdict: data.error || 'Diagnosis failed.', error: true } }))
      }
    } catch (err) {
      setDiagnosis(prev => ({ ...prev, [gmail_address]: { verdict: (err as Error).message, error: true } }))
    } finally {
      setDiagnosing(null)
    }
  }

  async function syncInbox(gmail_address: string) {
    setSyncing(gmail_address)
    setSyncResult(prev => { const n = { ...prev }; delete n[gmail_address]; return n })
    try {
      const res  = await fetch(`/api/admin/gmail-accounts/${encodeURIComponent(gmail_address)}/sync-inbox`, { method: 'POST' })
      const d    = await res.json()
      if (d.ok) {
        const datedNote = d.datesStamped > 0 ? `, re-dated ${d.datesStamped}` : ''
        const failNote  = d.missingFromLog > 0
          ? ` — ${d.missingFromLog} could not be fetched, re-run to retry`
          : ''
        setSyncResult(prev => ({ ...prev, [gmail_address]:
          `✓ Mirrored to inbox — added ${d.backfilled}, restored ${d.restored}, hid ${d.dismissed}${datedNote}; ${d.visibleAfter} of ${d.inboxSize} showing${failNote}.` }))
      } else {
        setSyncResult(prev => ({ ...prev, [gmail_address]: `✗ ${d.error || 'Sync failed.'}` }))
      }
    } catch (err) {
      setSyncResult(prev => ({ ...prev, [gmail_address]: `✗ ${(err as Error).message}` }))
    } finally {
      setSyncing(null)
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

        {/* ── Schema Migrations ─────────────────────────────────────────── */}
        <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: '1.5rem' }}>
          <div style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb', padding: '1rem 1.25rem' }}>
            <h2 style={{ fontWeight: 700, margin: 0, fontSize: '1rem' }}>
              Schema Migrations
              {!migrationsLoading && (() => {
                const missing = migrations.filter(m => !m.applied).length
                return missing > 0 ? (
                  <span style={{ marginLeft: 8, padding: '2px 8px', background: '#fee2e2', color: '#991b1b', fontSize: '0.7rem', borderRadius: 4, fontWeight: 500 }}>
                    {missing} MISSING
                  </span>
                ) : (
                  <span style={{ marginLeft: 8, padding: '2px 8px', background: '#dcfce7', color: '#166534', fontSize: '0.7rem', borderRadius: 4, fontWeight: 500 }}>
                    ALL APPLIED
                  </span>
                )
              })()}
            </h2>
            <p style={{ color: '#6b7280', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
              Tracks which recent migrations are live in Supabase. Click <em>Apply</em> to run a missing one server-side, or <em>Show SQL</em> to copy it for the Supabase SQL Editor.
            </p>
          </div>

          {!migrationsLoading && !canAutoApply && migrations.some(m => !m.applied) && (
            <div style={{ background: '#fffbeb', borderBottom: '1px solid #e5e7eb', padding: '0.85rem 1.25rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.8rem', color: '#92400e' }}>
                One-time setup — enable the Apply button
              </div>
              <p style={{ fontSize: '0.75rem', color: '#92400e', margin: '0.3rem 0 0.5rem' }}>
                The Apply button needs a helper function in the database. Paste this once into
                Supabase → SQL Editor → Run. After that, every migration below applies with one click.
              </p>
              <button
                onClick={() => setSetupSqlOpen(o => !o)}
                style={{
                  padding: '0.3rem 0.6rem', border: '1px solid #d97706', borderRadius: 4,
                  background: setupSqlOpen ? '#d97706' : '#fff', color: setupSqlOpen ? '#fff' : '#d97706',
                  fontSize: '0.7rem', cursor: 'pointer',
                }}
              >
                {setupSqlOpen ? 'Hide setup SQL' : 'Show setup SQL'}
              </button>
              {setupSqlOpen && (
                <pre style={{
                  background: '#0d0d0d', color: '#e5e7eb', marginTop: 6,
                  padding: '0.75rem', borderRadius: 4, overflow: 'auto',
                  fontSize: '0.72rem', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                }}>{setupSql}</pre>
              )}
            </div>
          )}

          <div style={{ padding: '0.5rem 0' }}>
            {migrationsLoading ? (
              <div style={{ padding: '1rem 1.25rem', color: '#9ca3af', fontSize: '0.85rem' }}>Checking…</div>
            ) : migrations.length === 0 ? (
              <div style={{ padding: '1rem 1.25rem', color: '#9ca3af', fontSize: '0.85rem' }}>No migrations to track.</div>
            ) : (
              migrations.map((m: MigrationRow) => (
                <div key={m.key} style={{ borderTop: '1px solid #f3f4f6', padding: '0.6rem 1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: m.applied ? '#16a34a' : '#dc2626', flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.8rem', color: '#111' }}>
                        {m.label}
                        <span style={{ marginLeft: 6, fontWeight: 400, color: '#9ca3af', fontFamily: 'monospace', fontSize: '0.7rem' }}>
                          ({m.description})
                        </span>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#9ca3af', fontFamily: 'monospace', marginTop: 1 }}>
                        {m.filename}
                      </div>
                    </div>
                    {!m.applied && (
                      <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                        {canAutoApply && (
                          <button
                            onClick={() => applyMigration(m.key)}
                            disabled={applyingKey !== null}
                            style={{
                              padding: '0.3rem 0.8rem', border: '1px solid #16a34a',
                              borderRadius: 4, background: '#16a34a', color: '#fff',
                              fontSize: '0.7rem', whiteSpace: 'nowrap',
                              cursor: applyingKey !== null ? 'default' : 'pointer',
                              opacity: applyingKey !== null && applyingKey !== m.key ? 0.5 : 1,
                            }}
                          >
                            {applyingKey === m.key ? 'Applying…' : 'Apply'}
                          </button>
                        )}
                        <button
                          onClick={() => setOpenedSqlKey(openedSqlKey === m.key ? null : m.key)}
                          style={{
                            padding: '0.3rem 0.6rem', border: '1px solid #f26a1b',
                            borderRadius: 4, background: openedSqlKey === m.key ? '#f26a1b' : '#fff',
                            color: openedSqlKey === m.key ? '#fff' : '#f26a1b',
                            fontSize: '0.7rem', cursor: 'pointer', whiteSpace: 'nowrap',
                          }}
                        >
                          {openedSqlKey === m.key ? 'Hide SQL' : 'Show SQL'}
                        </button>
                      </div>
                    )}
                  </div>
                  {!m.applied && openedSqlKey === m.key && (
                    <div style={{ marginTop: 6 }}>
                      <pre style={{
                        background: '#0d0d0d', color: '#e5e7eb',
                        padding: '0.75rem', borderRadius: 4, overflow: 'auto',
                        fontSize: '0.72rem', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                      }}>{m.sql}</pre>
                      <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: 4 }}>
                        Paste into Supabase → SQL Editor → Run. Refresh this page after.
                      </div>
                    </div>
                  )}
                  {applyErrors[m.key] && (
                    <div style={{
                      marginTop: 6, padding: '0.4rem 0.6rem', background: '#fef2f2',
                      border: '1px solid #fecaca', borderRadius: 4,
                      fontSize: '0.72rem', color: '#991b1b',
                    }}>
                      {applyErrors[m.key]}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

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
            {/* Main MAIA inbox — runs on the app's own Gmail credentials,
                not a connected staff account, so it is shown separately. */}
            <div style={{ padding: '0.75rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#111' }}>
                    maia@pmitop.com
                    <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: 6 }}>(Main MAIA inbox)</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 2 }}>
                    The @maia command channel — separate from the connected staff inboxes below.
                  </div>
                  {/* PASSIVE health — derived from the DB on load, no Gmail call.
                      Glance here to see status without clicking Diagnose (which
                      hits Gmail live and can re-trip a rate limit). */}
                  {gmailMain?.health && (
                    <div style={{ marginTop: 6, padding: '6px 9px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600,
                      background: HEALTH_BG[gmailMain.health.level], border: `1px solid ${HEALTH_BD[gmailMain.health.level]}`, color: HEALTH_FG[gmailMain.health.level] }}>
                      {gmailMain.health.text}
                    </div>
                  )}
                  {diagnosis['maia@pmitop.com'] && (() => {
                    const d    = diagnosis['maia@pmitop.com']
                    const bad  = !!d.error || /BREAK FOUND|FAILED/.test(d.verdict)
                    const good = /^Healthy/.test(d.verdict)
                    const bg   = bad ? '#fef2f2' : good ? '#f0fdf4' : '#fffbeb'
                    const bd   = bad ? '#fecaca' : good ? '#bbf7d0' : '#fde68a'
                    const fg   = bad ? '#991b1b' : good ? '#15803d' : '#92400e'
                    return (
                      <div style={{ marginTop: 6, padding: '8px 10px', background: bg, border: `1px solid ${bd}`, borderRadius: 4 }}>
                        <div style={{ fontSize: '0.75rem', color: fg, fontWeight: 600 }}>{d.verdict}</div>
                        {!d.error && (
                          <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: 4, fontFamily: 'monospace', wordBreak: 'break-word' }}>
                            token {d.tokenOk ? 'OK' : 'FAILED'}
                            {' · '}recent inbox: {d.recentInboxCount ?? '—'}
                            {' · '}logged 30d: {d.emailLogs30d ?? '—'}
                            {' · '}mailbox total: {d.messagesTotal ?? '—'}
                            {' · '}historyId stored {d.storedHistoryId ?? '—'} / live {d.liveHistoryId ?? '—'}
                          </div>
                        )}
                        {d.tokenError && (
                          <div style={{ fontSize: '0.68rem', color: '#991b1b', marginTop: 3, fontFamily: 'monospace', wordBreak: 'break-word' }}>
                            {d.tokenError}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  {syncResult['maia@pmitop.com'] && (
                    <div style={{
                      marginTop: 6, padding: '6px 9px', borderRadius: 4, fontSize: '0.72rem',
                      background: syncResult['maia@pmitop.com'].startsWith('✓') ? '#f0fdf4' : '#fef2f2',
                      border: `1px solid ${syncResult['maia@pmitop.com'].startsWith('✓') ? '#bbf7d0' : '#fecaca'}`,
                      color: syncResult['maia@pmitop.com'].startsWith('✓') ? '#15803d' : '#991b1b',
                    }}>
                      {syncResult['maia@pmitop.com']}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flexShrink: 0 }}>
                  <button
                    onClick={() => diagnose('maia@pmitop.com')}
                    disabled={diagnosing === 'maia@pmitop.com'}
                    style={{
                      padding: '0.35rem 0.75rem', border: '1px solid #2563eb',
                      borderRadius: 4, background: '#fff', color: '#2563eb',
                      fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    {diagnosing === 'maia@pmitop.com' ? 'Diagnosing…' : 'Diagnose'}
                  </button>
                  <button
                    onClick={() => syncInbox('maia@pmitop.com')}
                    disabled={syncing === 'maia@pmitop.com'}
                    style={{
                      padding: '0.35rem 0.75rem', border: '1px solid #16a34a',
                      borderRadius: 4, background: '#16a34a', color: '#fff',
                      fontSize: '0.75rem', whiteSpace: 'nowrap',
                      cursor: syncing === 'maia@pmitop.com' ? 'default' : 'pointer',
                    }}
                  >
                    {syncing === 'maia@pmitop.com' ? 'Syncing…' : 'Sync inbox'}
                  </button>
                </div>
              </div>
            </div>

            {gmailLoading ? (
              <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: 0 }}>Loading…</p>
            ) : activeAccounts.length === 0 ? (
              <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: 0 }}>
                No Gmail accounts connected yet. Click <strong>+ Connect Gmail</strong> to add one.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {activeAccounts.map((acct: GmailAccount) => {
                  const watchExpired   = !!(acct.watch_expiry && new Date(acct.watch_expiry).getTime() < Date.now())
                  const isInvalidGrant = /invalid_grant/i.test(acct.last_watch_error ?? '')
                  const statusColor    = !acct.active ? '#9ca3af'
                                       : isInvalidGrant ? '#dc2626'
                                       : watchExpired ? '#f59e0b'
                                       : '#16a34a'
                  return (
                  <div key={acct.id} style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.75rem', background: '#f9fafb',
                    border: '1px solid #e5e7eb', borderRadius: 6,
                  }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: statusColor, flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#111' }}>
                        {acct.gmail_address}
                        {acct.display_name && (
                          <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: 6 }}>({acct.display_name})</span>
                        )}
                        {isInvalidGrant && (
                          <span style={{ marginLeft: 8, padding: '1px 6px', background: '#fee2e2', color: '#991b1b', fontSize: '0.65rem', borderRadius: 4, fontWeight: 500 }}>
                            NEEDS RECONNECT
                          </span>
                        )}
                        {!isInvalidGrant && watchExpired && (
                          <span style={{ marginLeft: 8, padding: '1px 6px', background: '#fef3c7', color: '#92400e', fontSize: '0.65rem', borderRadius: 4, fontWeight: 500 }}>
                            WATCH EXPIRED
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 2 }}>
                        {acct.connected_by ? `Connected by ${acct.connected_by} · ` : ''}
                        {acct.watch_expiry
                          ? `Watch ${watchExpired ? 'expired' : 'expires'} ${new Date(acct.watch_expiry).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                          : 'Watch not active'}
                        {acct.last_watch_renewed_at && (
                          <span> · last renewed {new Date(acct.last_watch_renewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        )}
                      </div>
                      {/* PASSIVE health (DB-derived, no Gmail call) — incl. cooldown. */}
                      {acct.health && (
                        <div style={{ marginTop: 6, padding: '5px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600,
                          background: HEALTH_BG[acct.health.level], border: `1px solid ${HEALTH_BD[acct.health.level]}`, color: HEALTH_FG[acct.health.level] }}>
                          {acct.health.text}
                        </div>
                      )}
                      {acct.last_watch_error && (
                        <div style={{
                          marginTop: 6, padding: '6px 8px',
                          background: '#fef2f2', border: '1px solid #fecaca',
                          borderRadius: 4, fontSize: '0.72rem', color: '#991b1b',
                          fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                          Last error: {acct.last_watch_error}
                          {acct.last_watch_error_at && (
                            <span style={{ color: '#7f1d1d', marginLeft: 6 }}>
                              ({new Date(acct.last_watch_error_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })})
                            </span>
                          )}
                        </div>
                      )}
                      {diagnosis[acct.gmail_address] && (() => {
                        const d    = diagnosis[acct.gmail_address]
                        const bad  = !!d.error || /BREAK FOUND|FAILED/.test(d.verdict)
                        const good = /^Healthy/.test(d.verdict)
                        const bg   = bad ? '#fef2f2' : good ? '#f0fdf4' : '#fffbeb'
                        const bd   = bad ? '#fecaca' : good ? '#bbf7d0' : '#fde68a'
                        const fg   = bad ? '#991b1b' : good ? '#15803d' : '#92400e'
                        return (
                          <div style={{ marginTop: 6, padding: '8px 10px', background: bg, border: `1px solid ${bd}`, borderRadius: 4 }}>
                            <div style={{ fontSize: '0.75rem', color: fg, fontWeight: 600 }}>{d.verdict}</div>
                            {!d.error && (
                              <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: 4, fontFamily: 'monospace', wordBreak: 'break-word' }}>
                                token {d.tokenOk ? 'OK' : 'FAILED'}
                                {' · '}recent inbox: {d.recentInboxCount ?? '—'}
                                {' · '}logged 30d: {d.emailLogs30d ?? '—'}
                                {' · '}mailbox total: {d.messagesTotal ?? '—'}
                                {' · '}historyId stored {d.storedHistoryId ?? '—'} / live {d.liveHistoryId ?? '—'}
                              </div>
                            )}
                            {d.tokenError && (
                              <div style={{ fontSize: '0.68rem', color: '#991b1b', marginTop: 3, fontFamily: 'monospace', wordBreak: 'break-word' }}>
                                {d.tokenError}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                      {syncResult[acct.gmail_address] && (
                        <div style={{
                          marginTop: 6, padding: '6px 9px', borderRadius: 4, fontSize: '0.72rem',
                          background: syncResult[acct.gmail_address].startsWith('✓') ? '#f0fdf4' : '#fef2f2',
                          border: `1px solid ${syncResult[acct.gmail_address].startsWith('✓') ? '#bbf7d0' : '#fecaca'}`,
                          color: syncResult[acct.gmail_address].startsWith('✓') ? '#15803d' : '#991b1b',
                        }}>
                          {syncResult[acct.gmail_address]}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flexShrink: 0 }}>
                      {isInvalidGrant ? (
                        <a
                          href={`/api/auth/gmail-staff/authorize?connected_by=${encodeURIComponent(acct.gmail_address)}`}
                          style={{
                            padding: '0.35rem 0.75rem', border: '1px solid #f26a1b',
                            borderRadius: 4, background: '#f26a1b', color: '#fff',
                            fontSize: '0.75rem', textDecoration: 'none', textAlign: 'center', whiteSpace: 'nowrap',
                          }}
                        >
                          Reconnect
                        </a>
                      ) : (
                        <button
                          onClick={() => renewWatch(acct.gmail_address)}
                          disabled={renewing === acct.gmail_address}
                          style={{
                            padding: '0.35rem 0.75rem', border: '1px solid #e5e7eb',
                            borderRadius: 4, background: '#fff', color: '#374151',
                            fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap',
                          }}
                        >
                          {renewing === acct.gmail_address ? 'Renewing…' : 'Renew now'}
                        </button>
                      )}
                      <button
                        onClick={() => diagnose(acct.gmail_address)}
                        disabled={diagnosing === acct.gmail_address}
                        style={{
                          padding: '0.35rem 0.75rem', border: '1px solid #2563eb',
                          borderRadius: 4, background: '#fff', color: '#2563eb',
                          fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        {diagnosing === acct.gmail_address ? 'Diagnosing…' : 'Diagnose'}
                      </button>
                      <button
                        onClick={() => syncInbox(acct.gmail_address)}
                        disabled={syncing === acct.gmail_address}
                        style={{
                          padding: '0.35rem 0.75rem', border: '1px solid #16a34a',
                          borderRadius: 4, background: '#16a34a', color: '#fff',
                          fontSize: '0.75rem', whiteSpace: 'nowrap',
                          cursor: syncing === acct.gmail_address ? 'default' : 'pointer',
                        }}
                      >
                        {syncing === acct.gmail_address ? 'Syncing…' : 'Sync inbox'}
                      </button>
                      <button
                        onClick={() => disconnect(acct.gmail_address)}
                        disabled={disconnecting === acct.gmail_address}
                        style={{
                          padding: '0.35rem 0.75rem', border: '1px solid #e5e7eb',
                          borderRadius: 4, background: '#fff', color: '#6b7280',
                          fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        {disconnecting === acct.gmail_address ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    </div>
                  </div>
                  )
                })}
              </div>
            )}

            {inactiveAccounts.length > 0 && (
              <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.75rem', marginBottom: 0 }}>
                {inactiveAccounts.length} disconnected account{inactiveAccounts.length !== 1 ? 's' : ''} hidden
              </p>
            )}

            {/* Setup hint: only shown before the first account is
                connected. If active accounts exist, the redirect URI
                is clearly already configured in Google Cloud OAuth
                or none of them would have completed authorization. */}
            {activeAccounts.length === 0 && (
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
            )}
          </div>
        </section>

        {/* ── Dialpad Integration ───────────────────────────────────────── */}
        <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: '1.5rem' }}>
          <div style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <h2 style={{ fontWeight: 700, margin: 0, fontSize: '1rem' }}>Dialpad integration</h2>
              <p style={{ color: '#6b7280', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
                Ingest Dialpad calls + SMS into the unified communications view. Requires{' '}
                <code style={{ background: '#f3f4f6', padding: '0 3px', borderRadius: 3, fontSize: '0.75rem' }}>DIALPAD_API_KEY</code> on the server.
              </p>
            </div>
            {dialpadLoading ? (
              <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Loading…</span>
            ) : dialpadStatus?.missingMigration ? (
              <span style={{ padding: '2px 8px', background: '#fef3c7', color: '#92400e', fontSize: '0.7rem', borderRadius: 4, fontWeight: 600 }}>
                MIGRATION NEEDED
              </span>
            ) : dialpadStatus?.connected ? (
              <span style={{ padding: '2px 8px', background: '#dcfce7', color: '#166534', fontSize: '0.7rem', borderRadius: 4, fontWeight: 600 }}>
                CONNECTED
              </span>
            ) : (
              <span style={{ padding: '2px 8px', background: '#fee2e2', color: '#991b1b', fontSize: '0.7rem', borderRadius: 4, fontWeight: 600 }}>
                NOT CONNECTED
              </span>
            )}
          </div>

          {dialpadMsg && (
            <div style={{
              padding: '0.75rem 1.25rem',
              background: dialpadMsg.startsWith('Error') ? '#fef2f2' : '#f0fdf4',
              borderBottom: '1px solid #e5e7eb',
              fontSize: '0.85rem',
              color: dialpadMsg.startsWith('Error') ? '#dc2626' : '#15803d',
            }}>
              {dialpadMsg}
            </div>
          )}

          <div style={{ padding: '1rem 1.25rem' }}>
            {dialpadStatus?.missingMigration ? (
              <p style={{ color: '#92400e', fontSize: '0.85rem', margin: 0 }}>
                Apply the <code>20260519_dialpad_ingest.sql</code> migration before using this section.
              </p>
            ) : (
              <>
                {dialpadStatus?.connected && dialpadStatus.hookUrl && (
                  <div style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.75rem', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Hook: {dialpadStatus.hookUrl}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', fontSize: '0.8rem', color: '#374151' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#111' }}>{dialpadStatus?.staffLinesCount ?? 0}</div>
                    <div style={{ color: '#6b7280' }}>staff lines mapped</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#111' }}>{dialpadStatus?.numbersCount ?? 0}</div>
                    <div style={{ color: '#6b7280' }}>company numbers</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    onClick={runDialpadSetup}
                    disabled={dialpadBusy !== null || dialpadStatus?.connected}
                    style={{
                      padding: '0.5rem 1rem', borderRadius: 6, fontWeight: 600, fontSize: '0.8rem',
                      border: 'none', background: dialpadStatus?.connected ? '#9ca3af' : '#f26a1b',
                      color: '#fff',
                      cursor: dialpadBusy !== null || dialpadStatus?.connected ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {dialpadBusy === 'setup' ? 'Setting up…' : '1. Setup webhook'}
                  </button>
                  <button
                    onClick={runDialpadSyncStaff}
                    disabled={dialpadBusy !== null}
                    style={{
                      padding: '0.5rem 1rem', borderRadius: 6, fontWeight: 600, fontSize: '0.8rem',
                      border: '1px solid #d1d5db', background: '#fff', color: '#374151',
                      cursor: dialpadBusy !== null ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {dialpadBusy === 'sync' ? 'Syncing…' : '2. Sync staff + numbers'}
                  </button>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#374151' }}>
                    Backfill days:
                    <input
                      type="number" min={1} max={365}
                      value={dialpadDaysBack}
                      onChange={e => setDialpadDaysBack(Math.max(1, Math.min(365, Number(e.target.value) || 30)))}
                      style={{ width: 60, padding: '0.25rem 0.4rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.78rem' }}
                    />
                  </label>
                  <button
                    onClick={runDialpadBackfill}
                    disabled={dialpadBusy !== null}
                    style={{
                      padding: '0.5rem 1rem', borderRadius: 6, fontWeight: 600, fontSize: '0.8rem',
                      border: '1px solid #d1d5db', background: '#fff', color: '#374151',
                      cursor: dialpadBusy !== null ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {dialpadBusy === 'backfill' ? 'Backfilling…' : '3. Backfill calls'}
                  </button>
                </div>

                <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: '0.75rem', marginBottom: 0 }}>
                  SMS history is webhook-only going forward — Dialpad does not expose a list endpoint for past SMS.
                </p>
              </>
            )}
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
