---
name: session-2026-06-17-compliance-vendor-onboarding
description: 2026-06-17 session — shipped
metadata: 
  node_type: memory
  type: project
  originSessionId: 0f966d35-5727-4b77-8261-7f0eced7619a
---

# 2026-06-17 session — compliance + invoice/WO + vendor onboarding

ALL MERGED to main; all migrations applied (verified live in DB). No open PRs at session end.

## Shipped (#385–#394)
- **#385** Compliance Outreach page (`/admin/compliance-outreach`) — send owner doc requests per association, track Sent → Clicked → ✅ Received. Migration `owner_compliance_requests.opened_at`.
- **#386** Manual "Add invoice" upload on `/admin/invoices` (was a dead-end; `+ Add invoice` runs the same email-intake pipeline). Deep-link `?upload=1&assoc=CODE` from association Actions.
- **#387** Association **switcher** in the hub header + per-WO **"+ Add invoice"** (Overview + Work Orders tab) + **payment lifecycle** (`tickets.payment_state`: ready_for_payment → paid; WO auto-closes when invoice pushed to CINC).
- **#388** Invoice Intake **"🛡 View board approval"** popup on WO-linked invoices (renders the approved estimate + board signatures via `estimate_approvals`/`estimate_approval_reviews`).
- **#389** **Operating Manuals** under Help (`/admin/help/manuals`): Work Order / Compliance / Financial, step-by-step with **drawn annotated mockups** (not screenshots). Application manual intentionally deferred.
- **#390** Cash-flow strip fix in `lib/cash-flow-forecast.ts`: **exclude inter-account transfers/sweeps** from `averageMonthlyNetFlow` + `detectIncomeProfile` (they were counted as spend → phantom-negative graph) + spread recurring spend across the month + pro-rate the current month.
- **#391** **ACH/W-9 compliance gate** before adding an invoice to a WO (`lib/wo-vendor-compliance.ts`): blocks upload if vendor missing ACH/W-9 in CINC, lets staff request docs from vendor (**cc Paola = service@topfloridaproperties.com**), flags WO (`tickets.vendor_docs_requested_at`) with auto-clearing "⚠ Awaiting ACH/W-9" badge. `sendEmail` gained `cc` support.
- **#392–#394** **Vendor onboarding** (Paola onboards a brand-new vendor not in CINC):
  - `createVendor()` in cinc.ts — POST /management/1/vendors VERIFIED LIVE: body `{ Name, VendorTypeID, Email, Phone1, Address1, City, State, ZipCode, Status:-1 }` → 201 `{ VendorId }`. Statuses: -1 Active, -2 Hold. Types are int IDs (16 = "Not Assigned"). **No CINC delete-vendor API** (deactivate via PATCH Status:-2).
  - **Duplicate check before create** (`lib/vendor-dedupe.ts`): scores existing CINC vendors on name/DBA/CheckName/email/phone/address (noise-stripped + token similarity) via `listVendorsFull()`. Verified: "Summit Fire Security" → matched "Summit Fire & Security, LLC".
  - Standalone onboarding portal `/vendor/onboard/[token]` (no login, no WO) reusing W9Section/AchSection (added `apiBase` prop) + COI/license uploader. **W-9 + COI auto-apply to CINC; license best-effort; ACH captured ('received') then a staffer confirms** (`/admin/vendor-onboarding` → "Confirm banking → CINC", fraud control).
  - `vendor_onboarding` table; private `vendor-docs` bucket (auto-created). Staff modal `OnboardVendorModal` wired into the association **Vendors tab** and the **WO Add-invoice popup**.
  - Fixed latent `listVendorTypes()` bug (CINC field is `VendorType`, not `Description`).

## Operational TODOs (owner-side)
- **OWNER_AUDIT_ENABLED=1** (Vercel) — owner-compliance AUTO reminders stay off until set; manual send works now.
- **Delete CINC test vendor 2121** "ZZ DELETE - MAIA test vendor (inactive)" (left by create-probe; already Hold; CINC UI only).
- Optional `CINC_DEFAULT_LICENSE_TYPE` env — onboarding license push uses a default type int otherwise.

## Audit verdicts (2026-06-17) — corrects assumptions
- **Voice/phone agent = ALREADY BUILT** (Twilio Voice IVR + Polly multilingual TTS + speech/DTMF + WhatsApp bridge, all in `app/api/webhook/route.ts`). Not a backlog item.
- **Application/leasing = BUILT** end-to-end (`/apply` form, Stripe app-fee, `/admin/applications` review + board decision). Stripe is **application-fee ONLY**.
- **Multi-language = BUILT** (6 languages) — see [[multi_language]].

## Top MISSING / PARTIAL (prioritized)
1. **Applycheck background-check webhook** — `/api/trigger-applycheck` invites the screening but `/api/applycheck-webhook` (referenced) does NOT exist → results never return; no board-visible report. HIGHEST VALUE.
2. **Owner self-service payments/ledger** on `/my-account` — no balance, no pay (CINC WebAxis/check/ACH per [[owner_self_service_decisions]]).
3. **Per-association application rules** text/ack inside `/apply` (only generic consent + PDF ack today).
4. **Estimate-comparison board report** with vendor/amount/scope + images.
5. **Vendor COI validation** (additional-insured + expiry; auto-correction emails) — see [[vendor_compliance_cinc_write]].
6. **Compliance Phase 2** — unit-level uploads, COI/license expiry tracking, reserve study, D&O renewal, doc Q&A.
7. Smaller: recurring-services status board, Gmail "forward invoice to maia@", monthly invoice rollup to one CINC WO.

**Why:** keeps the next session from re-investigating what's done; corrects two wrong assumptions (voice + application are already built).
**How to apply:** start from item 1 (Applycheck webhook) unless the owner redirects. Related: [[staff_daily_news]], [[reconciliation_workflow]].
