// =====================================================================
// lib/anthropic-guard.ts
//
// GLOBAL circuit breaker for Claude (Anthropic) API calls — a backstop so
// that no bug, anywhere in the app, can ever run up the API bill again
// (see the 2026-06-06 webhook-loop incident: ~520k Haiku calls in 24h).
//
// Two controls, both checked by assertClaudeBudget() which EVERY Claude
// call site invokes immediately before messages.create():
//
//   1. MAIA_AI_DISABLED=1  — hard kill switch. Blocks ALL Claude calls
//      app-wide instantly (env change, no deploy needed beyond setting it).
//
//   2. A rolling rate cap — at most MAIA_AI_CALLS_PER_5MIN (default 250)
//      Claude calls in any 5-minute window, counted in Postgres so the cap
//      is GLOBAL across all serverless instances (an in-memory counter
//      wouldn't catch a distributed fan-out). Normal operation is well
//      under this; a runaway trips it within seconds.
//
// Fails OPEN: any DB error (including the migration not being applied yet)
// logs and allows the call, so this safety net can never itself break
// normal operation. It only ever BLOCKS on an explicit over-cap result or
// the kill switch.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

export class AiCircuitOpenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiCircuitOpenError'
  }
}

const CAP_PER_5MIN = Number(process.env.MAIA_AI_CALLS_PER_5MIN ?? 250)

/** Throw before making a Claude call if the kill switch is set or the global
 *  5-minute call budget is exhausted. Call this immediately before every
 *  anthropic.messages.create(). `label` is only for log attribution. */
export async function assertClaudeBudget(label = 'claude'): Promise<void> {
  if (process.env.MAIA_AI_DISABLED === '1') {
    throw new AiCircuitOpenError(`Claude calls are disabled (MAIA_AI_DISABLED=1) — blocked "${label}"`)
  }
  try {
    const { data, error } = await supabaseAdmin.rpc('record_ai_call', { p_cap: CAP_PER_5MIN })
    if (error) {
      // Fail OPEN — never let a DB hiccup (or an un-applied migration) block ops.
      console.warn(`[ai-guard] budget check failed open (${label}): ${error.message}`)
      return
    }
    if (data === false) {
      console.error(`[ai-guard] 🚨 CIRCUIT OPEN: >${CAP_PER_5MIN} Claude calls in 5 min — blocking "${label}"`)
      throw new AiCircuitOpenError(`Claude circuit breaker open: more than ${CAP_PER_5MIN} calls in 5 minutes`)
    }
  } catch (err) {
    if (err instanceof AiCircuitOpenError) throw err
    console.warn(`[ai-guard] budget check errored, failing open (${label}): ${err instanceof Error ? err.message : err}`)
  }
}

// ── Usage / cache statistics ─────────────────────────────────────────
//
// One structured log line per Claude call so prompt-cache health can be
// read from the Vercel runtime logs (search "[claude-usage]"): how many
// input tokens were served from cache vs written vs billed in full. Added
// 2026-09-09 after the Console's "prompt cache hit rate is low" notice —
// until then nothing recorded these fields, so hit rate was unmeasurable.
//
// hit = cache_read / (cache_read + cache_write + input). A cached call site
// in steady state should show hit near 1 with cache_write near 0; writes on
// every call with zero reads mean the prefix is changing between calls.

interface UsageLike {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

/** Log a Claude response's token usage. Never throws — logging only. */
export function logClaudeUsage(label: string, response: { model?: string; usage?: UsageLike | null } | null | undefined): void {
  try {
    const u = response?.usage
    if (!u) return
    const input = u.input_tokens ?? 0
    const read  = u.cache_read_input_tokens ?? 0
    const write = u.cache_creation_input_tokens ?? 0
    const out   = u.output_tokens ?? 0
    const denom = input + read + write
    const hit   = denom > 0 ? Math.round((read / denom) * 100) : 0
    console.log(`[claude-usage] ${JSON.stringify({ label, model: response?.model ?? null, input, cache_read: read, cache_write: write, output: out, cache_hit_pct: hit })}`)
  } catch { /* logging must never affect the call */ }
}
