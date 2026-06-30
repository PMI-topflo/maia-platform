# MAIA Platform — Open Items / Roadmap

_Last updated: **2026-06-30** (full reconciliation against `main`). Status key: ✅ Live · 🟡 Partial · 🔴 Not built · ⚠️ Blocked · ⛔ Decided off._
_Companion to `docs/SESSION-HANDOFF.md`. **This doc was rebuilt 2026-06-30** after the prior 2026-06-04 version drifted badly — ~11 items it marked 🔴/🟡 had actually shipped. Verified via 3 parallel code-audit agents + direct checks._

> **How to keep this honest:** before quoting a status, grep the codebase — squash-merges land features without anyone updating this file. When you ship something here, flip its status in the same PR.

---

## ✅ Shipped & live — previously mis-marked 🔴/🟡 (verified 2026-06-30)

These were on the "not built" list but are confirmed on `main`:

- **Owner self-service** — ledger-by-request (email/WhatsApp/SMS → CINC statement → PDF, OTP-once, collections gate), balance/payments/ACH-autopay surfaced on `/my-account` via CINC WebAxis (per locked decision; Stripe is application-fee only). `lib/owner-ledger-flow.ts`, `/api/owner/*`, #445–#457.
- **Per-association rules acknowledgment in `/apply`** — doc-gated sign step (must open all required docs), typed + drawn signature + webcam photo + IP/geo evidence, all 7 languages. `/api/apply/association-documents|association-rules|document-text`, `ApplicationForm.tsx`, cols `rules_agreed_at`/`rules_signature`/`rules_signature_image`/`acknowledged_document_ids`.
- **Background-check end-to-end** — `/api/trigger-applycheck` (per-subject, webhook callback) + `/api/applycheck-webhook` + `applycheck_result` cols + `/board/review` surfacing status & report link. `20260625_applycheck_results.sql`.
- **Vendor COI → CINC** (`updateVendorInsuranceFile`, `PATCH /vendors/vendorInsuranceUpdateByteArray`) and **License → CINC** (`createVendorLicense`, `POST /vendors/vendorLicense`).
- **`/admin/vendor-compliance` page** — per-vendor RAG audit, compliance chips, missing-doc list, file viewer.
- **Estimate request → comparison → board approval flow** — `RequestEstimatesModal`, `EstimatesComparison`, `/board/estimate` token approval + signed PDF (`estimate-approval-pdf.ts`), `/api/admin/tickets/[id]/vendor-link`.
- **Forward-invoice-to-maia@** in the Gmail add-on (`forwardToMaiaAction`, `gmail-addon/Code.gs`).
- **MAIA Teaching mode** — `/admin/teach` knowledge studio (upload → AI parse → approve, scoped per association/persona/unit), `maia_knowledge`.
- **True vendor name for CINC-native invoices in reconciliation** (`lib/bank-reconciliation-sync.ts`).
- **`react-hooks/set-state-in-effect` lint errors** — gone.

---

## 🟢 Development backlog — the REAL remaining work

### Top — unblocked, high value
- 🔴 **COI validation** (Paola) — only the expiry check exists today. Build: extract additional-insured entities + each policy's expiry; verify the COI is **not expired** AND lists **PMI Top Florida Properties** (1031 Ives Dairy Road, Suite 228, Miami FL 33179) **and the job's association** as additional insured. **Fuzzy match name AND address** (insurers mangle both): normalize case/punctuation, expand abbreviations (Rd↔Road, Ste↔Suite, FL↔Florida…), anchor on street# + ZIP + core name tokens, accept typos; fail only on genuine absence / clearly-different anchor. On invalid → red flag, **block** marking compliant / releasing the invoice, **auto-draft a correction email** with the exact additional-insured wording.
- 🟡 **Estimate board report WITH IMAGES** — the flow is live; only **estimate image previews** + the board-picks model are missing. Parked tiny on local branch `wip/estimate-board-compare` (`lib/estimate-preview.ts` + `20260619_estimate_board_compare.sql`), tangled with already-merged portal commits — rebuild clean off `main`.
- 🔴 **service@ email-from-WO** — send vendor emails from inside a work order via `service@topfloridaproperties.com`/`service@pmitop.com`, replies thread back onto the WO (the compose tabs + tokenized upload link + comparison + board approval already exist; only the service@ send path is missing). ⚠️ Decide: sender (`service@` vs `maia@`) and whether the mailbox is Gmail-watched for replies.

