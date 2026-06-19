---
name: session_2026_06_11_recon_estimates
description: 2026-06-11 session — shipped PRs
metadata: 
  node_type: memory
  type: project
  originSessionId: 8d7a3329-593a-40ca-9d6d-b7eb81f4120a
---

**2026-06-11 marathon session.** All merged to main. PRs:

- **#349** invoice PDF rasterize-when-oversized (text-layer preserved); **#358** later fixed BLANK invoice PDFs — only rasterize when over CINC's ~1 MB limit (rasterizing born-digital/form PDFs was dropping their text).
- **Phase C estimate approval — PR1 only (#350):** board signer selection (defaults to President), signed-PDF (pdf-lib appends a Board Approval page) filed on MAIA + CINC work order, notify board+Paola+winning vendor. ⏳ **PR2 (C4 award + request missing W-9/license/COI + C6 loser notices) and PR3 (C5 agenda link → service visit on association calendar) NOT built.** Spec is locked.
- **WO sidebar (#351):** Association + Vendor lead the work-order sidebar. **WO link/lifecycle (#353 + re-applied #354):** inbound CINC sync no longer reverts a resolved WO to pending or clears a staff-assigned vendor; invoice→WO picker shows ALL assoc WOs (vendor = preference not hard filter) with MAIA status/vendor (#356); pushing a linked invoice auto-closes the WO as PAID, partial/downpayment flag keeps it open.
- **Service Issues — PR1 only (#352):** recurring-service complaint → "🔁 Recurring-service issue" button routes it to the vendor's next visit (emails vendor+Paola+resident with the issue photo). ⏳ **PR2 (resolution loop: vendor resolves + after-photo on agenda → Paola 1-click confirm + 5-day auto-confirm + resident re-open) and PR3 (per-vendor accountability) NOT built.**
- **Before/after WO photos (#355):** +Before/+After upload + B/A tag on thumbnails. **Pull-from-email (#357) + auto-on-reclassify (#359):** back-fill a WO's photos from its source Gmail thread.
- **Income-aware funds-check (#360→#361):** see [[funds_check_income_model]]. **Reconciliation batch (#362):** cash-flow strip on recon, Rec. checkbox leftmost, Vendor/Payee filled from full invoice list, removed Invoice/PMI-Coord cols, styled .xlsx export (added **exceljs**), CINC invoice document preview at top of detail popup, MAIA-read invoice "description" (e.g. "2 units roof leaks") extracted → intake review/approve → recon Description.
- **2026-06-12 follow-ups (#363–#367):** #363 (doc-preview JSON+base64 decode — CINC /document/{ImageID} returns `[{FileName,FileType,FileData(base64)}]` NOT raw binary; recover LFA-style blank Vendor/Payee from the paired EXPENSE-DEBIT leg when the cash line is mislabeled with a bank-account name; **prefer CINC BankBalance over CincBalance** — book balance lagged the bank, e.g. Manors 5641 $65k vs bank $166k; slimmer cash-flow strip; big assoc-name+month heading). #364 (one cash-flow graph per CLICKED bank card + SSB "Operating"-named account always first/left). #365 (week date+balance INSIDE each strip box). #366 (manual-group strip backstop — operating account at a non-SSB bank). #367 (**cross-status invoice SEARCH bar** on intake — invoice#/vendor/assoc/acct#/description/amount across all tabs). #368 (**Paola maintenance guide** at `docs/PAOLA-WORK-ORDER-GUIDE.md` + an in-app `/admin/help` section + 5 team **daily-news "What's New"** entries dated 2026-06-15/next-Monday; `recentWhatsNew` now hides FUTURE-dated items until their date so announcements can be scheduled). ⚠️ squash-strand bit us ~4× — MERGE EACH PR FULLY BEFORE PUSHING THE NEXT.

**ALL #349–#368 merged + verified on main (2026-06-12).** Session closed.

**2026-06-12 multi-language follow-up — #369 + #370 MERGED.** #369 aligned the vendor-crew language set to resident-6 + Kreyòl (7), authored pt/fr/he/ru/ht across agenda email + crew messages + vendor token pages (Hebrew RTL). #370 added the in-page language switcher + save-as-default on the vendor upload/agenda pages (per-employee `crew-token`, save endpoints write `vendor_employees.preferred_language` / `recurring_services.office_language`). See [[multi_language]]. ⚠️ #370 stranded off #369's squash-merge — recovered via cherry-pick onto fresh main (squash-strand AGAIN: merge each PR fully before pushing the next commit).

**FULL NEXT-SESSION BACKLOG (corrected — user flagged missing items):**
- **APPLICATION PROCESS** — the full applicant/leasing pipeline (lease + purchase apps end-to-end; applicant status H1; per-association application rules acknowledgment inside `/apply`).
- **BACKGROUND CHECK** — applicant background-check verify (decision 4). Trigger lives at `/api/trigger-applycheck` (guarded by INTERNAL_API_SECRET); needs the verify/result-handling step.
- **PAYMENT FOR THE BACKGROUND CHECK** — applicant pays the application/background-check fee via **Stripe** (note: Stripe is application-fee ONLY here; owner payments go through CINC WebAxis/check/ACH — see [[owner_self_service_decisions]]).
- **VOICE CONNECTION = AI VOICE AGENT that ANSWERS CALLS** (confirmed 2026-06-12). An AI agent answers an inbound line, handles common questions, and routes/escalates to staff. Likely Twilio Voice (inbound) + a realtime/voice AI agent; tie into tickets. (Project already uses Twilio for SMS/WhatsApp — TWILIO_PHONE_NUMBER.)
- **FULL COMPLIANCE PACKAGE FOR JONATHAN = all three (confirmed 2026-06-12):** (1) **COI validation** — auto-check vendor COI name+address vs PMI and the association's PROPERTY address → flag / block / auto-correct mismatches; (2) **COI/W-9/license PUSH to the CINC vendor record** (UI); (3) **vendor-compliance AUDIT panel/page** — per-vendor compliance status (COI, W-9, license expiry) per association, showing what's missing/expiring. (Jonathan = recon/AP staff who owns this.) Builds on #276–#279 vendor-doc extraction + Apply-to-CINC ACH/W-9 push.
- **MULTI-LANGUAGE — ALREADY BUILT, NOT a backlog item** (corrected 2026-06-12 after I wrongly called it missing). See [[multi_language]]. MAIA's resident-facing chat/homepage (`app/page.tsx`) already supports the user's **6 languages: English, Spanish, Portuguese, French, Hebrew, Russian** (`type Lang = 'en'|'es'|'pt'|'fr'|'he'|'ru'`, full picker + translated greeting/UI), and `lib/association-documents.ts` lists he/ru too. SEPARATE narrower **vendor-crew** set in `lib/translate.ts` + `lib/recurring-services.ts` = `en/es/pt/ht/fr` (Haitian Creole for crews; NO ru/he). My earlier "only en/es exist" was wrong — I generalized from the vendor-crew slice without grepping the whole system.
- Phase C PR2 (award + missing W-9/license/COI + loser notices) & PR3 (vendor scheduling → service_visit on assoc calendar).
- Service Issues PR2 (resolution loop: vendor resolves+after-photo → Paola 1-click confirm + 5-day auto-confirm + resident re-open) & PR3 (per-vendor accountability).
- Recon monthly-export PAGE (all assocs + Download each + reconcile-incomplete warning + daily-news link, Isabela downloads → Drive).
- Monthly-report enrichment w/ the MAIA-read description.
- Staff Daily News build-out; owner self-service.

⚠️ VERIFY after deploy: (1) invoice doc preview renders (CINC /document/{ImageID} raw-binary assumption); (2) styled .xlsx opens nicely in Google Sheets; (3) income-model assessment cadence matches a real monthly + quarterly assoc.

PENDING / NEXT: Phase C PR2+PR3; Service Issues PR2+PR3; recon monthly-export PAGE (all assocs + reconcile-incomplete warning + daily-news link, Isabela downloads→Drive); monthly-report enrichment with the new description. Branch discipline: merge one PR fully before pushing the next (squash-strand bit us 3× this session).
