---
name: MAIA — CINC vs RENTVINE scope split
description: Two distinct work-order streams that must NOT be mixed. CINC = HOA common areas. RENTVINE = inside-unit residential maintenance.
type: project
originSessionId: b16bfc3a-92c5-4a85-a967-dec872cf637a
---
The maia-platform has two integration backends for work orders / tickets, with strictly disjoint scopes:

**CINC = association/HOA work orders** — common areas only.
- Examples: paint the exterior of a building, repair a roof leak in the shared roof, fix a wall in a common hallway, repair the pool gate.
- Counterparty: the HOA association manages these.
- The association does NOT manage anything inside an individual unit.

**RENTVINE = residential rental-unit work orders** — inside-unit maintenance for properties PMI manages as a landlord.
- Examples: tenant reports a plumbing leak in their unit, oven not working, A/C broken in their apartment.
- Counterparty: PMI as property manager for the rental tenant.

**Why:** PMI runs two distinct service lines under the same brand. An association resident and a Rentvine tenant are different counterparties with different concerns. Mixing the two on the dashboard or in MAIA's AI replies confuses staff and frustrates customers.

**Current gap (as of 2026-05-11):** Only the CINC personas exist in the app — the Rentvine residential-management personas have NOT been built yet. There is no way for MAIA to tell a Rentvine tenant from an HOA-association tenant today. Until the Rentvine personas (lookup against Rentvine residents, distinct portal, distinct OTP flow) are added, persona-aware skill routing and source-aware work-order routing cannot work end-to-end. The CINC ↔ Rentvine architectural split exists in `integration_outbox.target` and in the lib/integrations layer, but the upstream "who is the sender" decision is currently CINC-only.

**Design decisions (confirmed by user 2026-05-11) for Rentvine persona work:**
1. **Person overlap (HOA owner + Rentvine tenant)** — does not happen in practice today. The lookup can assume single-source matches; no merge/dual-context logic needed.
2. **Table naming** — preferred schema is `hoa_tenants` (rename of current `tenants`) and `residential_tenants` (new, for Rentvine). The existing `tenants` references throughout the codebase need to be renamed as part of the persona work. This is a non-trivial refactor (migration + code-wide find/replace + RLS policy updates) and should be its own PR before the Rentvine persona PR.
3. **Caching strategy** — sync via cron is fine. Tenancy/ownership churn is <5 changes/month in practice. The existing `app/api/cron/sync-rentvine-tenants/route.ts` is the right pattern; lookups can hit the local cache table, not Rentvine API live.

**How to apply:**
- **UI**: ticket/work-order lists must show CINC and RENTVINE as separate streams (separate views, tabs, or filters). Do not co-mingle them in a single feed.
- **Skills / AI responses**: MAIA's freeform reply prompts must branch on context — if the sender is a tenant of a Rentvine-managed unit, respond with unit-maintenance framing (route to RENTVINE work orders). If the sender is an owner/resident of an HOA association, respond with common-area / association-board framing (route to CINC work orders).
- **Integration architecture**: the existing CINC outbox pattern (`integration_outbox` + `drain-integration-outbox` cron + `lib/integrations/cinc.ts`) handles CINC. RENTVINE work-orders code currently lives inline in `app/api/webhook/route.ts` (WhatsApp/SMS handler) — when migrating RENTVINE to the outbox pattern, keep the streams architecturally separate (e.g., target column in `integration_outbox` is already `'cinc' | 'rentvine'`, but the UPSTREAM trigger logic must also branch on persona to choose the correct target).
- **Skill files** under `supabase/skills/` may need to be split or to include persona/source branching: a tenant-troubleshooting skill should NOT be invoked for an HOA resident asking about common-area paint.