### Medium
- 🟡 **Recurring-WO Control Panel card** — vendor weekly-report status (🟢/🟠/🔴) in the card itself (the card + `/admin/recurring-services/coverage` table exist; the per-vendor report status indicator doesn't).
- 🟡 **Phase 3b** — weekly "missing photos" reminders + numeric "X of Y documented" coverage (the coverage page shows status only; no reminder cron, no count).
- 🔴 **Add-on sidebar "vendor upload link" button** + `/api/addon/tickets/[id]/vendor-link` (the **admin** route exists; the add-on button + endpoint don't).
- 🔴 **Non-recurring WO weekly office chase** (extend the Friday agenda email; today `recurring-agenda.ts` is recurring-only).
- 🟡 **Applications edge cases** — co-applicant payment split, partial-pay, resume-link expiry (resume-link + co-applicant invite exist; payment-split/partial-pay/expiry don't).

### Bigger / deferred
- **Compliance Phase 2** — 🟡 unit-level AI date extraction (the `document_intake` foundation + taxonomy exist; association unit-lease/HO-6/CoU upload routes don't) · 🔴 generalized **deadline-rules config** (`last_date_without_penalty`/`penalty_after`/`final_date`) · 🟡 reserve-study (generic compliance only — no 3-yr/lender rule) · 🟡 D&O renewal workflow (tracked, no workflow) · 🔴 **document AI retrieval / RAG** over stored compliance docs.
- 🔴 **Funds-check persisted settings panel** (per-assoc knobs without a deploy; today hardcoded constants in `cash-flow-forecast.ts`).
- 🔴 **Auto-association first-time** — live CINC cross-association ledger scan for brand-new vendors (`detectAssociationCode` only does local cache today).
- 🔴 **SENT-folder Gmail watch** — capture staff replies sent without maia@ on the thread (`registerGmailWatch` watches INBOX only).
- ⚠️ **Phase 3c** — monthly-invoice rollup → ONE CINC work order bundling the month's visits (decisions locked, not implemented).
- 🔴 **Drive link for manually-placed files** — SA `drive.file` can't see hand-dropped files (MAIA-created copies are covered by the impersonation fix).
- 🔴 **Ticket "kind" badges** (RTK/ATK/ITK, AWK/RWK) — display-only, low value.

---

## 🗣️ Voice / channels

- ✅ **Live:** SMS / WhatsApp / phone voice across all 7 languages (Twilio TwiML `<Say>`/`<Gather>` + Amazon Polly, mid-call language auto-switch). **Voice language parity is 5 native + 2 degraded:** EN/ES/PT/FR/RU native; **Hebrew falls back to an English voice (broken), Haitian Creole to French (approximate)** — Polly has no Hebrew/Creole voice. Text/WhatsApp = full 7. *(English brand-name pronunciation in non-English voices fixed via SSML `<lang>` — PR #470.)*
- 🟡 **Deferred — natural-voice agent** (`voice_plan.md`): Vapi + bring-your-own-Claude `/chat/completions` SSE shim + Deepgram STT + Cartesia/ElevenLabs TTS + pgvector. Not built; needs accounts/keys. **Would also bring voice to 7/7** (ElevenLabs/Cartesia support Hebrew + Creole). Deferred because MAIA is staff-only today.
- ⛔ **Alexa / Siri / Google Assistant** — deliberately **not building**. Phone caller-ID identity already works (`buildCallerContext`); device OAuth-linking is friction with no payoff and forces their robotic voices.

---

## 🟠 Owner / admin actions (not dev)
- One-time reconciliation **"Sync" per association** (or wire a "Sync ALL").
- **CINC config gaps** for Jonathan: DELA mgmt budget = $0; VEN1/VEN2 empty budgets.
- Each staffer pastes their add-on token from `/admin/addon` once.
- ⚠️ CINC WO auto-create needs **one seed WO per association** in CINC first (else "Cannot resolve AssocId").

---

## Decisions captured (spec for the above)
1. **Owner ledger** — 1× OTP then request by email/WhatsApp/SMS; CINC per-owner statement → PDF. ✅ built.
2. **Owner payments** — CINC WebAxis / check / ACH; **no Stripe** for owner assessments. ✅ built.
3. **Background check** — verify Applycheck end-to-end + surface to board. ✅ built; screening provider pivot to Certn is the open piece (⚠️ blocked on sandbox keys — ApplyCheck has no API).
4. **Per-association rules ack** in `/apply`. ✅ built.

(Detail in memory: `roadmap_reconciliation_2026_06_30.md`, `owner_self_service_decisions.md`, `screening_provider_pivot.md`, `voice_plan.md`.)

## Suggested priority
1. **COI validation** (top unblocked, real operational need) → 2. **Estimate board report with images** (near-done quick win) → 3. **service@ email-from-WO** (completes vendor procurement) → 4. medium WO/recurring items → 5. Compliance Phase 2 (deadline-rules + document RAG) → 6. smaller comms/invoice follow-ups.

**Blocked / external:** screening adapter → Certn (sandbox keys); natural-voice agent (Vapi/Deepgram/ElevenLabs accounts).
