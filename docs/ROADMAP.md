# MAIA Platform — Open Items / Roadmap

_Last updated: 2026-06-04. Living document. Status key: ✅ Live · 🟡 Partial · 🔴 Not built · ⚠️ Blocked._
_Companion to `docs/SESSION-HANDOFF.md` (session-by-session state + gotchas)._

This is the consolidated backlog. Items marked **[carry-over]** predate the 2026-06-03/04 session.

---

## ✅ Shipped & live (2026-06-03/04 session)
- **Invoice Tier-1** (#262): GL auto-select, auto-association inference, expense-GL on Pushed.
- **Invoice Tier-2** (#263): Upcoming-Payments from `scheduled_pay_date`, debt/escrow account guard, funds-check tuning.
- **Invoice process rework** (#267): auto-save on confirm, Pending=Transfer-to-Push only, PDF block-on-fail, **double-pay hard-block** (same vendor+amount+assoc, Karen-only override), Drive-mirror-at-transfer, **Re-attach PDF to CINC**.
- **Drive mirror fixed** (#268): service-account quota → **domain-wide-delegation impersonation as billing@** (`GOOGLE_DRIVE_IMPERSONATE` set + DWD authorized with the SA's numeric client id). Files now land in the INVOICE TO INPUT folder.
- **PDF compressor works in prod** (#269): `@napi-rs/canvas`/`pdfjs-dist`/`sharp` made direct deps + `outputFileTracingIncludes` so the native canvas binary ships. + edit-by-default in Pending review, Reject in a red box, **due-date captured at intake**.
- **Compress on ALL upload paths** (#270): `normalizeStoredFile` for the 4 browser signed-URL uploads (association docs, safety, insurance, work-order photos).
- **Compliance doc AI date extraction — Phase 1** (#271): uploading a COI / inspection report → Claude reads the deadline → **pre-fills** the field (staff confirm); Sunbiz "last date to file without penalty (May 1) · $400 after · dissolution 4th Fri Sept".
- **Staff "PMI Top Florida Daily News"** (#265/#266): branded Mon–Fri 6am-ET email, per-staff week-to-date ticket/WO counts (open/resolved/late) + "Team · Unassigned" + improvement-ideas board (`/admin/ideas`) + "Send now" button. AI bot excluded.
- **Gmail add-on deployed to Workspace Marketplace** (private) + admin-installed org-wide. Manifest `urlFetchWhitelist` fix + store assets (#272).
- **CINC_SYNC_ENABLED=true** set in Vercel — work-order→CINC sync (`createLinkedWorkOrder` via the outbox drain cron) is now active.
- **Invoice single-card pager** (#274): one invoice per view across all 4 tabs + ◀ N/total ▶ pager; payment-method auto-fills from the vendor's CINC default.
- **Invoice "On Hold" workflow** (#275): On-hold tab; ⏸ put-on-hold modal (request COI/license/W-9/ACH checklist + note), optional follow-up Vendor-Compliance work order, tokenized vendor upload-link email; on-hold banner + Release.
- **Admin nav cleanup** (#275/#276): trimmed to day-to-day tabs, Performance/CINC-Sync/Sunbiz/Ideas/Tools moved into the Control Panel "Admin tools" row, Recurring → orange button on the Work Orders page; nav now fills the bar left-aligned.
- 🟡 **Vendor attachments: view / download / AI-read** (#276, in review): PDFs/docs render as openable file cards (not broken thumbnails) + one-click **Download**; vendor uploads hard-capped at 4 MB after compression (refused otherwise); **Claude reads each vendor doc on upload, before compression** — classifies W-9/COI/ACH/license/insurance + pulls key fields (sensitive values masked to last-4) → doc-type badge + "🔎 Detected" staff note + `extracted_data` stored. Migration `20260605_vendor_doc_extraction.sql`.

---

## 🟠 Owner / admin actions (not dev)
- One-time **reconciliation "Sync" per association** (or wire a "Sync ALL" button) — **[carry-over BLOCK 3]**.
- **CINC config gaps** for Jonathan: DELA mgmt budget = $0; VEN1/VEN2 empty budgets — **[carry-over BLOCK 4]**.
- Each staffer pastes their add-on token from `/admin/addon` once.
- ⚠️ CINC WO auto-create needs **one seed WO per association** in CINC first (else "Cannot resolve AssocId").

---

## 🟢 Development backlog

### 1. Owner Self-Service — *decisions locked, nothing built (highest new value)*
- 🔴 **Owner ledger by request** — owner identified once via OTP, then requests by **email / WhatsApp / SMS** → fetch CINC per-owner statement → deliver PDF.
- 🔴 **Owner balance/status on `/my-account`** — current balance, last payment, next due (from CINC).
- 🔴 **Owner payments** — surface **CINC WebAxis link + check/ACH** info on `/my-account` (Stripe is application-fee ONLY).

### 2. Leasing / Applications
- 🔴 **Per-association rules acknowledgment** inside `/apply` (rules content + sign step) — decision #1; likely a small migration.
- 🟡 **Background-check end-to-end verification** + clear board status (Applycheck callback/poll, re-invite) — decision #4 · **[carry-over H1]**.
- 🟡 Edge cases: co-applicant payment split, resume-link expiry, partial-pay.

### 3. Compliance — *Phase 2 (needs migrations)*
- 🔴 Upload + AI date extraction for **unit-level** items (leases, HO-6, CoU, violations) and **vendor COI/license** expiry — **[carry-over I5]**.
- 🔴 Generalized **deadline-rules config** (municipal CoU/permit cycles, Sunbiz) + `last_date_without_penalty`/`penalty_after`/`final_date` columns.
- 🔴 **Reserve-study tracking** (3-yr freshness, lender req) — **[carry-over I14]**.
- 🔴 **D&O renewal workflow** — **[carry-over I9]**.
- 🔴 **Document AI retrieval** (ask questions against stored compliance docs) — **[carry-over I13]**.

### 4. Vendor / Recurring Services — *[carry-over 2026-05-31]*
- 🟡 **Push extracted vendor data → CINC vendor record** (NEW 2026-06-04 · **ACH + W-9 BUILT (PR pending); COI + license next**) — Claude reads an ACH/W-9/COI/license off a vendor upload (#276); staff push it to the CINC vendor file via the **"→ CINC"** action on the attachment. Endpoints all confirmed writable:
    - ✅ **ACH banking** → `PATCH /vendors/vendor` `{ VendorID, Routing, Account, AccountType }` (read-back from `GET /vendors`). **BUILT.**
    - ✅ **W-9 / 1099** → `PATCH /vendors/vendor` `{ TaxID, CheckName, ... }`. **BUILT.**
    - 🔴 **COI (+ PDF)** → `PATCH /vendors/vendorInsuranceUpdateByteArray` (file as base64; `InsuranceId`=type, `AccountNumber`=policy#, `Expiration`, `InsuranceCarrier`). *Next.*
    - 🔴 **License** → `POST /vendors/vendorLicense` `{ VendorId, LicenseType, LicenseNumber, LicenseExpiration, ... }`. *Next.*
    - UX (built): `GET …/attachments/[attId]/cinc-vendor` returns a **masked** current-vs-extracted diff; `POST` applies staff-approved field keys. ⚠️ Full ACH/EIN are **re-extracted server-side at apply** (`extractVendorDocument(..., {mask:false})`) and written to CINC — never stored, never sent to the browser. Only `VendorID` required on the PATCH → writes just the changed fields. Resolves `VendorId` from `work_order_details.cinc_vendor_id` (prompts to link a vendor if missing).
    - Future: **auto-apply** (skip the modal) once trusted; backfill button for pre-existing attachments.
- 🔴 **Vendor procurement inside work orders** (NEW 2026-06-04, Paola) — drive ALL vendor comms from inside the WO so a service request *forces* a work order + keeps the whole thread in Maia. Sub-parts:
    - **Send vendor emails from a WO** using a service mailbox (`service@topfloridaproperties.com` / `service@pmitop.com`) — the ticket detail already has Email/SMS/WhatsApp/Internal-note compose tabs (`appendMessage` + `lib/gmail`); work = wire the **From/Reply-To to service@** + ensure replies thread back onto the WO (Gmail watch / Message-ID). *(Feasible now.)*
    - **Request-for-estimate email** with the tokenized vendor **upload link** (reuse `signVendorUploadToken`) so vendors upload estimates straight to the WO.
    - **Estimate comparison view** — side-by-side vendor/amount/scope (with estimate images) once ≥2 estimates are in.
    - **Board approval report** — generate a comparison report → email the board → capture approve/decline → on approve, set the WO vendor + move it forward (ties into the existing "non-recurring WO → estimates board report" item below).
    - ⚠️ Decisions needed: which sender (`service@` vs `maia@`), whether the mailbox is Gmail-watched for replies, board-approval delivery (email link vs `/board`).
- 🔴 **Control Panel "Recurring Work Orders" card** (🟢/🟠/🔴 vendor weekly-report status) + status table.
- 🔴 **Non-recurring WO → estimates board report** (vendor/amount/scope comparison **with estimate images**) for board approval.
- 🔴 **Non-recurring WO weekly office chase** (extend the Friday agenda email).
- 🟡 **Phase 3b** — weekly reminders for visits missing photos + "X of Y documented" coverage report (buildable now).
- ⚠️ **Phase 3c** — monthly-invoice rollup → ONE CINC work order bundling the month's visits (decisions locked; verify CINC WO-create end-to-end now that `CINC_SYNC_ENABLED=true`).
- 🔴 Add-on sidebar **"vendor upload link"** button + `/api/addon/tickets/[id]/vendor-link`.

### 5. Invoice (remaining)
- 🔴 **Drive link for manually-placed files** — SA `drive.file` can't see hand-dropped files (MAIA-created copies are covered by the impersonation fix).
- 🟡 **Funds-check persisted settings panel** (per-assoc knobs without a deploy).
- 🔴 **Auto-association first-time** (brand-new vendor, no history) — live CINC cross-association ledger scan (deferred from the webhook path).

### 6. Comms / Gmail / MAIA
- ⚠️ **One-click "forward invoice to maia@"** in the add-on — was blocked on `gmail.compose` re-consent; now the add-on is admin-installed with that scope trusted → **revisit / enable** · **[carry-over]**.
- 🔴 **SENT-folder Gmail watch** — capture staff replies sent *without* maia@ on the thread — **[carry-over]**.
- 🟡 **Ticket "kind" badges** (RTK/ATK/ITK, AWK/RWK) display-only — **[carry-over]**.
- 🔴 **MAIA "Teaching" mode** (freeform) — **[carry-over C1]**.

### 7. Reconciliation / CINC *(mostly cleared this session)*
- 🟡 True vendor name for **CINC-native** invoices in reconciliation (per-invoice CINC lookup during sync) — **[carry-over follow-up]**.

### 8. Infra / cleanup — *[carry-over]*
- 🟡 Pre-existing `react-hooks/set-state-in-effect` lint errors (FundsCheck, VendorCombobox, compliance managers' load effects).
- 🟡 Prune merged local branches; `middleware → proxy` Next.js 16 deprecation.

---

## Decisions captured (the spec for the above)
1. **Application forms** — only remaining work is per-association rules acknowledgment inside `/apply`.
2. **Owner ledger** — 1× OTP then request by email/WhatsApp/SMS; multi-channel delivery; needs a CINC per-owner statement fetch.
3. **Owner payments** — CINC WebAxis / check / ACH; **no Stripe** for owner assessments.
4. **Background check** — verify Applycheck end-to-end + surface status to the board.

(Detail in memory: `owner_self_service_decisions.md`, `staff_daily_news.md`, `compliance_deadlines.md`, `invoice_process_rework.md`, `gmail_addon.md`.)

## Suggested priority
1. Background-check verification (decision #4) → 2. Owner Self-Service (ledger + balance + payment links) → 3. Recurring-WO Control Panel card + estimates board report → 4. Compliance Phase 2 → 5. Per-association app rules, then smaller comms/invoice follow-ups.
