import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET /api/admin/gmail-accounts
//
// PASSIVE health for the Gmail panel — derived ENTIRELY from the database
// (cursor state, recent logged mail, cooldown, watch expiry). Makes NO Gmail
// API calls, so opening the Tools page can't trip a rate limit. "Diagnose"
// is the only thing that hits Gmail live (and it now respects the cooldown).
// Returns the connected staff accounts plus the main maia@ inbox so both
// show health on load, no clicks required.

const MAIN_ACCOUNT = 'maia@pmitop.com'

function escapeLike(s: string): string { return s.replace(/[%_\\]/g, c => `\\${c}`) }

async function logged30d(addr: string): Promise<number> {
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString()
  const { count } = await supabaseAdmin
    .from('email_logs')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'inbound')
    .gte('created_at', since)
    .ilike('to_email', `%${escapeLike(addr)}%`)
  return count ?? 0
}

function minutesAgo(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 60000) : null
}

interface Health { level: 'ok' | 'cooling' | 'warn' | 'error' | 'off'; text: string; cooldownUntil: string | null }

function deriveHealth(opts: {
  active?: boolean
  cooldownUntil?: string | null
  watchExpiry?: string | null
  lastWatchError?: string | null
  lastSyncedAt?: string | null
  logged30d: number
}): Health {
  const cd = opts.cooldownUntil && new Date(opts.cooldownUntil).getTime() > Date.now() ? opts.cooldownUntil : null
  if (opts.active === false) return { level: 'off', text: 'Disconnected', cooldownUntil: cd }
  if (/invalid_grant/i.test(opts.lastWatchError ?? '')) return { level: 'error', text: 'Needs reconnect — token revoked/expired', cooldownUntil: cd }
  if (cd) {
    const mins = Math.max(0, Math.round((new Date(cd).getTime() - Date.now()) / 60000))
    return { level: 'cooling', text: `Cooling down (Gmail rate-limited) — auto-resumes in ~${mins} min`, cooldownUntil: cd }
  }
  if (opts.watchExpiry && new Date(opts.watchExpiry).getTime() < Date.now()) {
    return { level: 'warn', text: 'Gmail watch expired — renew to resume', cooldownUntil: cd }
  }
  const ago = minutesAgo(opts.lastSyncedAt)
  if (opts.logged30d > 0) {
    const syncStr = ago != null ? ` · last sync ${ago < 60 ? `${ago}m` : `${Math.round(ago / 60)}h`} ago` : ''
    return { level: 'ok', text: `Healthy — ${opts.logged30d.toLocaleString()} emails logged (30d)${syncStr}`, cooldownUntil: cd }
  }
  return { level: 'warn', text: 'No inbound mail logged in 30 days', cooldownUntil: cd }
}

export async function GET() {
  // Staff accounts. Try with the cooldown column; fall back if the
  // 20260606_gmail_cooldown migration hasn't been applied yet.
  const STAFF_COLS = 'id, gmail_address, display_name, active, watch_expiry, connected_by, created_at, last_watch_renewed_at, last_watch_error, last_watch_error_at'
  type Row = Record<string, unknown>
  let staff = (await supabaseAdmin.from('staff_gmail_accounts').select(`${STAFF_COLS}, gmail_cooldown_until`).order('created_at', { ascending: false })).data as Row[] | null
  if (!staff) {
    staff = (await supabaseAdmin.from('staff_gmail_accounts').select(STAFF_COLS).order('created_at', { ascending: false })).data as Row[] | null
  }

  const accounts = await Promise.all((staff ?? []).map(async a => {
    const addr   = a.gmail_address as string
    const count  = await logged30d(addr)
    const health = deriveHealth({
      active:         a.active as boolean,
      cooldownUntil:  (a as Record<string, unknown>).gmail_cooldown_until as string | null,
      watchExpiry:    a.watch_expiry as string | null,
      lastWatchError: a.last_watch_error as string | null,
      lastSyncedAt:   (a.last_watch_renewed_at as string | null) ?? (a.created_at as string | null),
      logged30d:      count,
    })
    return { ...a, logged_30d: count, health }
  }))

  // Main maia@ inbox — from maia_watch_state, no Gmail call.
  let ws = (await supabaseAdmin.from('maia_watch_state').select('last_history_id, watch_expiry, updated_at, gmail_cooldown_until').eq('id', 1).maybeSingle()).data as Row | null
  if (!ws) {
    ws = (await supabaseAdmin.from('maia_watch_state').select('last_history_id, watch_expiry, updated_at').eq('id', 1).maybeSingle()).data as Row | null
  }
  const cd        = (ws as Record<string, unknown> | null)?.gmail_cooldown_until as string | null ?? null
  const mainLogged = await logged30d(MAIN_ACCOUNT)
  const main = {
    gmail_address:        MAIN_ACCOUNT,
    last_history_id:      (ws?.last_history_id as string | null) ?? null,
    watch_expiry:         (ws?.watch_expiry as string | null) ?? null,
    last_synced_at:       (ws?.updated_at as string | null) ?? null,
    gmail_cooldown_until: cd,
    logged_30d:           mainLogged,
    health: deriveHealth({
      cooldownUntil: cd,
      watchExpiry:   ws?.watch_expiry as string | null,
      lastSyncedAt:  ws?.updated_at as string | null,
      logged30d:     mainLogged,
    }),
  }

  return NextResponse.json({ accounts, main })
}
