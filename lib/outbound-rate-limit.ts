import { supabaseAdmin } from '@/lib/supabase-admin'

export type OutboundDecision =
  | { allow: true }
  | { allow: false; reason: 'global-rate-limit' | 'per-recipient-rate-limit' | 'counter-unavailable'; detail: string }

interface CheckArgs {
  toEmails: string[]
  subject: string
}

const WINDOW_MS         = Number(process.env.MAIA_OUTBOUND_WINDOW_MS         ?? 5 * 60_000)
const GLOBAL_LIMIT      = Number(process.env.MAIA_OUTBOUND_GLOBAL_LIMIT      ?? 20)
const PER_RECIP_LIMIT   = Number(process.env.MAIA_OUTBOUND_PER_RECIPIENT_LIMIT ?? 3)
const FAIL_OPEN         = process.env.MAIA_OUTBOUND_FAIL_OPEN === 'true'

/**
 * Application-level outbound rate limit. Runs inside sendEmail() so every
 * caller is counted (freeform replies, structured-record replies, ticket
 * notifications, vendor inquiries, courtesy emails, cron jobs, etc.).
 *
 * Two caps, both rolling 5-minute by default:
 *  - global: total outbound across all recipients (default 20)
 *  - per-recipient: max for any single to_email (default 3)
 *
 * The per-recipient cap is the one that would have caught the
 * fsetton@gmail.com loop where the same address received ~30 replies in
 * minutes.
 *
 * Fails CLOSED by default — if the Supabase counter is unavailable we
 * assume the worst. Set MAIA_OUTBOUND_FAIL_OPEN=true to override (e.g. if
 * the rate-limit table itself is the problem and you need a clean send).
 */
export async function checkOutboundRateLimit({ toEmails, subject }: CheckArgs): Promise<OutboundDecision> {
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString()

  try {
    const { count: globalCount, error: globalErr } = await supabaseAdmin
      .from('outbound_send_attempts')
      .select('id', { count: 'exact', head: true })
      .is('blocked_reason', null)
      .gte('created_at', windowStart)

    if (globalErr) {
      return failClosed('counter-unavailable', `global query error: ${globalErr.message}`)
    }
    if (globalCount === null) {
      return failClosed('counter-unavailable', 'global count returned null')
    }
    if (globalCount >= GLOBAL_LIMIT) {
      return { allow: false, reason: 'global-rate-limit', detail: `${globalCount} sent in last ${WINDOW_MS}ms exceeds global cap of ${GLOBAL_LIMIT}` }
    }

    for (const to of toEmails) {
      const { count: perCount, error: perErr } = await supabaseAdmin
        .from('outbound_send_attempts')
        .select('id', { count: 'exact', head: true })
        .is('blocked_reason', null)
        .eq('to_email', to.toLowerCase())
        .gte('created_at', windowStart)

      if (perErr) {
        return failClosed('counter-unavailable', `per-recipient query error for ${to}: ${perErr.message}`)
      }
      if (perCount === null) {
        return failClosed('counter-unavailable', `per-recipient count returned null for ${to}`)
      }
      if (perCount >= PER_RECIP_LIMIT) {
        return { allow: false, reason: 'per-recipient-rate-limit', detail: `${perCount} sent to ${to} in last ${WINDOW_MS}ms exceeds per-recipient cap of ${PER_RECIP_LIMIT} (subject="${subject}")` }
      }
    }

    return { allow: true }
  } catch (err) {
    return failClosed('counter-unavailable', `unexpected error: ${(err as Error).message}`)
  }
}

/**
 * Record one outbound attempt. Called from sendEmail() right before the
 * provider call, and again on block decisions.
 *
 * Errors are swallowed (logged only) — failing to record should not break
 * sends. The trade-off: a Supabase outage could let the counter drift low,
 * but that's still better than hard-failing every email.
 */
export async function recordOutboundAttempt(opts: { toEmails: string[]; subject: string; blockedReason?: string }): Promise<void> {
  const rows = opts.toEmails.map(to => ({
    to_email:       to.toLowerCase(),
    subject:        opts.subject,
    blocked_reason: opts.blockedReason ?? null,
  }))
  const { error } = await supabaseAdmin.from('outbound_send_attempts').insert(rows)
  if (error) {
    console.error(`[outbound-rate-limit] failed to record attempt(s): ${error.message}`)
  }
}

function failClosed(reason: 'counter-unavailable', detail: string): OutboundDecision {
  if (FAIL_OPEN) {
    console.warn(`[outbound-rate-limit] counter unavailable but MAIA_OUTBOUND_FAIL_OPEN=true; allowing. detail=${detail}`)
    return { allow: true }
  }
  return { allow: false, reason, detail }
}
