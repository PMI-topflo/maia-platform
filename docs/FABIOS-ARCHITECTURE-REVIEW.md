# FabiOS × MAIA — Architecture Review

_Prepared 2026-08-31. Scope: inspect the real MAIA codebase and answer the full FabiOS design brief (sections A–AF as requested). All file:line citations below were verified by reading the actual code, not inferred._

**Bottom line up front:** MAIA today is a single Vercel-deployed Next.js 16 monolith with Supabase Postgres, no Docker/VPS, no Redis, no vector database, no n8n, no OpenClaw, and no Follow Up Boss integration of any kind. Gmail and Google Drive are both live and well-built, but purely *operational* and *reactive* — there is no historical ingestion, no embeddings, no RAG, and no export surface today. Everything FabiOS needs from MAIA (sanitized knowledge feed, contact audience, media feed) has to be built new; almost none of it can be repurposed as-is. That's good news for isolation (there's nothing to accidentally over-expose) and bad news for speed (there's no existing knowledge-extraction machinery to lean on).

---

## A. Existing MAIA Architecture Summary

- **Stack**: Next.js 16.2.2 App Router, React 19, TypeScript 5 strict, Supabase Postgres (RLS), Tailwind 4. Deployed to Vercel (Node 22.x), zero other compute.
- **Personas/auth**: 6 personas — `owner | board | staff | tenant | unit_manager | building_manager` (`lib/session.ts:13`, `middleware.ts:4`) — via HMAC-SHA256 session tokens (Web Crypto, Edge-compatible, `lib/session.ts:37-65`). CLAUDE.md's "3 personas" describes the 3 portal *routes*; the session layer actually supports 6 roles.
- **Core domain**: association/unit/owner/tenant management, application (leasing/purchase) pipeline with e-signature and board approval automation, tickets/work orders, invoicing/CINC accounting sync, compliance document tracking, recurring vendor services.
- **No microservices, no separate workers, no message bus** — everything is Next.js API routes + Vercel Cron (22 scheduled jobs in `vercel.json`) + a Postgres-table outbox (`integration_outbox`, drained by cron every minute) for retryable external syncs.
- **AI usage today**: Claude Haiku (`claude-haiku-4-5-20251001`) for structured parsing, Claude Sonnet (`claude-sonnet-4-5-20250929`) for freeform conversation/vision/document-scan accuracy; Gemini Flash narrowly for lease/Sunbiz PDF parsing on the public `/apply` form. No agent framework, no multi-agent orchestration, no memory/RAG layer in production.

## B. Existing Infrastructure We Can Reuse

Genuinely reusable, low-risk:
- **Supabase project pattern** — RLS + anon/service-role split, the `_TEMPLATE_new_table.sql` GRANT convention, `lib/migration-status.ts` drift-detection registry. FabiOS should follow the identical convention in its **own** Supabase project, not the same one (see J).
- **HMAC session library shape** (not the same secret/cookie) — `lib/session.ts` is a clean, Edge-safe pattern worth copying for FabiOS's own approval-link/dashboard auth.
- **Outbox pattern** (`lib/integrations/outbox-handler.ts`) — a proven, no-infra way to do retryable async delivery on Vercel without Redis/SQS. FabiOS's MAIA→FabiOS event delivery should use this exact shape.
- **Claude Sonnet/Haiku prompt patterns** for structured extraction (`lib/maia-command-processor.ts`) — directly transferable to the Historical Knowledge Agent's extraction prompts.

Not reusable as-is (see V): Gmail OAuth grant, Drive service account, CINC/RentVine credentials, Supabase project itself, session secret, any staff-facing route.

## C. Gmail Integration and 9-Year Historical Knowledge Opportunity

**What exists** (`lib/gmail.ts`, `app/api/maia-email/webhook/`, `lib/maia-command-processor.ts` — 2,728 lines, not ~1,000 as CLAUDE.md states; worth a doc fix):
- OAuth2 refresh-token flow (not a service account) against one main mailbox (`maia@pmitop.com`) plus N individually-connected staff Gmail accounts (`staff_gmail_accounts` table). Scopes are read/write (send, get, watch, history, attachments) — not read-only.
- **Reactive only**: Pub/Sub push → `historyId` delta fetch → `processEmailCommand()`. A full-inbox listing function exists (`listAllInboxMessageIdsWithToken`) but is used only for dashboard reconciliation, not bulk historical ingestion.
- Thread reconstruction exists (`fetchGmailThread` by `threadId`), message-ID dedup exists (`gmail_message_id` columns), attachments are fetched and stored in Supabase Storage (`vendor-docs`, `application-docs`, `buyer-docs` buckets).
- **No embeddings, no vector store, no historical index, no full 9-year archive scan of any kind exists today.** The only "vector"/"pgvector" mentions in the repo are in a deferred customer-voice-agent planning doc, unrelated to this project.
- Privacy today = a sender-domain allowlist (`ALLOWED_DOMAINS`, `lib/maia-command-processor.ts:35`) gating who can trigger DB-writing commands; there is no content redaction, PII masking, or confidentiality classification anywhere in the Gmail path.

**The opportunity**: Gmail API scopes already in use (`gmail.readonly`-equivalent access is implicit in the granted OAuth app) can support a bulk historical crawl of the *same* authorized mailbox(es) — this is a new batch job, not new access. 9 years of `@topfloridaproperties.com`/`@pmitop.com` mail is reachable with `users.messages.list` + pagination, using the same refresh token already in `GMAIL_REFRESH_TOKEN`. **This must run as a separate, throttled, one-time (then incremental) batch process — never inline in the existing webhook path**, and its extraction/classification prompts should be new work in the MAIA repo (Layer 2), never handed to FabiOS as raw export.

## D. Follow Up Boss Integration and Historical CRM Opportunity

**Confirmed: Follow Up Boss is not integrated at all.** Exhaustive case-insensitive grep across code, docs, `.env.example`, and all 208 migrations returns zero hits — no env var, no client, no route, no roadmap/backlog mention, not even a stub. This needs an honest correction to any assumption that ingestion "already exists."

What exists instead, which is *not* a CRM:
- **CINC** (`lib/integrations/cinc.ts`, `CINC_API.md`) — the property-management back-office system of record: accounting, homeowner ledgers, work orders, vendors, violations, documents. OAuth2 client-credentials. Not a lead/sales pipeline.
- **Dialpad** (`lib/dialpad.ts`, `lib/dialpad-ingest.ts`) — real call/SMS ingestion, matched to existing `owners`/`association_tenants` by phone number. This is the closest thing to "communication history," but it's telephony logs tied to already-known operational contacts, not sales leads.
- Two marketing-site intake forms (`app/api/vendor-inquiry`, `app/api/agent-inquiry`) exist but **only send an email — neither persists a lead row anywhere.** There is no structured lead/prospect table in the schema at all (`unit_tenant_contacts` is the only contact-shaped table, and it's leasing-compliance data, not sales).

**Recommendation**: if a real Follow Up Boss account with 9 years of history exists, it must be independently confirmed with the user before any build — this report found zero evidence it's technically connected to anything in this codebase. If confirmed, FUB's own API (Basic Auth, API key as username) is straightforward to integrate read-only from a new, isolated ingestion job — but nothing here should be built against unverified assumptions about what data FUB actually holds. Treat this as **Phase 1 discovery**, not Phase 1 build.

## E. Google Drive Knowledge Opportunity

**What exists** (`lib/drive-invoice-mirror.ts`, `lib/drive-import.ts`, `lib/drive-organize-folders.ts`):
- Service account + domain-wide delegation (`GOOGLE_DRIVE_IMPERSONATE`), full `drive` scope (not `drive.file`, deliberately, so it can see human-created folders). Real create/list/get/export/organize operations — this is a mature integration, not upload-only.
- Per-association Drive trees: `associations.official_folder_id/archive_folder_id/ongoing_folder_id`, with per-unit subfolders and dated/category subfolders below.
- **Explicitly documented gap** (`supabase/migrations/20260517_association_documents.sql:12-15`): *"Drive links are tracked but not auto-scanned today — that requires Drive API read access which is a separate piece of work."* PDF text extraction (`pdf-parse`) exists only for specific intake pipelines (invoices, lease/application documents), never as general Drive-content indexing.
- **No embeddings/RAG over Drive content anywhere.** No deliberate EXIF-stripping, face-detection, or image-redaction policy exists — `sharp().rotate()` strips some EXIF only as an incidental side effect of recompression, not as a designed privacy control.

**The opportunity**: the folder taxonomy (Official/Archive/On-Going per association/unit) is exactly the kind of structure a document-classification job can walk safely, since it already separates by association — a scanner can be scoped per-association and explicitly skip anything under signed-lease/financial/legal subfolders. This is real, usable structure; it just isn't connected to anything today.

## F. Existing Operational Integrations

| Integration | Status | Notes |
|---|---|---|
| CINC | **Live** | Core PMS: accounting, ledgers, work orders, vendors |
| Gmail | **Live** | OAuth, main + per-staff mailboxes, Pub/Sub-driven |
| Google Drive | **Live** | Service account + domain-wide delegation |
| Stripe | **Live (production)** | Confirmed 2026-07-13 |
| Resend | **Live** | Primary transactional email, webhook wired |
| Twilio (SMS/WhatsApp) | **Live** | Approved WhatsApp templates |
| Dialpad | **Live** | Call/SMS ingestion, phone-matched to contacts |
| Checkr | **Live, 2 open blockers** | Key mode (test vs live) unverified; `essential` package missing credit/eviction data — do not flip any association to it |
| RentVine | **Partial/broken** | Tenant-sync cron dead since 2026-06-17; outbox has an unimplemented handler slot |
| Follow Up Boss | **Not integrated** | Zero references anywhere |
| Google Calendar | **Not used** | Zero code references |
| Zoom | **Not integrated** | No code found |
| n8n | **Not present** | Only mentioned once, in a deferred planning doc, as explicitly rejected for now |
| OpenClaw | **Not present** | Zero references |
| Vector DB (any) | **Not present** | Zero references outside a deferred planning doc |

## G. Work Order / Photo Integration Possibilities

`tickets` + `work_order_details` + `work_order_attachments` (`lib/tickets.ts`, `lib/work-order-attachments.ts`) is a mature system: statuses, vendor assignment, CINC mirroring, a vendor-facing token-gated upload page (`app/vendor/upload/[token]`), and `phase` tagging (`before`/`after`) on photos in the private `work-order-photos` Supabase Storage bucket.

**Gaps that matter for FabiOS**, all confirmed absent:
- No confidentiality/marketing-eligibility flag on tickets or on `work_order_attachments` — resident name/email/phone and complaint text live in the same rows as photo metadata.
- No controlled category vocabulary — `ticket_category`/`service_type` are free text, not a marketing-ready taxonomy.
- No external export surface of any kind — every `*-webhook` route is inbound only.
- `ticket_messages.direction` (`inbound|outbound|internal_note`) is a **CINC-visibility** distinction, not a public/private classification usable for marketing export.

This confirms the brief's instinct exactly: nothing here should be exposed directly. A marketing-eligible work-order feed needs a **new** classification pass (Section H) that tags phase + category + strips PII before anything reaches a FabiOS-visible store.

## H. Proposed MAIA Historical Knowledge Processing Layer

New, MAIA-side-only components (all live inside the existing Supabase project and Vercel cron infrastructure — no new infra needed for this layer):

1. **Ingestion jobs** (new, batch, throttled, run under MAIA's existing Gmail/Drive credentials — never new credentials for FabiOS):
   - `gmail-historical-crawl` — one-time backfill + incremental cron, walks `users.messages.list` across the full mailbox history, writes raw (still-confidential) rows into a new `internal.email_archive` table (not `public.*` — never grant this to anon/authenticated).
   - `drive-historical-scan` — walks each association's Official/Archive tree (skip anything flagged financial/legal by folder name pattern), extracts text via the existing `pdf-parse` pipeline, writes to `internal.document_archive`.
   - `fub-historical-import` (Phase 1 discovery gated, see D).
2. **Classification/extraction pass** (Claude Sonnet, same pattern as `lib/maia-command-processor.ts`'s structured-parsing prompts): thread reconstruction → entity recognition (names, unit numbers, association names, dollar amounts, dates) → PII/confidentiality scoring → topic/question/answer/resolution extraction → anonymization → writes to `internal.knowledge_candidates`.
3. **Human-reviewable staging**: nothing auto-promotes to the FabiOS-visible layer. A `/admin/fabios-knowledge` staff screen lists `knowledge_candidates` with the classification (below) for one-click approve/reject before anything crosses the boundary — mirrors the existing "approval workflow" pattern already used for board decision letters and reminder approvals elsewhere in MAIA.
4. **Approved knowledge store** (`public.fabios_knowledge_records`, GRANT'd per the `_TEMPLATE_new_table.sql` pattern, but readable only by a FabiOS-specific restricted role — see J) — this is the only table FabiOS ever touches.

## I. Privacy / Anonymization Architecture

Recommended 5-class system (the brief's own proposal, tightened):

| Class | Definition | FabiOS access |
|---|---|---|
| **1 — Public/Safe** | Generic educational content, no case reference | Free to quote/publish verbatim |
| **2 — Anonymized Experience** | Real scenario, all identifying details (names, addresses, unit numbers, association names, dollar amounts, dates within 90 days) stripped or generalized | Can be quoted/published |
| **3 — Internal Reasoning Only** | Useful pattern/frequency signal, but re-identifiable if published verbatim (e.g., a rare fact pattern with only 1-2 occurrences) | FabiOS can use for strategy/topic selection, **never** quote directly |
| **4 — Confidential** | Financial data, SSNs, background checks, applications, banking, personnel | Never leaves MAIA; not even summarized |
| **5 — Privileged** | Attorney-client, active disputes, litigation-adjacent | Never leaves MAIA; excluded from automated processing entirely, flagged for human-only review if ever needed |

**Improvements over the brief's draft**:
- **k-anonymity floor on Class 2**: require ≥3 independent source occurrences (source_count ≥ 3) before a pattern can be labeled Class 2 "anonymized" — a single incident, however well-scrubbed, is often re-identifiable to anyone who knows the property. A 1-2-occurrence pattern is automatically Class 3, regardless of how well it's scrubbed.
- **Automatic downgrade rule**: any record touching money amounts tied to a specific unit/owner, litigation keywords ("attorney," "lawsuit," "demand letter," "cease and desist"), or Checkr/background-check content is auto-classified Class 4/5 by keyword+entity detection before the LLM classification pass ever runs — belt-and-suspenders, not LLM-judgment-only.
- **Re-review cadence**: Class 2/3 records expire and require re-classification after 24 months, since "anonymized" facts can become re-identifiable as circumstances change (e.g., a board turns over, a property sells).
- Classification is a **write-time gate at Layer 3** (Section H step 3), never a read-time filter FabiOS applies itself — FabiOS should structurally be unable to see Class 3/4/5 records at all, not merely instructed not to use them.

## J. MAIA → FabiOS Security Boundary

Recommended combination (the brief's Option A + B + D, explicitly rejecting C and E for this stage):

- **Option B (separate knowledge database)** is the backbone: FabiOS reads from a **separate Supabase project** (not the MAIA production project, not even a schema-isolated table in the same project) that MAIA writes into via a service-role key MAIA holds and FabiOS never sees. This is the single most important isolation decision — a compromised FabiOS credential must be structurally incapable of reaching MAIA's production database, Gmail, Drive, or CINC.
- **Option A (sanitized event API)** layered on top: MAIA exposes one narrow, authenticated webhook (`POST /api/fabios/events`, guarded by a dedicated `FABIOS_WEBHOOK_SECRET`, distinct from every other internal secret) that fires only on human-approved Layer-3→4 promotions (Section H step 3/4) — this gives FabiOS near-real-time updates without needing to poll or hold broad read access.
- **Option D (approved media folder)** for photos/documents: a dedicated Google Drive folder (or Supabase Storage bucket) that MAIA copies *already-approved, already-stripped* media into — FabiOS's Drive/Storage credentials only ever see this one folder, never the operational trees.
- **Explicitly rejected for now**: Option C (message bus) — adds infra (Redis/SQS) for no benefit at MAIA's current volume; the Postgres outbox pattern already in use (Section B) does the same job. Option E (FabiOS calls into a MAIA API) — inverts the trust direction unnecessarily; push-on-approval from MAIA is strictly safer than give-FabiOS-a-key-to-pull.

## K. Recommended FabiOS Architecture

Given B's finding — no VPS, no Docker, nothing to build on inside MAIA's own environment — FabiOS should be a **fully separate deployment**, not layered onto Vercel:

- Small VPS (see Z) or a managed container platform (Render/Fly.io/Railway are lower-ops alternatives to a bare VPS if the team doesn't want to own Docker/Compose operations).
- Its own Postgres (Supabase project or self-hosted — a second Supabase project is simplest given the team already knows the tooling).
- Its own object storage for generated media (Supabase Storage in that same second project, or S3-compatible).
- Its own secrets for every third-party API (WordPress, social platforms, video-gen, email-sending) — see V.

## L. Recommended OpenClaw Role

OpenClaw is unproven in this codebase (zero prior usage) and adds real operational surface: agent isolation, secrets management, tool-permission model, logging/auditability all need to be stood up from scratch regardless of framework choice. Given the team already has a working, understood pattern in MAIA itself (Claude SDK calls + structured prompts + Postgres-backed state, no framework), the lower-risk Phase 1 choice is: **skip OpenClaw initially, build the FabiOS agents as the same pattern MAIA already uses** (direct Claude API calls with typed system prompts + tool definitions, orchestrated by plain TypeScript/Node functions, not a third framework). Revisit OpenClaw in Phase 2 only if agent count and inter-agent handoff complexity genuinely outgrow hand-rolled orchestration — introducing an unfamiliar orchestration framework at the same time as a brand-new data-sensitive pipeline compounds risk for no proven benefit yet.

## M. Recommended n8n Role

n8n has no existing footprint either, but its use case (deterministic workflows: publish-to-WordPress, publish-to-social, scheduled sends, retries, status logging) is a much better fit for a low-code tool than for hand-written code, *if* non-engineering staff will ever need to see or adjust a workflow (e.g., Fabio himself adjusting a publishing schedule). Recommendation: stand up n8n on the same small VPS as FabiOS's other services, scoped to exactly the responsibilities the brief lists (API calls, file movement, scheduled jobs, publishing, notifications) — never given direct access to MAIA's Gmail/Drive/database credentials; it only calls FabiOS's own API, which enforces the boundary from K.

**Split, confirmed as sound**: OpenClaw/hand-rolled-agents = reasoning/strategy/content decisions; n8n = deterministic execution/plumbing; dedicated ESP = actual bulk sending. This is a good separation — keep it.

## N. Recommended Database / Storage Architecture

Building on the brief's entity list, with additions/consolidations:

- `knowledge_sources`, `knowledge_records` (with `privacy_class`, `source_count`, `provenance` jsonb — see AB), `knowledge_topics`, `content_ideas`, `articles`, `social_posts`, `videos`, `translations`, `platforms`, `publishing_jobs`, `approvals`
- `media_assets` (photos/documents received from MAIA's approved-media handoff, with `source_ticket_ref` — an opaque hash, never the real ticket ID)
- `contacts`, `audience_segments`, `suppression_list`, `email_campaigns`, `email_events`, `lead_scores`, `campaign_engagement` (feeds back to FUB per AE)
- `research_papers`, `monthly_reports`
- `ai_visibility_tests`, `competitors`, `keywords`, `citations`
- **Add**: `approval_audit_log` (every human approval, who/when/what, across content AND email — the brief's compliance requirements in Q/O need this to exist as a first-class table, not just implied)
- **Add**: `mia_event_log` (every inbound event/record received from MAIA, with the MAIA-side idempotency key) — required so a MAIA replay or retry never double-creates content

## O. Recommended Content Approval Workflow

Two independent gates, matching the brief's own risk split:
1. **Content gate**: auto-publishable only for Class 1/2 knowledge with no legal/compliance/dispute keywords; anything touching Florida law, insurance, compliance claims, or a specific property/association name requires the Research/Compliance Agent's sign-off *and* human approval before publish — no exceptions, ever, regardless of content-strategy urgency.
2. **Email gate**: no bulk campaign sends automatically in Phase 1, full stop, per the brief. The approval screen must show: audience size by segment, language breakdown, suppression-list exclusions applied (with count), and a rendered preview per language, before any Approve button is enabled.

## P. Recommended Multilingual Architecture

Localization (not translation) as a distinct agent step, informed by the language signal (see Q) — English/Spanish/Portuguese each get their own prompt with explicit audience framing (South Florida owners/boards for Spanish, Brazilian investors for Portuguese, as the brief itself identifies), not a single "translate this" pass. Store `translations` keyed to a `master_content_id` + `language` + `locale_variant` (e.g., `pt-BR` explicitly, not generic `pt`).

## Q. Recommended Email Outreach Architecture

Segments and fields per the brief's own list are sound; two additions:
- **`consent_basis`** field (not just `marketing_consent_status`) — record *why* a contact is eligible (existing business relationship, opt-in form, public professional contact) since CAN-SPAM's existing-business-relationship exception has a time limit and international recipients may need stricter consent tracking (CASL for Canadian contacts, in particular, if any investor contacts are Canadian).
- **`last_meaningful_contact_date` alone is not enough for CAN-SPAM** — track `first_added_date` and `source_type` too, since suppression obligations depend on origin, not just recency.

## R. Recommended Email Sending Platform

Given deliverability is explicitly a stated concern and Gmail/Workspace is explicitly ruled out for bulk sending: use a **dedicated ESP with strong API-first deliverability tooling and native suppression/webhook support** — Resend (already proven in MAIA, same team familiarity, strong API) or Postmark/SendGrid/Amazon SES are all reasonable; the deciding factor should be whichever has the best built-in suppression-list + multilingual template management, not raw cost. Recommend a dedicated sending subdomain, e.g. `news.fabiosetton.com`, with its own SPF/DKIM/DMARC (start DMARC at `p=none` while warming, move to `p=quarantine` once volume is stable), a separate tracking subdomain (e.g. `track.fabiosetton.com`), reply-to routed to a real monitored inbox (not `no-reply@`), and a deliberate warm-up ramp (start at a few hundred sends/day, double roughly weekly) before the first full-list monthly send.

## S. Recommended Analytics / Reporting Architecture

Aggregate at the FabiOS database layer (N) — never re-derive from MAIA. Weekly/monthly reports (per the brief's Executive Reporting Agent) should be generated as a scheduled n8n job that queries FabiOS's own tables plus pulls from each platform's own analytics API (social, WordPress, ESP) — no new infra beyond what's already proposed.

## T. Proprietary Research / Data Opportunities

The strongest, most defensible research angle is **operational data MAIA already has structured** (Section G/CINC), not the unstructured Gmail/FUB corpora — because it's already queryable without an LLM extraction pass. Concretely available today, once anonymized/aggregated:
- Application processing time-to-decision (from the fully-instrumented application pipeline — `lib/application-dashboard.ts` already computes stage/turnaround per application)
- Work-order category frequency + resolution time (from `tickets`/`work_order_details`, already has `status`, timestamps, category)
- Board response/approval-letter turnaround (from the board-decision-letter automation)
- Delinquency/collections patterns (CINC ledger data already ingested)

These require far less new pipeline than the Gmail 9-year corpus and can produce the first 1-2 "South Florida Property Management Report" issues before the harder historical-email work is even done — a good Phase 1 quick win.

## U. Services Safe to Share With FabiOS

| Service | Classification | Why |
|---|---|---|
| Pattern/convention reuse (session lib shape, outbox pattern, migration-GRANT template) | **SAFE TO SHARE** | Code patterns, not live credentials or data |
| Approved-knowledge database (Section H/J) | **SHARE WITH ISOLATION** | Separate project, one-way write, FabiOS never writes back except via the explicit feedback API (AE) |
| Approved-media folder/bucket | **SHARE WITH ISOLATION** | Separate folder/bucket, separate credential, MAIA-controlled copy-in only |
| Claude/Gemini API access | **SHARE WITH ISOLATION** | FabiOS should have its **own** Anthropic/Google API keys, even though the vendor is the same — never reuse MAIA's key (blast radius, billing separation, rate-limit isolation) |

## V. Services That Must Remain Separate

Absolute, no exceptions: MAIA production Supabase project/credentials, Gmail OAuth grant (`GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN`), Google Drive service account (`GOOGLE_SERVICE_ACCOUNT_JSON`), CINC/RentVine/Checkr/Stripe/Dialpad/Twilio credentials, `MAIA_SESSION_SECRET`, `CRON_SECRET`, `INTERNAL_API_SECRET`, any Follow Up Boss credential if one is confirmed to exist, WordPress admin credentials, social-platform tokens, video-gen (HeyGen/ElevenLabs/etc.) API keys, the FabiOS ESP's own sending credentials. Each of these should live in its own secret store, scoped to only the one service that needs it — a FabiOS compromise must not be able to pivot into MAIA, and vice versa.

## W. Missing Components We Need to Build

Everything in Section H (all four pipeline stages), plus: Gmail historical crawl job, Drive historical scan job, PII/entity-detection classifier, the staff approval UI for knowledge promotion, the FabiOS event-receiver API, the approved-media copy job, the entire FabiOS application itself (agents, database, publishing integrations), the dedicated ESP setup + domain warm-up, the FUB integration (pending discovery), and the AI-visibility monitoring benchmark-prompt harness (Section on AI Visibility Agent — nothing like this exists anywhere today).

## X. Risks / Technical Debt in MAIA That Could Affect FabiOS

- **CLAUDE.md is stale in at least one material way**: `lib/maia-command-processor.ts` is 2,728 lines, not "~1000" — worth fixing so future sessions (and this project) don't under-estimate its complexity.
- **RentVine tenant sync has been silently dead since 2026-06-17** — if any FabiOS research/reporting angle assumes RentVine data is current, it isn't.
- **Checkr's `essential` package is missing credit/eviction data**, unresolved — any "Property Management Technology Report" content mentioning background-check completeness should not cite Checkr capabilities until this is resolved.
- **No confidentiality flag anywhere in the ticket/work-order/document schema** (Section G) — building the Layer 2 classifier is genuinely new work, not a matter of flipping on an existing flag.
- **Gmail webhook path has had real incident history around sender-matching edge cases** (per `docs/SESSION-HANDOFF.md`) — the historical-crawl job must not reuse the live webhook's assumptions uncritically; it needs its own review since it operates on 9 years of varied correspondents, not a known allowlist.

## Y. Phase 1 / Phase 2 / Phase 3 Build Plan

**Phase 1 (foundation, ~4-6 weeks)**: separate FabiOS Supabase project + minimal schema (N); MAIA-side Layer 2/3 classifier + staff approval screen (H); event-receiver API + approved-media folder (J); first proprietary report from already-structured CINC/ticket data (T) as a proof of concept, published manually (no FabiOS agents yet); FUB discovery conversation with the user to confirm what, if anything, actually exists (D).

**Phase 2 (FabiOS core, ~6-10 weeks)**: stand up FabiOS VPS + n8n; build the core agents (Historical Knowledge, Content Strategy, Research/Compliance, Multilingual, Publishing) as hand-rolled Claude-API orchestration (L); Gmail historical crawl + classification running on a schedule; ESP setup + domain warm-up begins in parallel (needs lead time); first automated monthly-report → website → social pipeline, still human-approved at every publish.

**Phase 3 (scale, ongoing)**: Email Outreach Agent + audience segmentation once ESP is warmed and suppression list is populated; Video Production Agent; AI Visibility Agent + benchmark tracking; Analytics/Executive Reporting Agent; FUB feedback loop (AE) if FUB integration was confirmed and built in Phase 1/2; revisit OpenClaw only if agent orchestration complexity has genuinely outgrown the hand-rolled approach.

## Z. Estimated VPS / Infrastructure Requirements

A single mid-tier VPS (4 vCPU / 8GB RAM / 100GB+ SSD — e.g., a $40-80/mo tier from Hetzner/DigitalOcean/Linode) comfortably runs n8n + the FabiOS API/agent orchestration process for the traffic levels implied here (a handful of agents run on a schedule, not high-QPS). Video rendering, if done via HeyGen/Creatomate/Shotstack APIs rather than local rendering, adds no local compute load — those are external API calls. Budget separately for: a second Supabase project (free tier likely sufficient early, Pro ~$25/mo once volume grows), the ESP (volume-dependent, budget ~$50-150/mo to start), and per-call costs for Claude/Gemini/video-gen/voice APIs (usage-based, not fixed).

## AA. Recommended Historical Gmail / Follow Up Boss Ingestion Strategy

**Gmail**: one-time backfill via `users.messages.list` pagination (respect Gmail API rate limits — batch with backoff, similar to the existing outbox pattern's `[1,5,15,60,240]`-minute retry shape), writing raw content into an `internal.*` (never `public.*`) table, never touched by anything outside MAIA. Run the classification pass (Section H step 2) incrementally afterward, not as part of the crawl itself, so a slow/expensive Claude pass never blocks or risks the ingestion job. Rate-limit the crawl explicitly to avoid disrupting the live webhook path's quota.

**Follow Up Boss**: gated entirely on confirming the integration is real and getting API credentials (D) — do not schedule engineering time for this until that's confirmed.

## AB. Recommended MAIA → FabiOS API / Event Schema

```json
{
  "knowledge_id": "know_c9f1a2...",
  "event_type": "knowledge.approved",
  "source_type": "gmail | drive | work_order | cinc_aggregate | fub",
  "source_period": "2021-01 to 2026-08",
  "number_of_similar_cases": 14,
  "category": "condo_maintenance",
  "privacy_class": 2,
  "confidence": "high",
  "geographic_area": "South Florida",
  "language": "en",
  "topic": "Condo maintenance responsibility",
  "question": "...",
  "context": "...",
  "resolution": "...",
  "content_potential": ["faq", "short_video", "board_education_post"],
  "anonymized": true,
  "approved_by": "staff_email_hash",
  "approved_at": "2026-08-31T14:00:00Z"
}
```
Never included: any name, email, phone, unit number, association name, dollar figure tied to a specific party, or raw message content. `approved_by` is hashed, not the literal staff email, since FabiOS has no legitimate need to know which staff member reviewed a given record.

## AC. Recommended Marketing Contact / Suppression Architecture

Central `suppression_list` in the FabiOS database (never in MAIA), keyed by hashed-email + reason (`unsubscribed | bounced | manual | legal`), checked before every campaign send — the ESP's own suppression list should be treated as the enforcement layer, with FabiOS's local table as the audit trail feeding it. `consent_basis` and `first_added_date` (Section Q) travel with every contact from the moment MAIA hands it over.

## AD. Recommended Monthly Research Paper Workflow

Matches the brief's own diagram closely; the one addition: insert an explicit **"does this cite anything from Class 3/4/5 knowledge, even indirectly"** check at the Research/Compliance Agent step, before human approval — an LLM drafting from aggregate statistics can accidentally reconstruct a specific, re-identifiable case if not explicitly checked against the source records' privacy class.

## AE. Recommended Lead Detection / Follow Up Boss Feedback Loop

Structurally identical to the brief's design — FabiOS detects a high-intent signal, classifies the lead, and pushes a narrow, structured update (engagement score, content interests, language, last-interaction date) into FUB via API, never raw browsing/email history. This entire section is gated on D being resolved first.

## AF. Files / Code / Configuration to Share With ChatGPT for a Second Architecture Review

**Safe to share** (structure/config only, no secrets, no business content):
- This document itself (`docs/FABIOS-ARCHITECTURE-REVIEW.md`)
- `CLAUDE.md`, `README.md`, `AGENTS.md` (architecture/convention docs)
- `package.json` (dependency list only — no `package-lock.json`, it's noisy and unnecessary)
- `vercel.json` (cron schedule/paths only — no secret values, there are none in this file)
- `.env.example` (variable **names** only — it already contains no real values, safe as-is)
- `supabase/migrations/_TEMPLATE_new_table.sql` (the GRANT convention)
- A folder tree listing (`find app lib -type d` output) — structure, not content
- File-name-only listing of `supabase/migrations/` (to show schema evolution without exposing content)
- Route list: `find app/api -name route.ts` (paths only, not file contents, unless a specific route's logic needs review)
- This session's summary text of the 5 explore-agent findings (Sections C–G above already are that summary, sanitized)

**Do NOT share**: any file under `lib/` or `app/api/` in full (they contain real business logic and, in some comments/test data, real association/unit names — e.g., "MANXI," "VPCI" appear throughout as real client names); `docs/SESSION-HANDOFF.md` and `docs/ROADMAP.md` in full (contain real incident details, real names like "Susie Bell," "Monica Blumenfeld," real unit numbers); any migration file content beyond filenames (some contain real seeded data); `CINC_API.md` (documents a live vendor integration in detail); `COMPLIANCE_TRACKING.md`; anything in `docs/memory-snapshot/` or `docs/specs/`; `maia-business-summary.html` or `vendor-email-preview.html` (real business content); actual `.env` values (there are none checked in, but double-check before export); any `gmail-addon/` file (contains real deployed logic tied to the live mailbox).

**Recommended package to actually hand ChatGPT**: this single document, plus the four bullet points above (CLAUDE.md, package.json, vercel.json structure, .env.example) — that's a complete, real, sanitized architecture picture without exposing a single real client name, association, or credential.

---

## Reuse vs. Isolate — Final Summary

**Reuse the pattern, not the instance**: Supabase/RLS conventions, the HMAC session-token approach, the Postgres-outbox async pattern, and the Claude structured-extraction prompt style are all proven in MAIA and worth replicating in FabiOS's own, separate stack.

**Isolate completely**: MAIA's production database, every credential in `.env.example`, Gmail/Drive/CINC/Checkr/Stripe/Dialpad access, and all resident/owner/financial/legal data. FabiOS should never hold a credential that can reach any of MAIA's live systems — every fact FabiOS ever sees should have already crossed a human-approved, privacy-classified boundary inside MAIA first.
