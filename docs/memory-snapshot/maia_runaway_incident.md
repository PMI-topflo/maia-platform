# MAIA runaway API-spend incident + safety controls (2026-06-06)

## What happened
MAIA hit the Anthropic Haiku rate limit ~520,000 times in 24h, exhausting API
credits. ROOT CAUSE: the Gmail Pub/Sub webhook (app/api/maia-email/webhook)
advanced its history cursor (maia_watch_state.last_history_id / staff
history_id) only AFTER processing the whole message batch. A batch that
overran Pub/Sub's 60s ack deadline (or errored) got redelivered with the
cursor unmoved → the SAME messages reprocessed forever, each calling Claude.

## Fixes shipped
- **#291 (MERGED+deployed)**: webhook now (1) has `MAIA_WEBHOOK_DISABLED=1`
  kill switch (acks 200, does nothing); (2) advances the cursor BEFORE
  processing (idempotent processEmailCommand makes early-advance safe);
  (3) caps MAX_MESSAGES_PER_INVOCATION=15. Both main + staff-account paths.
- **#292 (open)**: GLOBAL Claude circuit breaker. lib/anthropic-guard.ts
  `assertClaudeBudget()` called before EVERY anthropic.messages.create (12
  sites). Controls: `MAIA_AI_DISABLED=1` hard kill ALL Claude calls;
  rolling cap `MAIA_AI_CALLS_PER_5MIN` (default 250) counted in Postgres
  (global across instances). Fails OPEN on DB error. NEEDS migration
  20260606_ai_call_circuit_breaker.sql (ai_call_log + record_ai_call) to ARM.
  Twilio messages.create deliberately NOT guarded.

## Emergency levers (fastest → slowest)
1. Pub/Sub subscription maia-inbox-push → Edit → Delivery type Push→Pull
   (user did this 2026-06-06 — instantly stops webhook being called; switch
   back to Push to resume MAIA email processing).
2. `MAIA_WEBHOOK_DISABLED=1` env (after #291 deploy) — webhook no-ops.
3. `MAIA_AI_DISABLED=1` env (after #292 deploy+migration) — blocks ALL Claude.

## Resume checklist after an incident
Deploy fixes → apply #292 migration → re-add Anthropic credits → flip Pub/Sub
back to Push → watch webhook logs (small processed counts, no storm).
