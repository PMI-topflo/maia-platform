# NEXT_SESSION.md — Handoff brief for the next Claude Code session

> **Read this BEFORE you start exploring.** It captures everything the
> previous session built so you don't have to re-derive the codebase
> from scratch. The 9 pending follow-ups are at the bottom.

---

## TL;DR

The previous session (branch `claude/cinc-sync-import`) shipped a large
chunk of work split across many commits. **Verify all of it is merged
into `main` before you start a new branch** — `git log --oneline
origin/main..origin/claude/cinc-sync-import` should print nothing.

Everything below is now in production:

1. **CINC sync admin** at `/admin/cinc-sync` — onboard new CINC associations,
   side-by-side owners + board diff per association, two-pass matcher,
   per-name-slot reading, E.164 phone normalization, inline edit modal
   for owner emails/phones/language, "View as ↗" staff emulation.
2. **Association documents library** at `/admin/cinc-sync/[code]/documents`
   — upload Condo Docs + Rules PDFs per language, soft-archive versioning,
   audit trail (uploaded_by / archived_by), direct-to-storage upload that
   bypasses Vercel's 4.5 MB body limit.
3. **Application form** (`components/ApplicationForm.tsx`) with inline
   PDF rules display, language switcher per category, "I have read this"
   gate, drawn signature canvas + webcam photo + geolocation + IP capture,
   save-and-continue-later (auto-save + load from `?id=` + emailed
   resume link, with admin resend button).
4. **Smarter parse-lease matcher** (`app/api/apply/parse-lease/route.ts`)
   — matches by association name + property address + landlord/lessor
   name + dropdown tiebreaker.
5. **Owner + board portals** show the same governing documents.
6. **Translation disclaimer** in all 6 languages on non-English apply
   sessions.

---

## Project stack reminders

- **Next.js 16.2.2** App Router. APIs that knowingly differ from your
  training data — read `node_modules/next/dist/docs/` for anything
  Next.js-specific before assuming. Heed deprecation notices.
- **React 19**, **TypeScript 5 strict**.
- **Tailwind 4** + design tokens in `app/globals.css` (`var(--navy)`,
  `var(--gold)`, etc.).
- **Supabase** PostgreSQL with RLS. Use `lib/supabase-admin.ts`
  (service role) on server; instantiate anon client manually on
  client. Env var is **`SUPABASE_SERVICE_KEY`** (not the standard
  `SUPABASE_SERVICE_ROLE_KEY`).
- **`NEXT_PUBLIC_APP_URL`** is the canonical base URL.
- **Anthropic Claude API** via `@anthropic-ai/sdk`. Haiku for
  classification, Sonnet for free-form.
- **Gemini Flash** (`@google/generative-ai`) for PDF extraction in
  parse-lease.
- **Twilio** for SMS/WhatsApp. **`TWILIO_PHONE_NUMBER`** for SMS,
  **`TWILIO_WHATSAPP_NUMBER`** for WhatsApp (different values).
- **Resend** primary email; **Gmail API OAuth** fallback. See
  `lib/gmail.ts` for `sendEmail()`.
- **Stripe** for payments; webhook at
  `app/api/webhooks/stripe/route.ts`.
- **Vercel** deployment, Node 20.x. **4.5 MB serverless function
  body limit** — use the direct-to-storage upload pattern for files
  larger than that (see existing implementation in
  `app/api/admin/associations/[code]/documents/upload-url/route.ts`).
- **No test runner**. Use `npx tsc --noEmit` for type-checking.
- **Path alias** `@/*` → repo root.
- **HMAC-SHA256 session tokens** in `maia_session` cookie.
  `lib/session.ts` uses Web Crypto API to stay Edge-compatible —
  **never import Node's `crypto` module there or in `middleware.ts`**.

---

## Multi-persona model

Three authenticated personas + three "internal" personas:

| Persona | Portal | Login |
|---------|--------|-------|
| `owner` | `/my-account` | OTP via `/` |
| `board` | `/board` | OTP via `/` |
| `staff` | `/admin` | `/admin/login` |
| `tenant` | `/tenant` | OTP via `/` |
| `unit_manager` | `/unit-manager` | OTP via `/` |
| `building_manager` | `/building-manager` | OTP via `/` |

`middleware.ts` enforces. **Staff sessions can access ANY persona's
portal** — that's how the staff-emulation "View as ↗" feature works
(`/my-account?id=<owner_id>&assoc=<code>` works for staff; an orange
banner appears at top to mark emulation).

