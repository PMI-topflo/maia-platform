---
name: implementation-roadmap-2026-06
description: "MASTER prioritized implementation plan as of 2026-06-18. MAIA is STAFF-ONLY today (internal routines, not customer-facing). Top priorities = Work Order workflow with Paola + the Application package. Customer-facing items (voice, owner payments) deferred."
metadata: 
  node_type: memory
  type: project
  originSessionId: 0f966d35-5727-4b77-8261-7f0eced7619a
---

# MAIA implementation roadmap — 2026-06-18

**Reality:** MAIA is used by **STAFF ONLY** right now (internal routines), NOT customers. So customer-facing features are DEFERRED until a customer rollout. Order below reflects that. Full gap source: [[session-2026-06-17-compliance-vendor-onboarding]] audit + docs/ROADMAP.md.

> **UPDATE 2026-06-18/19** (see [[session-2026-06-18-personas-portals-docs]]): shipped #395–#405 — New-WO form (#396), Personas hub + per-person Messages (#399), vendor↔association linking Personas+Hub (#403), HEIC→JPEG (#401), hub type fix (#402), resident-portal standardization 25→1 (#404), portal docs moved off Google Drive into MAIA (#405). ⚠ PENDING: (a) apply `association_vendor_links` migration; (b) UPLOAD each association's documents INTO MAIA — Drive removed so portal Documents are empty until staff upload (GVH's old per-category Drive docs NOT auto-migrated).

## PHASE 1 — Work Order workflow with Paola  ⬅ TOP PRIORITY
Already shipped (#387–#397): per-WO "+ Add invoice", ACH/W-9 compliance gate (cc Paola=service@), board-approval popup, payment lifecycle (ready_for_payment→paid + auto-close), full vendor onboarding (createVendor + dedupe + portal + ACH-confirm), **New Work Order CREATION form (#396)** + vendor search-before-create (#397) + MAIA-local vendor↔association linking (#403).
Build next:
1. ~~New Work Order creation form~~ ✅ DONE (#396).
2. **Estimate-comparison board report WITH IMAGES** (side-by-side vendor/amount/scope) + estimate→board approval polish. Phase C remainder. ⬅ **NEXT WO ITEM** (offered this session, not built).
3. **Service Issues PR2/3** UI (complaint → recurring service → vendor resolution; before/after photos). Backend table exists.
4. **Recurring-services control panel**: weekly vendor 🟢/🟠/🔴 status, visits-missing-photos report, **monthly invoice rollup → ONE CINC WO** (Phase 3c — verify CINC WO-create now CINC_SYNC_ENABLED=true).
5. Verify the #394 ACH-confirm end-to-end once a real vendor onboards.

## PHASE 2 — Application package (staff side)  ⬅ TOP PRIORITY
Already built: `/apply` form (6 lang), Stripe application-fee, `/admin/applications` review + board approve/reject, doc acknowledgment, e-signature, Applycheck INVITE on payment.
Build next:
1. **Applycheck results webhook** `app/api/applycheck-webhook` — MISSING; the screening is invited but results never return. Receive + store `applycheck_report_url`/status, mark complete. **The one functional gap in the pipeline.**
2. **Board-visible screening status + "view report" link** in `/admin/applications`; co-applicant re-invite flow.
3. **Application package assembly ("Jonathan compliance pkg")** — compile applicant docs + screening result + board decision into one downloadable/sendable package.
4. **Per-association application RULES** — staff-side config now (define rules per association); applicant-facing display deferred to customer rollout. (Small migration.)

## PHASE 3 — Voice agent (Vapi)  ⏸ DEFERRED (customer-facing)
Full decided design in [[voice-plan]]. Don't start until customer rollout. Early-startable piece that also helps STAFF: the **pgvector knowledge base + association/persona-filtered retrieval** (accuracy lever, channel-agnostic). Skip Alexa/Siri/OAuth.

## PHASE 4 — Owner/resident self-service  ⏸ DEFERRED (customer-facing)
Owner ledger/balance + payment links (CINC WebAxis/check/ACH), tenant self-service. See [[owner_self_service_decisions]].

## PHASE 5 — Compliance Phase 2 + smaller follow-ups
Vendor **COI validation** (additional-insured + expiry, auto-correction emails — [[vendor_compliance_cinc_write]]); unit-level doc uploads; reserve-study + D&O renewal tracking; document Q&A (RAG); Gmail "forward invoice to maia@"; true vendor name for CINC-native invoices in reconciliation.

## Operational TODOs
- ⚠ **Apply migration** `20260618_association_vendor_links.sql` in Supabase (idempotent; SQL handed over) — vendor↔assoc linking buttons no-op until then. **Verify applied.**
- ⚠ **Upload association documents into MAIA** (Admin → Associations → assoc → Documents) — Drive removed in #405, portals show empty Documents until uploaded. **GVH** old Drive docs not auto-migrated.
- Delete CINC test vendor **2121** ("ZZ DELETE…") in CINC UI.
- `OWNER_AUDIT_ENABLED=1` only when ready for automated owner doc-request reminders (owner-facing — likely wait given staff-only).
- Optional `CINC_DEFAULT_LICENSE_TYPE` env for onboarding license push.
