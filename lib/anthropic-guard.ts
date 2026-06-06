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