---

## Key files / modules

### CINC integration
- `lib/integrations/cinc.ts` — OAuth client_credentials auth, token
  cache, work-order endpoints, homeowner endpoints, board members,
  association meta. Token URL: `identity.cincsys.com`. API base:
  `https://PMITFP.cincsys.com/api`.
- `lib/cinc-sync.ts` — diff + apply helpers for `/admin/cinc-sync`.
  Two-pass matcher: strict name match across all slots first, loose
  fallback only for slot 0. Auto-archives prior versions on apply.
  E.164 phone normalization.
- `scripts/probe-cinc-homeowners.ts` — read-only probe with PII
  redaction. Use this to inspect raw CINC payloads safely.
- `scripts/backfill-cinc-timestamps.ts` — Eastern Time conversion
  fix for legacy work order data.

### Documents library
- `lib/association-documents.ts` — types, `CATEGORIES` (currently just
  `condo_docs` + `rules_regs`, scope cut from a 28-category insurance
  taxonomy), `SUPPORTED_LANGUAGES`, helpers.
- `lib/extract-pdf.ts` — pdf-parse v2 wrapper with 20 MB / 1.5 MB-text
  guards. Used inline on upload.
- `lib/governing-docs-for-portal.ts` — server-side helper for owner +
  board portals to fetch current docs with signed URLs.
- `app/api/admin/associations/[code]/documents/route.ts` — GET/POST.
  Auto-archives prior active versions on upload (scoped by category +
  language).
- `app/api/admin/associations/[code]/documents/upload-url/route.ts` —
  signed upload URLs (direct-to-storage to bypass Vercel body limit).
- `app/api/admin/associations/[code]/documents/[id]/route.ts` —
  GET signed download / DELETE / PATCH (archive/restore).
- `app/api/apply/association-documents/route.ts` — PUBLIC. Returns
  grouped-by-category docs with all language versions for the apply
  form.
- `app/api/apply/document-text/route.ts` — PUBLIC. Lazy-loads
  `extracted_text` for the apply form's "Show text version" toggle.
- Storage bucket: `association-documents` (NOT public, 50 MB cap).
  Auto-created by `ensureBucket()`. If it fails the helper now
  returns a useful error message instead of silently flipping to
  "ready".

### Apply form
- `components/ApplicationForm.tsx` — single big component. State
  for: lease parse output, applicants, occupants, docs, governing-
  docs categories, selected language per category, viewed doc IDs,
  typed signature, drawn signature, webcam photo, geolocation,
  applicationId for draft saves.
- `components/SignatureEvidence.tsx` — `<SignaturePad>` (HTML canvas
  + PointerEvents) and `<WebcamCapture>` (getUserMedia + still capture).
- `app/api/apply/save-draft/route.ts` — POST partial state. First
  call creates a placeholder row; subsequent calls update.
- `app/api/apply/load-draft/[id]/route.ts` — GET for resume. Refuses
  to return state for already-paid applications.
- `app/api/apply/send-resume-link/route.ts` — PUBLIC. Cooldown-
  rate-limited (30 min). Auto-sent from save-draft after first email
  capture.
- `app/api/admin/applications/[id]/resend-resume-link/route.ts` —
  STAFF. Bypasses cooldown. Optional email override.
- `app/api/apply/record-signature-evidence/[id]/route.ts` — captures
  drawn sig + photo + geo + server-side IP after the application row
  inserts.

### Admin
- `app/admin/cinc-sync/page.tsx` — index. FM/BK badge column, docs
  count badge (0/1/2+ colors), Onboard buttons for CINC-only assocs,
  Compare + Docs links per row.
- `app/admin/cinc-sync/[code]/page.tsx` — per-association detail with
  the diff client + docs link.
- `app/admin/cinc-sync/[code]/SyncPreviewClient.tsx` — diff client.
- `app/admin/cinc-sync/[code]/documents/page.tsx` + `DocumentsManager.tsx` —
  per-association docs library with upload drop-zone + language picker +
  current/previous version expanders + translations preview card.
- `app/admin/applications/page.tsx` + `ApplicationsTable.tsx` — list +
  detail panel showing acknowledged document IDs, signature evidence
  section (drawn sig image, photo, IP, geo with Google Maps link, UA),
  resume link section (resend button + override email).

---

## Migrations applied as of this handoff

