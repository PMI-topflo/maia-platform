---
name: maia-master-backlog
description: MASTER backlog for MAIA (PMI Top Florida) — single source of all pending development across sessions. Updated 2026-05-31, folding the vendor-portal/Gmail-add-on/recurring-services work into the 2026-05-29 A–I backlog. Newest items at top; A–I carry-forwards below.
metadata:
  node_type: memory
  type: project
  originSessionId: 5535fc12-a76a-4fb2-af51-d628810ff193
---

# ═══ 2026-05-31 — Gmail add-on · vendor portal · recurring services ═══

How-it-works/architecture lives in [[gmail-addon]]. This is the OPEN-ITEMS list.

**Shipped (PRs #225–#238 ALL MERGED to main as of 2026-06-01):** 4 invoice-push bugs (pay-by default, oversized-PDF guard, Drive mirror, duplicate-GL-line delete, **attach-model fix** — payload field is `File`) · **system-wide PDF/image normalization** server+browser (lib/pdf-normalize.ts + lib/normalize-upload-client.ts) · reconciliation (4 frozen cols, `Invoice: NNN` parsing, clickable Invoice#→detail, **detail-in-modal**) · invoice-detail phantom-$320 fix (CINC stores expense amounts negative) · **Gmail add-on** #233 + **staff-reply capture** #234 · **vendor upload portal** #235 (report+suggestions, multilingual, English default, translate-to-English) · **recurring services Phases 1–3a** (#236/#237/#238).

**Ready to deploy (owner action) — all PRs merged, nothing waiting in review:**
- Apply migrations via /admin/tools (idempotent, registered): `vendor-language`, `service_visit_agenda`.
- Deploy the **Gmail add-on**: `gmail-addon/DEPLOY.md` → clasp push → private Workspace Marketplace install; staffers paste token from `/admin/addon`.
- Env: **CINC_SYNC_ENABLED=true**; GOOGLE_SERVICE_ACCOUNT_JSON + share "INVOICE TO INPUT" Drive folder.

**NEW requests 2026-05-31 (not built — top of queue):**
1. **Control Panel "Recurring Work Orders" card** (/admin dashboard): 🟢/🟠/🔴 on whether vendors are sending weekly reports (green=all this-week visits have photos+report; orange=some missing/late; red=overdue/not reporting); click → status table of every recurring service's latest visit per association. Data: recurring_services + service_visits + work_order_attachments.
2. **Non-recurring WO → estimates board report:** collect vendor estimates (portal category 'estimate'), build a comparison report (vendor/amount/scope) **with estimate images**, send for board approval. Owner keeps estimates in Drive (internal); board needs the images.
3. **Non-recurring WO weekly office chase:** extend the Friday office-agenda email to non-recurring WOs to push vendors for estimates; after board approval collect schedule + crew (same agenda flow as recurring).

**Recurring services — remaining phases:**
- **3b** (buildable now, no CINC dep): weekly reminders for visits with no photos + staff coverage report ("X of Y documented"). Overlaps #1.
- **3c** (decisions LOCKED, BLOCKED): monthly-invoice rollup at invoice-push → ONE CINC work order bundling the month's visits (**cap 4 photos; consolidated TEXT in WO notes**, no PDF) + ONE CINC invoice linked via `WorkOrderNumber`. BLOCKER: CINC work-order CREATE is async (enqueueOutbox 'create'/'cinc' → cron) and partly stubbed — verify end-to-end (CINC_SYNC_ENABLED + a live test like invoices) before wiring. Monthly INVOICE side already works.

**Smaller follow-ups:** add-on sidebar "vendor upload link" button + /api/addon/tickets/[id]/vendor-link (admin button + staff API already in #235; add-on side now buildable) · morning per-staff activity report (depends on #234 capture live) · SENT-folder Gmail watch (only for staff replies sent WITHOUT maia@ on thread) · ticket "kind" badges (RTK/ATK/ITK, AWK/RWK) DISPLAY-only — do NOT bake into id, do NOT rename on convert · vendor INBOUND email-reply capture intentionally SUPERSEDED by the portal.

**Conventions:** canonical-English (vendor reports auto-translated, original kept; default language English everywhere) · tickets+WO share one table + one TKT-YYYY-NNNN sequence · portal /vendor/upload/[token], agenda /vendor/agenda/[token] · migrations idempotent + registered in lib/migration-status.ts + applied via /admin/tools.

---

# ═══ 2026-05-29 and earlier — carry-forward backlog ═══

## 🐞 GMAIL @maia CHIP — breaks ALL triggers (2026-05-29) — PR #213 `claude/invoice-trigger-flexible` → main
**ROOT CAUSE (important, affects everything):** when staff type "@maia" in Gmail, autocomplete replaces it with the maia@ contact's DISPLAY NAME → "@Maia PMI AI AGENT". So inbound bodies never contain a bare "@maia" — every trigger detector (invoice, ticket, append, owner/tenant/board/vendor) that expects "@maia <keyword>" contiguous was silently failing. Symptom: Karen's invoice fell through to freeform → AI auto-opened a ticket (reply #1) → Pub/Sub re-delivery → reply #2.
**FIX (2 layers, lib/maia-command-processor.ts):** (1) central normalization right after parse in processEmailCommand (~line 2143): `parsed.body = parsed.body.replace(/@maia\s+pmi\s+ai\s+agent\b/gi, '@maia')` — fixes ALL triggers. (2) flexible invoice regex in detectInvoiceTrigger (~1458): `/@maia\b[^.\n]{0,40}\b(process|processing|upload|pay|submit|enter|log|record)\b[^.\n]{0,25}\binvoice/i` for "process THIS invoice" wording. Invoice routes to handleInvoiceIntake (idempotent on gmail_message_id) + returns early → no ticket, single reply.
**NOTE:** the normalization only matches the exact "PMI AI AGENT" display name — if other staff saved the maia@ contact under a different name, their chip won't normalize. If triggers fail for a specific person, check their Gmail contact name for maia@ and extend the regex.
**WATCH:** general freeform double-reply on Pub/Sub re-delivery for NON-invoice emails (idempotency guard at ~line 1153 keys on gmail_message_id; different IDs per delivery won't dedupe) — chase with real logs if it recurs.

## 💵 Reconciliation cash-flow features (2026-05-30) — PRs #222 + #223
- PR #222 `claude/recon-upcoming-payments`: NEW "Upcoming Payments" section under the recon ledger = CINC approved-unpaid (live) + MAIA recurring estimates (forecast) + manual future payments (new `scheduled_payments` table, installment series + carry-forward). API: /reconciliation/upcoming (GET), /reconciliation/scheduled (POST+series), [id] (PATCH/DELETE). + Postpone button (defers due_month +1). scheduled_payments migration applied live.
- PR #223 `claude/invoice-due-scheduled-dates`: invoice_intake_drafts.due_date + scheduled_pay_date; intake card fields; push passes dueDate→CINC. Applied live.
- FOLLOW-UP not yet built: surface pushed-but-unpaid invoices in the Upcoming section keyed on scheduled_pay_date (so they're postponable there). Current Upcoming uses CINC openInvoices live for approved-unpaid; tying to scheduled_pay_date needs joining drafts.
- Open PRs awaiting merge: #221 (recon enrichment rescue), #222, #223. WATCH: Fabio merges fast — follow-up commits keep getting stranded (rescued #221 already). Confirm final commit is in a PR before merging.

## ⚙️ CINC_SYNC_ENABLED gates ALL CINC work-order sync (2026-05-29)
`CINC_SYNC_ENABLED` is NOT set in .env.local and likely NOT 'true' in Vercel. It gates the ENTIRE CINC work-order path: `lib/tickets.ts:584` `enqueueOutbox` no-ops for target='cinc' unless ==='true'; push-to-cinc route 400s; sync-cinc-inbound cron skips. So NO work orders reach CINC (auto on ticket-create OR manual button) until it's flipped. INVOICES reach CINC via a separate DIRECT path (intake push → cinc.createInvoice), no gate — that's why invoices work but WOs don't. **ACTION for Fabio: set `CINC_SYNC_ENABLED=true` in Vercel** (creds proven by working invoice push). Help page still says "stubbed behind CINC_SYNC_ENABLED; will wire when credentials arrive" — creds are here now.

## 🔧 Batch fixes 2026-05-29 (PRs #219, #220, + ticket_links applied)
- `ticket_links` table was MISSING in live DB ("Could not find table public.ticket_links") → broke the "Link a ticket or work order" modal. APPLIED live (with GRANT + idempotent policy + NOTIFY). It WAS already registered in migration-status.ts (entry exists on main ~line 380) — it just had never been clicked-Apply. No code change needed.
- Recon enrichment added to PR #219 (commit dfabf22): parse Inv.#NNN from gl Description into invoice_number; build per-assoc invoiceNumber→InvoicePayTo map from listOpenInvoices for vendor_payee (covers still-open/ready invoices; paid+closed not reachable from bank txn).
- LESSON: do NOT run `git commit`/`git push` in `run_in_background` while also switching branches in foreground — caused a commit to land on the wrong branch + a duplicate migration-status entry. Do git ops synchronously.
- PR #219 `claude/recon-columns-cleanup`: removed redundant Customer column from reconciliation ledger; tightened inferVendorPayee (lib/bank-reconciliation-sync.ts) to reject non-vendor parentheticals (Unit/Statement/maintenance) so Vendor/Payee stops echoing Description. Existing CINC rows need a re-Sync to recompute. NOTE: for CINC-native invoices the vendor name isn't in the glTransaction Description at all — true vendor would need a per-invoice CINC lookup during sync (follow-up).
- PR #220 `claude/ticket-type-and-create-cinc-wo`: promoted ticket "Category" → top-level "Ticket type" card (parallel to Work order type), removed from Edit modal; surfaced "＋ Create work order in CINC" button on the WO-type card (was buried). Gated by CINC_SYNC_ENABLED (above).

## 🐞 CINC field-name mismatches (2026-05-29) — CINC casing is inconsistent per-endpoint, probe live before trusting interface
CINC returns `XxxId` on some endpoints and `XxxID` on others; several lib/integrations/cinc.ts interfaces guessed wrong and silently broke (catch→[] or undefined reads). Fixed:
- PR #216: invoiceStatuses `InvoiceStatusId`/`InvoiceStatusDescription` (was StatusID/StatusDescription) → push-to-CINC was failing "Cannot resolve StatusID for PENDING APPROVAL". Status ids are NEGATIVE (-1..-6).
- PR #217: payByTypes `PayTypeId`/`PayTypeDescription` (was PayByTypeName/Description) → payment-method dropdown was blank; vendor catalog `Dba`/`ZipCode`/`TaxID`/`Address1`/`Phone1` (was DBA/Zip/TaxId/AddressLine1/Phone) → fuzzyMatchVendor DBA check was dead (155/1058 vendors have a DBA).
VERIFIED CORRECT (probed live, no change): glTransactions `GLTransID` (recon dedup key), budget `ChartID`, bankBalances `BankAccountID`, openInvoices, workOrderTypes/Statuses, vendorsBasic `VendorId`.
⚠️ STILL UNVERIFIED: `CincInvoice` detail interface (invoice mirror page) uses InvoiceID/VendorID/InvoiceStatusID uppercase — display-only, couldn't probe (no invoice id handy). Probe `/management/associations/1/invoice?invoiceId=N` after a push to confirm. Board-member sync (CincBoardMember) not swept.
To re-probe: tsx script loads .env.local, gets CINC token (client_credentials), GETs endpoint, dumps Object.keys(first). SUPABASE_URL is the real host; NEXT_PUBLIC_SUPABASE_URL is a proxy.

## ⚠️ MERGE-STATE WATCH (2026-05-29 late) — verify before assuming shipped
- PR #210 (I3 insurance + dashboard + cron cleanup) = ON main ✅
- PR #211 (I4 safety + I7 tracker) merged into the INSURANCE branch, **NOT main** (classic base trap). RESCUED via **PR #212** (rebased on main, carries the safety commit).
- **PR #212** `claude/compliance-drive-links` → base main: rescues safety (I4/I7) + adds Drive-link fields (drive_url on insurance+safety, editable in the managers) + Building/Unit dashboard reorg + COMPLIANCE_TRACKING.md. **Confirm #212 actually lands on main** (`git merge-base --is-ancestor <sha> origin/main`) — if it doesn't, I4/I7 are still not on main. All 3 migrations (safety, drive_url, insurance) already applied live to Supabase.
- Dashboard now: 🏢 Building Compliance + 🏠 Unit Compliance tiles (each row has 📦 in-system / 🗂 Drive source chip) + "Open Alerts"→/audit. Old Docs&Permits/Inspections/Compliance tiles removed.

## Status as of end of 2026-05-29 session

### Shipped this session (PRs #197–#209, all merged)

- **Reconciliation page replaces Isabela's spreadsheet** (PR #197, #200, #201, #202)
  - Multi-account ledger view with running balance per bank account
  - MM/DD/YYYY dates (Karen's request)
  - SSB (auto-sync) vs non-SSB (manual) grouping
  - Per-bank sync error breakdown
  - CSV export
- **glTransactions sync** — pulls ALL bank activity, not just MAIA-pushed invoices (PR #198)
- **Cash flow forecast** — projected EOM balance + overdraw warnings on intake card (PR #199)
- **paid_type derivation** from CINC Description with editable override (PR #203)
- **CINC invoice detail page** mirror at `/admin/invoices/cinc/[id]` (PR #204)
- **Vendor Default Pmt Method** on intake card (PR #205)
- **vendor_payee duplicate fix** in reconciliation (PR #206)
- **GL dropdown YTD actuals** from glTransactions instead of CINC's broken Actual field (PR #207)
- **Twilio A2P 10DLC** — Dawnus LLC entity on all SMS public surfaces (PR #208)
- **CINC Contacts and Consent prep** — flag detection + advance banner + migration plan (PR #209)

### Done outside MAIA code

- ✅ Karen submitted resubmission to Twilio (BLOCK 2 from prior memory)
- ✅ Twilio campaign updated with "Dawnus LLC" entity references

---

## Active blocks remaining

### 🟦 BLOCK 3 — Run reconciliation Sync per association (one-time backfill)

After PR #206 deploys, all 25 associations need a one-time **Sync** click on `/admin/reconciliation` so the new `inferVendorPayee` heuristic overwrites every existing CINC-sourced row's broken `vendor_payee = Description` data.

**Why safe:** `vendor_payee` on CINC-sourced rows is locked from manual edits in the PATCH route (`source='manual'` gate), so the sync overwrite cannot trample user data.

**Effort:** ~3 min per assoc × 25 = ~1 hour of clicking, or wire a "Sync ALL" button.

### 🟨 BLOCK 4 — Flag CINC config gaps to Jonathan / Shemaiah

These are **CINC-side config issues, not MAIA bugs** — surfaced by PR #207's GL audit but Jonathan owns the fix.

1. **DELA Mgmt Contract**: budget = $0, YTD spend = $6,600 → either budget wasn't entered, or the $6,600 is in the wrong GL. Decision needed: add 2026 mgmt budget line OR reclassify.
2. **VEN1 and VEN2**: `/budget/association/{code}` returns empty array. Possibly missing 2026 budgets, or assoc codes don't match what CINC expects.

---

## 🔁 Carry-forward backlog from prior session (2026-05-26 memory) — STILL PENDING

These were enumerated in `next_session_priorities.md` v1 and never shipped. Most remain relevant.

### A. Invoice intake — high-value continuation work

| # | Item | Effort | Notes |
|---|---|---|---|
| **A2** | **Phase 2 — status sync from CINC** — cron pulls `/openInvoices` per assoc, mirrors status (PENDING APPROVAL / READY FOR PAYMENT / PAID / VOID) + Balance + payment data. Dashboard shows real-time state. | 2–3 days | Partial coverage from glTransactions sync (PR #198) but `/openInvoices` is a richer signal (status enum + balance + due date). |
| **A3** | **Phase 3 — daily board digest** — cron at 8am sends each board member one email: *"N invoices waiting for your approval in WebAxis"*. | 1 day | Requires A2 data. |
| **A4** | **Reject after push (undo path)** — Karen's Reject on already-pushed draft → `POST /invoiceNotes` (reason) + `PUT /voidInvoice`. Today Reject only marks local; CINC stays out of sync. | half-day | Could also live on CINC invoice detail page (PR #204) as "Void in CINC" action. |
| **A5** | **Compliance docs to CINC** — redirect existing `@maia add vendor` COI / W-9 / license PDF uploads from Supabase buckets to CINC's vendor insurance / license endpoints. | 1–2 days | "Bonus phase" in original architecture conversation. |

### B. Invoice intake — UX polish + smarter defaults

| # | Item | Effort | Notes |
|---|---|---|---|
| **B1** | **Invoice instructions banner per assoc** — `GET /invoiceInstruction/association/{code}`, yellow banner on the card (e.g. "KANE requires PO numbers"). | 2 hrs | |
| **B2** | **DefaultApAccount fallback** — when MAIA can't match a GL line, suggest `DefaultApAccount` from `GET /transactionSetup`. | 2 hrs | |
| **B3** | **Auto-suggest WO link** — when MAIA extracts a maintenance vendor AND there's a recent open WO for (vendor, assoc), pre-select the WO. | half-day | |
| **B4** | **Auto-suggest GL line from extraction** — Claude could pick a likely GL based on invoice description ("Repairs and Maintenance" for an electrician). Today empty by default. | half-day | |
| **B5** | **Body cleanup in extraction** — QuickBooks tracking URLs bloat the email body (17.6 KB observed in Atlas test). Strip long URLs / collapse whitespace before storing. | 2 hrs | |
| **B6** | **work_order_type from trigger phrase** — `@maia open work order Electrical` should set `work_order_type_name='Electrical'`. Karen flagged this. | half-day | |
| **B7** | **Karen batch-approve flow** — daily digest with "approve all low-risk" for sub-threshold invoices. | 1 day | Volume-dependent — only if intake exceeds ~20/day. |
| **B9** | **Orphan-draft cleanup** — reject any pre-#191 drafts that were actually `@maia` commands misrouted to intake. | 10 min | One-time. |

### C. MAIA freeform / ticket improvements

| # | Item | Effort | Notes |
|---|---|---|---|
| **C1** | **MAIA Teaching button** — store `(original_message, correct_response, category, association, persona)` in `maia_training_examples` table. Freeform-email prompt fetches top-N relevant examples as few-shot context. | 1–2 days | High user impact. |
| **C2** | **Cross-mailbox thread bridging** — store RFC `Message-ID` + `In-Reply-To`; bridge threads across mailboxes by reply chain instead of per-mailbox `gmail_thread_id`. | half-day | Prerequisite for true thread accuracy across multiple connected staff inboxes. |
| **C3** | **MAIA suggests existing tickets** — before opening create-new ticket form, show top-3 candidate matches via `findOpenTicketByGmailThread` / Subject / Contact with "Link to this instead" button. | half-day | Revisit if duplicates still appear. |
| **C4** | **Attachment reading in ticket-create path** — today PDFs+images only read in freeform reply path. Structured ticket-create still uses `parsed.body.slice(0, 280)` for summary. | 2–3 hrs | Would enrich ticket summary with real PDF contents. |
| **C5** | **Thread-aware categorization** — `ticket_category` extraction for direct `@maia open ticket` trigger path. Today only escalation path auto-picks category. | 2 hrs | |
| **C6** | **Thread-aware new-ticket summary** — use conversation history to enrich summary instead of just latest message body. | 2 hrs | |

### D. Non-invoice items

| # | Item | Effort | Status |
|---|---|---|---|
| **D2** | **Webhook handler crash on inbound SMS** — `app/api/webhook/route.ts` POST throws → catch returns `{status:"error_handled"}`. Need to fix the actual handler. | 2–3 hrs | No longer blocked on D1 (Twilio resubmitted this session). |

---

## ✨ NEW items surfaced THIS session (2026-05-29)

### E. Reconciliation / cash flow

| # | Item | Effort | Came up in |
|---|---|---|---|
| **E1** | **Sync history feature** — track changes to reconciliation entries over time. Karen asked early in session: *"I want to save a history of each sync"*. Deferred for cash flow forecast. Revisit when "what changed this week" becomes a need. | 1 day | mid-session |
| **E2** | **End-of-month Google Sheets export** — Karen said *"at the end of the month downloading a google sheets"*. Today CSV only. Real `.xlsx` or Sheets API export with formatting would feel more native. | half-day | mid-session |
| **E3** | **Spreadsheet import (one-time)** — Isabela sent her Excel reconciliation spreadsheet. We built a similar-format page but never offered "upload your historical .xlsx and we'll backfill manual entries". Would let Isabela bring pre-MAIA months into the page. | half-day | early session |
| **E4** | **"Sync ALL associations"** button on `/admin/reconciliation` — instead of clicking Sync 25 times after a fix like PR #206. | 2 hrs | this session |

### F. Invoice intake — newly discovered

| # | Item | Effort | Came up in |
|---|---|---|---|
| **F1** | **"Preview as CINC will see it" button** BEFORE push — today the CINC mirror page link (`/admin/invoices/cinc/[id]`) only appears AFTER push in the green Pushed banner. Karen asked where the button was during this session. A pre-push preview that renders the same layout from the draft data would let her verify everything matches BEFORE clicking Push. | 2 hrs | this session |
| **F2** | **Sync ALL associations Sync button** for `/admin/reconciliation` | (duplicate of E4) | |
| **F3** | **QuickBooks invoice extraction** — earlier in session user reported QB invoices weren't being recognized. PR #192 added the `@maia upload invoice` trigger, but QB-specific PDF layouts may still need extraction tweaks. Worth re-testing with a real QB invoice from PMI to a client. | 2–3 hrs | start of session |

### G. CINC API watch (from PR #209)

| # | Item | Effort | Notes |
|---|---|---|---|
| **G1** | **Contacts and Consent v2 migration** — when CINC flips `IsContactsFlagOn=true` on PMITFP tenant. Triggers a red banner on `/admin/cinc-sync/[code]` (PR #209). 6-step checklist in `CINC_API.md → Contacts and Consent migration`. | 1–2 days when triggered | External trigger — monitor weekly. |
| **G2** | **Persona model bridge to CINC contact types** — Fabio observed: *"they added some PERSONAS (not all that we have)"*. CINC's `propertyContactTypes` is narrower than MAIA's (owner / tenant / board / agent / vendor). When v2 lands, decide whether to map MAIA personas → CINC contact types where they overlap. Not 1:1. | design decision | Triggered by G1. |

---

## 🏠 H. APPLICATION WORKFLOW (rental + purchase) — bucket Fabio flagged as missing

### Existing pieces (already shipped)

- `applications` table with `board_decision` enum (pending / board_review / approved / rejected)
- `/admin/applications` table view with tabs per decision
- ApplyCheck integration: `applycheck_status`, `/api/trigger-applycheck`, `/api/applycheck-webhook`, fired from Stripe webhook on app fee payment
- Public apply form (`components/ApplicationForm.tsx`) with 6-language support and signature step
- `acknowledged_document_ids` tied to `association_documents`
- `unit_leases` table with `application_status` (active/expired/approved/renewed)
- Lease expiry cron (`/api/cron/check-lease-expiry`) flips to `expired` + sends reminders 30 days out

### What's MISSING from the application workflow

| # | Item | Effort | Why |
|---|---|---|---|
| **H1** | **Single applicant-status page** — applicant can log in (OTP) and see: "✅ Form submitted · ✅ Fee paid · ⏳ Background check running · ⏳ Docs to sign · ⏳ Board review". Today they email Karen to ask. | 1 day | Reduces inbound "what's my status?" volume. |
| **H2** | **Move-in checklist per approved application** — utilities transferred, keys handed over, parking sticker issued, gate fobs assigned, vehicle registration, pet registration, emergency contacts captured. Today this lives in Karen's head + scattered tickets. | 1–2 days | Currently the #1 source of "did anyone tell the front desk?" tickets. |
| **H3** | **Move-out workflow** — final inspection, key return, security deposit refund/withhold calculation, utility disconnect notification, fobs deactivated, gate code revoked. | 1–2 days | Currently nothing structured — Karen forwards a checklist email. |
| **H4** | **Estoppel certificate generation** — FL statute requires response within 10 business days when title company requests for a sale closing. Today Karen builds manually. Auto-pull balance + violations + open assessments + recent paid history into a 1-page PDF. | 2 days | Statutory deadline pressure; missed deadlines forfeit collection rights. |
| **H5** | **Closing package for buyers** — resale certificate + last 12 months minutes + budget + reserves disclosure (required by FL statute §718.503 for condos). Generated on demand when title company / agent requests. | 1–2 days | Often blocks closings. |
| **H6** | **Application funnel report** — per-month: how many submitted, how many passed background, how many approved, how many rejected, conversion %, time-in-stage. Lets Mike see where applicants drop off. | half-day | Visibility for ownership decisions. |
| **H7** | **Application timeout / abandon cleanup** — applications stuck in `pending` for 60+ days with no fee paid → auto-archive + email applicant "your application has expired, restart here". Today these clog the dashboard. | 2 hrs | Cosmetic but Karen asked. |
| **H8** | **Co-applicant / joint applicant** — today the form captures one applicant. Couples + roommates need a second person to sign separately. | half-day | Hits ~30% of real applications. |
| **H9** | **Architectural Review Committee (ARC) request workflow** — separate intake from maintenance tickets: owner submits proposed change (paint, doors, satellite dish, shutters), board reviews, decision recorded, certificate of approval issued. FL statute requires written response within 30 days. | 2 days | High board frustration today. |
| **H10** | **Move-in package email** — once approved + lease signed + deposit paid, auto-send the move-in package (welcome letter, building amenities, rules, emergency contacts, who to call for what). | 2 hrs | Currently Karen sends manually. |
| **H11** | **Lease renewal flow** — 60 days before lease expiry: auto-email tenant offering renewal, capture decision, generate lease addendum, route through board if rent change. Today the cron only warns Karen. | 1 day | Captures renewals that fall through cracks. |
| **H12** | **Background-check rerun policy** — if approval delayed >30 days, ApplyCheck data goes stale. Auto-rerun or flag. | 2 hrs | FL statute / fair housing concern. |

---

## 📑 I. DOCUMENT MANAGEMENT COMPLIANCE — bucket Fabio flagged as missing

### Existing pieces (already shipped)

- `association_documents` table with `category` + `effective_date` + `expiry_date` + `language` + `archived_at` (version supersede)
- 6-language taxonomy (en/es/pt/fr/he/ru) for resident-facing docs
- `compliance-alerts` cron with email digest (covers leases / unit_insurance / certificate_of_use / violations — 60-day lookahead, dedupe + auto-resolve)
- Per-assoc Documents page at `/admin/cinc-sync/[code]/documents`
- Vendor flags `coi_on_file` / `ach_on_file` / `w9_on_file` (booleans only)

### What's MISSING from document compliance — taxonomy SHIPPED is 2 of 7

The taxonomy in `lib/association-documents.ts` has 7 documented category groups but only **2 are implemented** (`condo_docs`, `rules_regs`). The other 5 are scoped + commented but not wired:

| # | Item | Effort | Why |
|---|---|---|---|
| **I1** | **Implement Financial document category** — budget, reserve study, annual audit, financial statements. FL statute requires retention 7 years. | half-day | Foundation for board access + estoppel/closing-package generation. |
| **I2** | **Implement Operations category** — board meeting minutes archive, agendas. FL statute requires 7 years; owners can request copies. Add expiry-style alert when more than 90 days pass without minutes uploaded. | half-day | Statute compliance. |
| **I3** | **Implement Insurance category — FULL Florida HOA/condo checklist** — Master, GL, D&O, Fidelity, Workers Comp, Umbrella, Flood, Cyber, Equipment Breakdown, Ordinance & Law, Windstorm. Each gets effective + expiry dates, COI upload, named-insured tracking. Expiry → compliance alert. | 2–3 days | High board liability exposure. D&O alone is a board-resignation trigger. |
| **I4** | **Implement Florida-specific safety category** — Structural Integrity Reserve Study (SIRS — SB 4-D for 3-story+ condos), Milestone Inspection (25/30-year), Wind Mitigation Report, Roof Inspection. Track which buildings TRIGGER each requirement based on year-built + stories. | 2 days | Missed deadlines = personal liability for board. |
| **I5** | **Implement Vendor compliance category — COI / W-9 / License with EXPIRY tracking** — today just three booleans on the vendor row. Make actual file storage + expiry dates. Add to compliance-alerts cron with 60-day warning. | 1–2 days | Vendors quietly let COIs lapse — when something happens, association is uninsured. |
| **I6** | **Implement Other / Correspondence category** — misc docs, board correspondence, vendor contracts, communication archives. | half-day | Catchall. |
| **I7** | **SIRS / Milestone DEADLINE tracker** — per-building computed deadline based on year built, last inspection date, stories. Surface "X buildings have SIRS due by 12/31/2026" on admin dashboard. | half-day | Most associations don't track this themselves. |
| **I8** | **Sunbiz annual filing tracker** — every assoc must file the annual corporate report with FL Division of Corporations by May 1. $138.75 late fee + admin dissolution risk. Calendar reminder + ticket creation in March. | 2 hrs | Multiple associations have been administratively dissolved historically. |
| **I9** | **D&O insurance renewal proactive workflow** — 60 days before D&O expiry, MAIA emails board "your D&O insurance expires in 60 days, here's the renewal quote process, here are the 3 quote requests to send." | half-day | Existing cron warns; nothing automates the renewal. |
| **I10** | **Document acknowledgment for boards on policy change** — when bylaws / declaration / rules supersede happens (`archived_at` set), all current board members get an email requiring acknowledgment of the new version. | half-day | Reduces "I didn't know" disputes. |
| **I11** | **CINC vendor compliance push (was A5)** — redirect existing `@maia add vendor` COI / W-9 / license uploads from Supabase buckets to CINC's `/vendors/vendorInsurance` + `/vendors/vendorLicense` endpoints so CINC's compliance dashboard stays accurate too. | 1–2 days | Avoids dual systems. |
| **I12** | **Compliance ticket auto-create (not just email)** — today the compliance-alerts cron sends an email digest. Convert each new alert into a real ticket (assignee Karen / Mike / board, ticket_category=Compliance) so it shows in `/admin/tickets` and gets tracked + reported on. | half-day | Today alerts are "out of sight" once digest is read. |
| **I13** | **Document indexing for AI retrieval** — `extracted_text` column exists but isn't being used in MAIA's freeform replies. When an owner asks "can I have a satellite dish", MAIA should retrieve from the active rules+regs doc. Likely cheapest version: keyword search over `extracted_text`, retrieve matching paragraphs, inject as context. | 1 day | High user impact — closes the "is this allowed?" question class. |
| **I14** | **Reserve study age check** — most FL associations need updated reserve study every 3 years (often required by lenders). Track `last_reserve_study_date` per assoc, alert when >30 months. | 2 hrs | Often missed until refinancing fails. |

### Existing tables that need polish

- `unit_insurance` exists but no UI to upload + manage. Today it's populated only by Drive scanner heuristics (`/api/indexer/drive-scan`).
- `unit_certificate_of_use` is Lauderhill-specific — should be generalized for any FL city that has its own rental cert requirement (Hollywood, Hallandale, Pembroke Park, etc.).
- `unit_violations` resolution_due_date tracking works but no UI to create them — they have to be added via SQL or scanner.

---

## 🧹 Housekeeping / tech debt (still pending)

| # | Item | Effort | Notes |
|---|---|---|---|
| **H1** | 3 pre-existing TypeScript errors that have shown on every `tsc --noEmit` for over a week: `app/admin/communications/components/CommunicationsDashboard.tsx:1319` (state setter type mismatch), `components/ApplicationForm.tsx:1072+1075` (`entity` property doesn't exist on form state). | 30 min | Not blocking. |
| **H2** | 2 pre-existing lint errors in `InvoiceIntakeQueue.tsx`: line 615 (unescaped quotes in rejected_reason display), line 1212 (set-state-in-effect in CashFlowForecast). | 1 hr | Not blocking. |
| **H3** | Untracked files at repo root: `board-message-sample.html`, `report-sample.html`, `probe-output.json`, `probe-cinc-output.json`, `scripts/probe-cinc.ts`. Either gitignore or remove. | 5 min | Cosmetic. |
| **H4** | **B8 — Image stamping in PDF** — DEFERRED INDEFINITELY. CINC's `NoteDescription` field achieves the same outcome cheaper. Only revisit if `NoteDescription` proves insufficient. | (skip) | From prior session. |

---

## 🚨 ONGOING WATCH (no immediate action)

- **CINC Contacts and Consent flag** — check `/admin/cinc-sync/[anycode]` weekly for the red banner (PR #209). When it flips ON, follow the 6-step migration checklist in `CINC_API.md → Contacts and Consent migration`.
- **Twilio campaign status** — confirm APPROVED after Karen's resubmission. If rejected again, the rejection text will name the specific issue.
- **DELA + VEN1/VEN2 budget gaps** — confirm Jonathan/Shemaiah have actioned (BLOCK 4 above).

---

## Suggested priority order for next session

Working from highest-statute-risk + highest-user-impact to lowest. Grouped so a multi-week plan can be split across sessions.

### Tier 1 — Statute / liability risk (do first)

1. ~~**I3 — Insurance category (FULL FL HOA/condo checklist)**~~ ✅ SHIPPED 2026-05-29 — PR #210 `claude/insurance-compliance-category` (open, awaiting review/merge). Migration ALREADY APPLIED + verified live in Supabase (table exists, exec_migration helper now installed → Apply button works, CHECK accepts new alert types). PR also includes the control-panel dashboard redesign + cron cleanup (cron now uses shared supabaseAdmin, not the proxy NEXT_PUBLIC_SUPABASE_URL). New `association_insurance_policies` table (master/GL/D&O/fidelity/flood/windstorm/workers-comp/umbrella/equipment-breakdown/ordinance-law/cyber, with named-insured + coverage + COI upload + waiver + versioning); checklist UI at `/admin/cinc-sync/[code]/insurance`; daily cron emits `assoc_insurance_expiring/expired` (60-day). Migration `20260529_association_insurance_policies.sql` registered in migration-status.ts — **must be applied** (Apply button in /admin/tools, or paste SQL). NOTE: cron does expiry-only; "missing required policy" is surfaced in UI only (compliance_alerts dedupe key lacks association_code, so a cron missing-alert would collide across assocs — fix that before adding it).
2. ~~**I4 — Florida-specific safety (SIRS / Milestone / Wind Mitigation / Roof)**~~ ✅ SHIPPED 2026-05-29 — PR #211 `claude/safety-inspections-compliance`, **STACKED on #210** (base = insurance branch; merge #210 FIRST, then #211 auto-retargets to main — verify commits land on main before merging). New `association_safety_inspections` table (per assoc/type/building; year_built+stories drive 3+-story applicability; coastal 25v30yr; suggestedNextDue helper). Migration ALREADY APPLIED + verified live.
3. ~~**I7 — SIRS / Milestone deadline tracker**~~ ✅ SHIPPED in same PR #211 — "Inspections Due" control-panel instrument (180-day horizon) surfacing upcoming/overdue inspections.

   **Doc storage decision (Fabio asked 2026-05-29):** association-level compliance files (master insurance COIs, safety inspection reports, vendor COI/W9/license-planned, reserve study) → 📦 stored IN system (Supabase association-documents bucket). Unit-level docs (leases, HO-6 insurance, certificate-of-use permits, violations) → 🗂 DRIVE only, we track metadata+expiry via source_pdf_url/source_drive_file_id. association_documents = 🔀 either (upload OR drive_link). Sunbiz = 📝 metadata only (associations.sunbiz_* + date_filed already exist). Consider a COMPLIANCE_TRACKING.md canonical doc + 📦/🗂 source labels on the dashboard Docs&Permits rows.
4. ~~**I8 — Sunbiz annual filing tracker**~~ ✅ SHIPPED 2026-05-29 — PR #214 `claude/sunbiz-annual-report-tracker` → main (migration applied+verified live). New `association_annual_reports` table (per assoc/year filing), `lib/sunbiz.ts` (due May 1, $400 late, 4th-Fri-Sept dissolution), `/admin/sunbiz` page (mark filed + confirmation #) + AdminNav link, cron sunbiz_due/sunbiz_overdue alerts (reference_id=associations.id), dashboard Building Compliance surfacing w/ 📝 metadata chip. Verify #214 lands on main after merge.
5. **H4 — Estoppel certificate generation** (2 days) — statutory 10-day response window.

### Staff dashboard redesign — BUILT 2026-05-29 (same branch `claude/insurance-compliance-category`)

`app/admin/page.tsx` rebuilt as an "airplane control panel": dark instrument-tile grid (`app/admin/components/ControlPanel.tsx`) with status LEDs + big mono readouts + a top status line; clicking a tile opens an inline drill-down drawer (My Tasks, Work Orders, Invoices, **Docs & Permits Expiring**, Team Alerts, MAIA Activity) instead of always-on lists. New "Docs & Permits Expiring" instrument unions `association_insurance_policies` + `unit_certificate_of_use` (permits) + `association_documents.expiry_date` on a 120-day horizon (all fault-tolerant). `StaffStatsPanel` (analytics + per-assoc table) still renders below as a secondary section — if Fabio wants ZERO lists on landing, fold that behind a tile too.

**Apply button gap (Fabio reported):** `/admin/tools` only shows the Apply button when the one-time `exec_migration` SECURITY DEFINER helper is installed (see [[migration_workflow]] PR #124 note). It was never installed on PMITFP Supabase → only "Show SQL" appears + a yellow "enable the Apply button" setup banner. Paste `EXEC_MIGRATION_FUNCTION_SQL` (lib/migration-status.ts) once to enable it for all future migrations.

### Tier 2 — High-impact UX / real-time visibility

6. **A2 — Phase 2 status sync from CINC** (2–3 days) — unlocks A3, makes dashboard real-time.
7. **I5 — Vendor compliance (COI/W-9/License) with expiry tracking** (1–2 days) — vendors quietly let COIs lapse.
8. **H1 — Applicant status page** (1 day) — drops inbound "what's my status?" traffic.
9. **H2 — Move-in checklist** (1–2 days) — #1 source of front-desk tickets.
10. **C1 — MAIA Teaching button** (1–2 days) — Karen + Mike both benefit immediately.
11. **I13 — Document AI retrieval (rules lookup in freeform replies)** (1 day) — closes "is this allowed?" class.

### Tier 3 — Correctness gaps + carry-forward

12. **A4 — Reject-after-push undo** (half-day) — CINC + MAIA diverge today.
13. **D2 — Webhook crash fix** (2–3 hrs) — needs to land before SMS traffic resumes.
14. **I12 — Compliance ticket auto-create (not just email)** (half-day) — alerts go ignored in email.
15. **H10 — Move-in package email** (2 hrs) — small win, Karen sends manually today.
16. **I1 + I2 — Financial + Operations categories** (1 day combined) — foundation for closing-package generation.

### Tier 4 — Polish / batch work

17. **E1 — Sync history** (1 day) — Karen asked.
18. **E4 — Sync ALL button** (2 hrs).
19. **F1 — Preview as CINC will see it** (2 hrs).
20. **B1–B6 batch** — small intake polish, half-day batch.
21. **A5 / I11 — Compliance docs to CINC** (1–2 days) — push to CINC's vendor insurance endpoints.
22. **H9 — ARC request workflow** (2 days) — high board frustration.
23. **H3 — Move-out workflow** (1–2 days).
24. **H5 — Closing package** (1–2 days).
25. **A3 — Phase 3 board digest** (1 day) — needs A2.
26. **H11 — Lease renewal flow** (1 day).
27. **H6 — Application funnel report** (half-day).

### Tier 5 — Carry-forward backlog (when bandwidth)

- B1–B9 invoice intake polish
- C2–C6 MAIA freeform / ticket improvements
- E2 Google Sheets export, E3 historical spreadsheet import
- F3 QB invoice retest
- H7, H8, H12 application workflow polish
- I6, I9, I10, I14 document compliance polish

---

## Architecture notes (cumulative — read once per new session)

- **CINC is system of record** for invoices/payments/GL. MAIA owns intake (extract → review → push).
- **Reconciliation page replaces Isabela's spreadsheet.** Multi-account ledger with running balance per bank. SSB accounts auto-sync via glTransactions; non-SSB are manual entries.
- **CINC sign convention (CRITICAL):** for cash AND expense GLs, `DebitAmount` is NEGATIVE when an expense is incurred. Use `amount = -(credit + debit)` for positive expense magnitude. Same formula works for both cash and expense GLs.
- **CINC's `/budget/association/{X}` `Actual` field is UNRELIABLE.** Probed against LFA: claimed $795 for Mgmt, reality was $4,041.25. PR #207 computes YTD ourselves from glTransactions. Don't trust CINC's value.
- **CINC glTransactions has no Vendor field** — only Description. Use `inferVendorPayee` heuristic (PR #206) to derive a meaningful actor label.
- **Invoice intake is PURELY explicit-trigger.** Staff forwards to maia@ with `@maia process invoice` / `@maia invoice` / `@maia upload invoice`.
- **CINC PascalCase is inconsistent:** `ChartID`, `GLAccountNumber`, `GlNumber` (different cap pattern on expense items), `VendorID`, `InvoiceID`. Always check Swagger sample.
- **CINC Contacts and Consent rollout coming** (PR #209). MAIA touches only 1 affected endpoint; advance-warning banner is wired.
- **Twilio A2P 10DLC** — Dawnus LLC is the legal entity, PMI Top Florida Properties is the d/b/a. Both must appear on every public SMS surface (PR #208).

## PR train rescue lesson (still relevant)

PRs that "merge" into a stacked base instead of main remain the single most expensive bug pattern. Always:
- `git merge-base --is-ancestor <sha> origin/main` to verify a commit is actually on main.
- After merging a stacked PR, verify the next stacked PR's base auto-updated to main.
- Don't push follow-up commits to a branch already open as a PR — open a new branch + PR.