All six should already be in the Supabase DB. Verify before assuming.

| File | What |
|------|------|
| `20260515_cinc_stable_refs.sql` | `cinc_property_id` on owners, `cinc_board_member_id` on association_board_members |
| `20260515_pending_profile_changes.sql` | profile-change approval flow |
| `20260515_pmi_staff_alt_emails.sql` | alt_emails column for staff name resolution |
| `20260515_ownership_history.sql` | audit trail for ownership transfers |
| `20260513_maia_pending_board_updates.sql` | @maia update board members confirmation flow |
| `20260517_association_documents.sql` | docs table + indexes + updated_at trigger |
| `20260517_applications_acknowledged_docs.sql` | `acknowledged_document_ids uuid[]` on applications |
| `20260518_association_documents_versioning.sql` | `archived_at` + `archived_by_email` + partial index for active per-category |
| `20260518_association_documents_language.sql` | `language` column + partial index for active per-(cat, lang) |
| `20260518_applications_signature_evidence.sql` | `rules_signature_image`, `rules_applicant_photo`, `rules_signed_ip`, `rules_signed_user_agent`, `rules_signed_geolocation` |
| `20260518_applications_drafts.sql` | `draft_step`, `draft_data jsonb`, `resume_email`, `resume_link_sent_at` |

---

## Known pre-existing issues (NOT introduced by recent work)

- `components/ApplicationForm.tsx` has long-standing TS errors on
  `leaseData.extracted.entity`, plus `parseError`, `leaseRequired`,
  `uploadLease*`, `entity*`, `married*`, `occupant*`, `rulesTitle*`,
  `rulesConsent`, `rulesSignature*`, `rulesRequired`,
  `marriedCertWillBeRequired`, `addOccupant`, `sendInvite*`,
  `inviteSentLabel`, etc. The pattern: the union type from the 6
  language blocks drops these fields because not every block has them
  (some are EN-only). Cleanup is worthwhile — none block runtime, but
  they make `tsc --noEmit` noisy.
- `app/admin/communications/components/CommunicationsDashboard.tsx` has
  a number type mismatch on `setActiveOwnerId`. Pre-existing.
- `app/api/webhooks/stripe/route.ts` references an undefined
  `getSupabase`. Pre-existing.

When type-checking new work, filter for your file paths to ignore
these:
```bash
npx tsc --noEmit 2>&1 | grep -E "YOUR_NEW_FILE_PATH" | head
```

---

## STATUS UPDATE — 2026-05-20 (READ THIS — the 9 tasks below are partly done)

Sessions on 2026-05-19/20 worked through much of this list plus a large
Communications + messaging overhaul. Current status of the original 9:

| # | Task | Status |
|---|------|--------|
| 1 | CINC work-order pictures | ✅ DONE — CINC WO metadata sync + photo display shipped |
| 2 | Upload photos from MAIA emails → work orders | 🟡 PARTIAL — `work_order_attachments` table exists (source supports `email`); verify the email→WO ingestion path is actually wired |
| 3 | Upload pictures in work orders directly | ✅ DONE — `WorkOrderPhotos.tsx` + `work_order_attachments` (source `staff_upload`) |
| 4 | Application payment + Applycheck | ❌ NOT STARTED — note: `app/api/webhooks/stripe/route.ts` still has the `getSupabase` undefined bug |
| 5 | Mark work orders for monthly report | ❌ NOT STARTED — related but different: PR #112 shipped an association stats widget |
| 6 | Marketing posts + association reports structure | ❌ NOT STARTED |
| 7 | CINC ledgers via text/WhatsApp/email | ❌ NOT STARTED — partly blocked on SMS working (task 8) |
| 8 | Fix broken text messages | 🟡 IN PROGRESS — root cause found: Twilio **A2P 10DLC campaign was REJECTED**. Consent checkbox shipped on the OTP login (PR #116). Pending: user resubmits the Twilio campaign; webhook-crash fix; emergency-regex fix |
| 9 | Compliance tracking (leases / insurance / Cert of Use) | ❌ NOT STARTED |

### New work this session, NOT in the original 9

- Communications overhaul — per-staff triage view, server-side email filters, accurate counts, conversation archive (PRs #112, #113, #117, #118, #119)
- Dialpad ingest shipped **dormant** (PR #114 — no Dialpad API access on current plan)
- Manual SMS log on tickets (PR #115)
- **TOP NEXT PRIORITY: Gmail ingest hardening** — stale-historyId backlog replay + Gmail deletion sync.

### Two roadmap sources now exist — read BOTH at session start
- **This file** (`NEXT_SESSION.md`) — the original 9-task product backlog (status above)
- **Memory `next_session_priorities.md`** — this session's operational follow-ups (8 items, open PRs)
- **Memory `migration_workflow.md`** — migrations MUST be idempotent; the user applies them by hand and it keeps breaking

---

# 9 follow-up tasks

The user listed these in priority order. Each below has enough context
to start. **See the STATUS UPDATE above — several are already done.**

## 1. CINC work-order pictures aren't pulling

**Goal**: When a vendor or applicant attaches photos to a CINC work
order, MAIA should display them in the work-order view.

**Where to look**:
- `lib/integrations/cinc.ts` — `CincWorkOrder` interface has
  `Notes?: CincNote[]` but NO field for attachments / pictures. Need
  to find out what CINC's API returns (probe with
  `scripts/probe-cinc.ts` or hit `/management/1/workOrders?workOrderId=X`
  and inspect raw response).
- CINC may have a separate `/management/1/workOrderAttachments` or
  `/workOrders/[id]/attachments` endpoint. Check their API docs.
- The MAIA work order display lives somewhere under `app/admin/work-orders/`.

**Likely fix**:
- Add a `Pictures?: CincAttachment[]` field to `CincWorkOrder` interface.
- Add `listWorkOrderAttachments(workOrderId)` to `lib/integrations/cinc.ts`.
- Display in the work order detail view.

## 2. Upload photos from MAIA emails into work orders

**Goal**: When an email arrives via the Gmail Pub/Sub webhook with
photo attachments and references a new or existing work order, save
the attachments and attach them to that work order.

**Where to look**:
- `lib/maia-command-processor.ts` (~1000 lines) — the email processor.
  Handles `@maia` commands. Already extracts text content via Claude
  Haiku.
- `app/api/maia-email/webhook/` — entry point.
- Existing pattern: COI / W-9 / ACH attachments → Supabase storage
  buckets. See how those are persisted.
- Existing pattern: `@maia append TKT-YYYY-NNNN` already attaches
  emails to specific tickets — extend for work orders.

**Likely fix**:
- Detect work order reference in email body (e.g., `WO-` prefix or
  similar).
- Save attached images to a `work-order-attachments` storage bucket.
- Insert rows into a new `work_order_attachments` table OR push to
  CINC via their work-order-notes endpoint (which may accept
  attachments).

## 3. Upload pictures in work orders directly in MAIA

**Goal**: Staff-side upload widget on the work order detail page.

**Where to look**:
- `app/admin/work-orders/page.tsx` is the list. There's likely a
  detail route too.
- Reuse the `<SignaturePad>` upload pattern OR the docs library's
  direct-to-storage upload (the cleanest one to copy is
  `app/api/admin/associations/[code]/documents/upload-url/route.ts`
  + `DocumentsManager.tsx` upload card).

**Likely shape**:
- New table `work_order_attachments (id uuid pk, work_order_id, storage_path, filename, mime_type, file_size_bytes, uploaded_by_email, created_at)`.
- Storage bucket `work-order-attachments` (private, 50 MB cap, auto-created).
- POST endpoint per work order + a signed-upload-URL endpoint.
- Display thumbnails in the work order detail view.

## 4. Finish the application: payment + background check (Applycheck)

**Goal**: Connect Stripe payment + auto-trigger Applycheck after
payment succeeds, end-to-end.

**Where to look**:
- `app/api/create-checkout-session/route.ts` — creates Stripe Checkout
  session.
- `app/api/webhooks/stripe/route.ts` — Stripe webhook. Already calls
  `/api/trigger-applycheck` after `succeeded` (line 45) but uses
  undefined `getSupabase` — broken.
- `app/api/trigger-applycheck/route.ts` — POSTs to Applycheck API,
  updates `applications.applycheck_status`.
- `lib/applycheck.ts` (if it exists) for the integration.

**What's likely missing / broken**:
- The stripe webhook `getSupabase` bug.
- Frontend confirmation flow (`/apply/success?session_id=...`) may
  need work.
- The Applycheck API call may need credential / config validation.

## 5. Mark work orders for inclusion in monthly management report

**Goal**: Per-association monthly report. Staff toggles a flag on
work orders to include them in the next month's report.

**No existing structure**. Likely shape:
- Add `include_in_monthly_report boolean` + `monthly_report_month text`
  (YYYY-MM) columns to the work orders table.
- New admin page `/admin/reports/monthly/[code]/[month]` that lists
  included work orders + lets staff finalize / export PDF.
- Use `extract-pdf.ts` pattern in reverse: generate a PDF via
  React-PDF or HTML → Puppeteer for the report.

## 6. Marketing posts + association reports structure

**Goal**: Data structure to feed future marketing automation (social
posts, association-level reports).

**No existing structure**. Need to scope with the user. Likely:
- New table `association_events (id, association_code, event_type,
  title, description, occurred_at, photos uuid[])` capturing
  noteworthy events.
- New table `association_marketing_drafts` for AI-generated post
  drafts pending staff approval.
- Reuse `lib/maia-command-processor.ts` Claude integration for
  generation.

## 7. CINC ledgers — owner statements via text / WhatsApp / email

**Goal**: Owner texts MAIA "send my ledger" → MAIA queries CINC for
the owner's account ledger → emails/WhatsApps it back.

**Where to look**:
- `lib/integrations/cinc.ts` — add `getOwnerLedger(propertyHOID)`.
  Check CINC API docs for the ledger endpoint
  (`/management/1/homeowners/ledger` or similar).
- `lib/maia-command-processor.ts` — already handles email commands;
  add a `@maia send ledger` or similar trigger.
- `app/api/webhook/route.ts` — Twilio webhook handles inbound SMS /
  WhatsApp. Add ledger-request detection.
- `lib/gmail.ts` `sendEmail()` for the reply.

## 8. Fix the broken text message feature

**Goal**: Inbound / outbound SMS via Twilio works.

**Where to look**:
- `app/api/webhook/route.ts` — Twilio inbound webhook.
- Outbound: `twilioClient.messages.create({ from: TWILIO_PHONE_NUMBER, to, body })`.
- **Common gotchas**:
  - `TWILIO_PHONE_NUMBER` vs `TWILIO_WHATSAPP_NUMBER` mix-up — they
    are DIFFERENT in this codebase.
  - `from` must be E.164 (+1...).
  - Sandbox SMS numbers don't work in production.
  - 10DLC registration may be required for app-to-person SMS.

User says it's "not working" — start by checking Vercel function
logs for the Twilio call and the actual error response.

## 9. Compliance feature: leases, insurance, certificates, Certificate of Use (Lauderhill)

**Goal**: Monitor expiration dates per unit. Alert staff when
something is about to expire.

**Specific cases the user mentioned**:
- Lease end date (per tenant)
- Unit insurance certificate (HO6 policy)
- The Manors of Inverrary XI (`MANXI`) has a special
  **Certificate of Use** required by the City of Lauderhill for any
  lease or sale — needs to be tracked + alerted.

**Likely shape**:
- New table `unit_compliance_items (id, association_code, unit_number,
  item_type, document_id uuid → association_documents, effective_date,
  expiry_date, status, notes)`.
- Item types: `lease_agreement`, `unit_insurance_ho6`,
  `certificate_of_use`, `move_in_inspection`, etc.
- Per-association configuration of which items are required (Manors
  flips on `certificate_of_use` requirement).
- Cron job → 30/14/7-day expiry alerts via email + admin dashboard.
- Tie into the existing `association_documents` table (HO6 PDFs etc.
  can be category=`unit_insurance` once we expand `CATEGORIES`).

---

## Onboarding flow for the new session

When the user gives you a task from the list above:

1. **Read this file first.** It tells you what's already there so you
   don't re-build it.
2. **Use the `Explore` agent** or targeted `Grep` / `Read` calls to
   inspect the relevant existing module.
3. **For non-trivial changes, ask the user to scope** before building
   (e.g., for the monthly report — PDF format? CSV? On-demand or
   pre-generated?).
4. **Migrations go in `supabase/migrations/`** with a date prefix.
   List them at the end of your commit message + remind the user to
   apply them in the Supabase dashboard.
5. **Type-check with `npx tsc --noEmit | grep YOUR_FILES`** to ignore
   the pre-existing errors documented above.
6. **Commit messages** follow the `MAIA: <area> — <change>` pattern
   the previous session used. End with the
   `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
   line via a HEREDOC.
7. **Pre-existing convention**: never use Node's `crypto` module in
   `lib/session.ts` or `middleware.ts` — Edge-runtime there.
