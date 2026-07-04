# MAIA Platform — Open Items / Roadmap

_Last updated: **2026-07-04**. Status key: ✅ Live · 🟡 Partial · 🔴 Not built · ⚠️ Blocked · ⛔ Decided off._
_Companion to `docs/SESSION-HANDOFF.md`. **This doc was rebuilt 2026-06-30** after the prior version drifted badly — verify against the codebase before quoting a status; squash-merges land features without anyone updating this file._

> **How to keep this honest:** before quoting a status, grep the codebase. When you ship something here, flip its status in the same PR.

---

## ✅ Shipped & live — Pre-registration triage Phase 1 (#505, merged + verified landed)

See the full entry under "Development backlog" below (kept there since it started as that backlog item) — staff alert broadened to all staff, `/admin/pre-registrations` dashboard, Approve/Add routes per persona to existing mechanisms (owner/board/agent/vendor/buyer). Tenant is a placeholder pending Phase 2 (lease + board-approval-letter verification — design agreed, not built, see `pre_registration_triage.md` in memory).

---

## ✅ Shipped & live — Pre-registration triage Phase 2 + unit occupancy control (2026-07-04, committed to main)

- **Phase 2 tenant verification** — new `tenant_verifications` table + `tenant-verification-docs` private bucket (migration `20260704_tenant_verifications.sql`, applied). Tracks lease/board-approval-letter path + source (`tenant`|`owner`|`staff`) per doc, owner confirmation, and a derived `status` (`pending`→`awaiting_owner`/`ready`→`approved`/`rejected`) computed by shared `lib/tenant-verification.ts:computeStatus()`. Three upload paths into one table: (1) tenant self-upload right after `/pre-register/<token>` (same token, no new type); (2) owner confirm+upload at new `/owner/tenant-verify/<token>` (`lib/tenant-verification-token.ts`, 21-day TTL), "No" → `rejected` + staff alert; (3) staff via new `TenantVerificationModal` on `/admin/pre-registrations` (replaces the old "coming soon" badge) — staff resolve the pre-registration's free-text association/unit into a real `association_code` first (there's no such column on `pre_registrations` itself). Approve mirrors MAIA's existing "new tenant" insert side effects (archive prior tenant, `tenant_history`) and additionally sets `unit_occupancy` to `leased`.
- **`/admin/unit-status` dashboard** — portfolio-wide occupancy (`unit_occupancy`) + active-tenant lease-expiry + per-unit compliance-doc-completeness, one row per unit (687 units after grouping co-owners — was silently truncated to Supabase's 1000-row cap before a `.range()` pagination fix). Filters: association, occupancy, lease-expiring-within-30-days. Mounts the existing generic `DriveImport` component (`app/admin/documents/inbox/DriveImport.tsx`) for pulling docs from a shared Drive folder straight into the Document Inbox review queue — reused, not rebuilt.
- **Owner occupancy/insurance survey campaign** — new `surveyMode` on `runOwnerComplianceAudit()` (`lib/compliance-owner-audit.ts`) sends to every active owner regardless of missing-docs state (vs. the automated audit's missing-only gate), triggered from `/admin/unit-status`'s "Send occupancy & insurance survey…" button with a dry-run-then-confirm UX (never sends live without an explicit second click). Extended `/owner/compliance/[token]` with: a **business/usage-type** free-text field for commercial units (`unit_occupancy.commercial_use_type`, new column) and a **self-reported insurance-type dropdown** next to each missing insurance item (`compliance_records.declared_type`, new column) — deliberately not pre-filled to the "expected" policy, since a mismatch is itself the compliance signal. Migration `20260704_unit_survey_fields.sql`.
- **Bug caught and fixed during verification**: `setCommercialUseType()`'s upsert silently failed (error swallowed) when no `unit_occupancy` row existed yet, because `status` is `NOT NULL` with no default and the use-type-only payload never set it — the owner-facing UI showed "✓ Saved" while nothing was written. Fixed to check-then-update only, returning a clear "pick occupancy first" error instead of a false success.
- **Verified end-to-end** with disposable test fixtures (inserted directly, cleaned up after — no real emails sent; the one real outbound send path, survey confirm, was exercised via dry-run only against a real association's real owner emails, never the live confirm+send).

---

## ✅ Shipped & live — Flows diagrams initiative (#502, #504, both merged + verified landed)

- **Flow inventory** — MAIA has ~51 distinct end-to-end business flows across 10 categories (communications, invoicing, vendor management, work orders/estimates, recurring services, leasing, compliance, self-service, board/governance, operational). Full list in memory (`maia_flows_inventory.md`).
- **New sidebar "Flows" section** — houses every flow diagram in one place (previously just "Voice Flow" buried under Tools). Moved Voice & Text Routing here, added Estimate & Board Approval.
- **`FlowDiagramKit.tsx`** — shared Box/Diamond/Arrow/NodeModal/Legend SVG components, extracted so future diagrams don't re-copy the Voice Flow diagram's original ~150 lines of hand-rolled boilerplate.
- **First new diagram: Estimate & Board Approval** — built first since it was just rebuilt this session (#501) and freshest in context. Prioritization going forward: flows where MAIA talks to someone **outside the company** (vendors, board members, applicants) first, not the full 51 speculatively.
- **Click-to-preview real content** — every external-facing node's modal shows the actual email (To/Subject/HTML body, lifted verbatim from the sending code) or actual form UI the person sees, not a paraphrase. Standing rule going forward: keep each diagram in sync with its flow's code in the SAME PR whenever behavior changes — never let it drift (see `feedback_diagram_maintenance` in memory).
- **Second diagram: Vendor Onboarding** — staff dedupe-check + CINC create/link → vendor's token-scoped self-service portal (W-9/ACH/COI/license) → W-9 and COI/license auto-apply to CINC immediately, ACH is deliberately held for a staff fraud-control confirm before it touches CINC. Next candidates: `/apply` Tenant/Buyer Application, Weekly Agenda/Service Visit.

---

## ✅ Shipped & live — Estimate board report with images (#501, merged + verified landed)

- **Board-picks vendor comparison** (#501) — replaces "staff pre-picks ONE vendor" with "staff send the whole comparison, each board signer picks which vendor they approve." New columns (migration applied): `estimate_approval_reviews.selected_vendor_request_id` (which vendor each signer picked) + `estimate_approvals.recommended_vendor_request_id` (optional staff highlight). The approval's `vendor_request_id`/`vendor_name`/`amount` stay NULL until enough signers converge on the SAME vendor.
- **Inline image previews** — new shared `lib/estimate-preview.ts` renders a vendor's estimate (PDF or image) to inline JPEG pages; used by a new staff preview route and the existing board preview route (now supports per-vendor selection instead of only the stamped winner).
- **Rebuilt clean off `main`**, not merged from the parked `wip/estimate-board-compare` branch — that branch was ~2 weeks stale (predates COI validation, the portal rewrite, WhatsApp templates, voice IVR redesign — 179 files of divergence) and would have reverted all of it. Pulled just the isolated estimate files and reconciled each against current `main` (e.g. preserving the `VENDOR_NOTIFY_CC` bcc convention the WIP branch predates). That local branch can now be deleted.
- **Correctness fix found while wiring this up**: `finalizeEstimateApproval`'s signer list only filtered on `decision='approve'`, not which vendor was picked — with signers now able to disagree, that could've listed a signature under the wrong vendor's official approval PDF. Fixed with an added `selected_vendor_request_id` filter.
- Verified end-to-end with real fixtures (cleaned up after, no CINC/email side effects): confirmed two signers picking different vendors correctly stays unfinalized (the core new consensus logic), then confirmed a converging approval finalizes correctly (winner/loser outcome stamped, real signed PDF generated + filed, estimate request closed).

---

## ✅ Shipped & live — COI validation PR2b: invoice-push block (#500, merged + verified landed)

- **Invalid-COI invoice-push guard** (#500) — clones the double-pay hard-block pattern in `app/api/admin/invoices/intake/[id]/push/route.ts`: pushing an invoice for a vendor with a genuinely invalid COI (expired, or missing a required additional-insured) now 409s unless the pusher is Karen. Unverifiable/no-COI-at-all never blocks (stays the existing soft "flag for re-upload" treatment).
- **Vendor exemptions** — before building, checked whether CINC already tracks "does this vendor need a COI." It does (`vendorInsurance.isRequired`, per vendor + insurance type) but live-probing 10 real vendors (27 rows) showed **every single one reads `false`** — the field is never touched by anyone, so it can't be trusted as a real signal on its own. New `vendor_coi_exemptions` table (migration applied) is the actual gate — staff toggle "Mark COI not required" on `/admin/vendor-compliance` with a reason — which also mirrors the value into CINC's `isRequired` flag on a best-effort basis. Also fixed `getVendorInsurances()`, which was silently dropping `isRequired`/`InsuranceType` due to wrong field names.
- Verified: live CINC write-then-revert test on a real vendor (confirmed the update endpoint updates in place, no duplicate rows, no file needed); full push-guard block test with fixtures (409 + Karen-only override confirmed); exemption toggle round-trip confirmed. Did not live-test the "exempt vendor's push succeeds" path since that would reach a real CINC `createInvoice` call — verified via direct unit check + code review instead.

---

## ✅ Shipped & live — second WhatsApp template (#499, merged + approved)

- **`pmi_voice_info_send` template — code + Twilio approval both done** (#499) — `sendWhatsAppFromVoice()` (the general voice→WhatsApp cross-channel case) uses a "reply and I'll send it" Content Template + a `voice_info_pending_whatsapp` conversation-state branch to deliver the actual content once the caller replies, mirroring the already-approved `pmi_ledger_nudge` pattern. Template created + **approved by Meta same-day** 2026-07-03 (Utility category, English, zero variables, SID `HXe6761eefc7ca28eb76e21a4a9a347eb7`). **Pending your action:** confirm `TWILIO_VOICE_INFO_SEND_TEMPLATE_SID` is set in Vercel prod env (dashboard, not CLI) and a deploy has picked it up — once that's done this is fully live, no further code changes needed.

---

## ✅ Shipped & live — 2026-07-03 session (#497–#498, both merged, verified landed)

- **Category menu renumbered + payments/balance split** (#497) — voice/SMS/WhatsApp menu is now **1 payments · 2 account balance · 3 maintenance/repair · 4 association documents · 5 new tenant/buyer application · 6 leave a message** (payments and balance used to share one digit). Payments (1) now also lists the PMI Mobile App (Apple/Android) after ACH/WebAxis/mail. Association documents (4) rewritten to resolve the caller's own association and text **+ email** the real portal link, instead of a generic CINC WebAxis URL.
- **Voice payments no longer reads the whole message aloud** (#498) — a live test call showed MAIA reading the entire ways-to-pay message (ACH links, WebAxis URL, mailing address, app links) out loud, unusable over the phone. Now asks "text, WhatsApp, or email?" first, then delivers via the chosen channel (WhatsApp→SMS fallback, honest confirmation of where it landed) — same pattern the ledger flow already used.
- **Collections detection root-cause fix** (#498) — a live test call from a real self-blocked test account showed MAIA reading normal payment info instead of the collections-agency message. Root cause: the collections check only queried the CINC collections-workflow list (the "Collection Status"/"Hold Collections" dropdowns), missing the separate "Block Payments" toggle (`getHomeownerDetailsForIVRPayment` → `BlockPaymentsFlag`/`IsHomeownerOrAssociationBlocked`). Fixed by ORing both signals — per explicit direction, neither replaces the other, since staff can flag a delinquent unit either way. Gates voice/text payments, the ledger flow, AND the resident portal (below). `/api/admin/cinc/owner-status` (staff diagnostic) now surfaces both signals + the combined verdict.
- **Resident portal — collections notice + self-service ledger button** (#498) — the logged-in owner portal now runs the same collections check server-side: if blocked, Pay HOA Fees/ACH are hidden and the same Schwartz & Vays notice renders. If not blocked, a new "Get my account statement" button lets the owner request their ledger directly — gated behind a **fresh** OTP confirmation each time (two new routes, `/api/owner/ledger-web/start` + `/verify`), since the existing login session alone isn't enough for handing out a financial document.
- **Voice Flow diagram resynced** (#498, admin: Tools → Voice Flow) — updated to the renumbered menu + the new payments collections-check/delivery-channel sub-flow. This is the diagram's 2nd update in two sessions (also #496) — **it goes stale almost every time menu routing changes; check it proactively, don't wait to be asked.**

---

## ✅ Shipped & live — 2026-07-02 session (#485–#495, all merged)

- **Model tier rework** (#485) — MAIA's main answer engine (voice/SMS/WhatsApp) upgraded to **Claude Sonnet 5** for better Skills-following. Broadened, then deliberately **scoped back down** after live cost/latency review: Sonnet 5 now runs only on genuinely conversational paths (main answer engine, web chat, staff email replies, Teach MAIA understanding, monthly report writing, add-on ticket drafts). Everything mechanical (intent routing, sentiment, invoice/COI/W-9/compliance extraction, vision, language detection) is back on **Haiku 4.5** — no quality loss there, and it avoids Sonnet 5's 3x price plus a real gotcha: **Sonnet 5 runs adaptive thinking ON by default** (unlike Opus), which eats into `max_tokens` and can silently truncate/empty a reply on tight budgets. Fixed 7 fragile `content[0]`-assumes-text-block sites codebase-wide while at it.
- **Voice IVR — menu-first redesign** (#488) — free-speech intent classification on voice wasn't reliable even on Sonnet 5, so every known caller now goes straight from the greeting to the fixed 1–5 category menu (mirrors what first-time callers already got). One exception: a quick Haiku classification pass still runs to catch a true **emergency** so it isn't stuck behind a menu. Options 3 (new tenant/buyer application) and 4 (association documents) are now **fixed scripts** that text the real link instead of an LLM-generated answer; 1 (maintenance) and 5 (leave a message) stay on Sonnet 5; 2 (payments) was already fixed (ledger flow).
- **SMS/WhatsApp get the same category menu** (#492) — after role resolution, text channels now show the same 5-option menu instead of an open "what do you need?" (which gave no guidance). Free text still works normally there (text classification never had voice's reliability problem) — only the bare open question was replaced.
- **WhatsApp reliability — the real fix** (#487, #489, #491, #493, #494) — root cause of "WhatsApp still not sending" reports: **WhatsApp Business API rejects any business-initiated (non-reply) freeform message unless the recipient messaged us in the last 24h** — a phone caller essentially never has that window open, so voice-triggered nudges and ledger-delivery sends were silently failing while SMS (no such restriction) always worked. Fixed in two layers: (1) every proactive WhatsApp send now falls back to SMS automatically on failure, with an honest spoken/texted confirmation of which channel it actually landed on (no more false "Done!"); (2) a real Twilio Content Template (`pmi_ledger_nudge`, Utility category, English) is now approved and wired in for the ledger nudge specifically — set as `TWILIO_LEDGER_NUDGE_TEMPLATE_SID` in Vercel. Also restored the 4 department "open a ticket" contact boxes for **public (pre-login)** portal visitors (#489) — they'd regressed to a bare "Ask MAIA" button with no department options; still no published phone/email, everything routes through a tracked ticket.
- **Chat widget — association context bug** (#490) — the globally-mounted floating widget had zero idea which of the 25 association portal pages it was open on (e.g. answering a Manors XI lease-application question with generic PMI-wide boilerplate). Fixed via `associationCodeForPath()` (derives the code from the URL, inverting the existing `ASSOCIATION_PORTAL_PATH` map) threaded into `FloatingWidget`/`MaiaWidget`. Same PR fixed raw `**markdown**` asterisks showing literally in the widget (no markdown renderer exists anywhere in the app — fixed by instructing the model not to use markdown syntax instead of adding a rendering dependency).
- **Dead model ID** (#495) — `claude-sonnet-4-20250514` (used as the Sonnet-escalation tier in `document-classifier.ts`/`document-validation.ts`/`insurance-declaration-extraction.ts`'s Haiku-first-then-escalate design) was already a retired/404ing model **before this session started** — surfaced via a live Compliance Hub upload failing silently. Fixed to `claude-sonnet-5`; confirmed via repo-wide grep this was the only stale dated model ID left anywhere.
- **Portuguese goodbye-detection gap** (#491) — "Não, só isso" ("no, that's all") wasn't recognized because the regex only matched "é só isso" (with the leading "é") or unaccented "so isso", not the bare accented "só isso" — a very common phrasing. One-line regex fix.
- **Voice Flow diagram** (#486, admin: Tools → Voice Flow) — clickable SVG reference diagram of the IVR call flow; clicking a node shows the real spoken sentence (or notes it's LLM-generated with no fixed script). Updated for the menu-first redesign in #496, and again in #498 for the renumbered menu — see the 2026-07-03 section above.

**Pending your action:**
- **`pmi_voice_info_send`** — approved (see #499 above); just confirm the Vercel env var is set + deployed.
- Spanish/Portuguese versions of `pmi_ledger_nudge` aren't built — those languages still rely on the freeform-send + SMS-fallback path (works, just not template-reliable yet).

---

## ✅ Shipped & live — 2026-07-01 session (#468–#482, all merged)

- **Migration audit** — 4 applied-but-unregistered migrations found + registered in `lib/migration-status.ts` (#468); confirmed no live schema drift.
- **`NEXT_PUBLIC_SUPABASE_URL` misconfig fixed server-side** (#469) — 2 server files were building a client off the public app-domain var instead of `supabaseAdmin`; fixed. ⏳ still confirm the Vercel env value + redeploy for the client `/apply` form if not already done.
- **COI validation — engine + Paola workflow** (#472, #473) — `lib/coi-validation.ts` (`validateCoi`, fuzzy name+address match vs PMI + the association, typo-tolerant, 10-case self-test); surfaced as a verdict chip on `/admin/vendor-compliance` + a "Draft COI correction" button reusing the existing preview→edit→send modal (Reply-To `service@`, BCC Paola/Fabio, staff-approved send). **PR2b (block invoice release + Karen override) is built — see #500 above.**
- **Voice IVR full overhaul** (#474–#482) — see the **Voice / channels** section below for the complete list; the standout fix is the **Twilio speech-recognition `language=` attribute** (#482), which was silently transcribing every non-English call as English.
- **Pre-registration flow for unknown callers** (#476) — unregistered callers get a texted `/pre-register/<token>` form (role/name/email required, free-text request); submissions email PMI + Jonathan. New `pre_registrations` table, migration applied.
- **Roadmap reconciliation + rewrite** (#471, this doc) — ~11 items the prior doc called 🔴/🟡 were actually shipped; see `roadmap_reconciliation_2026_06_30.md` for the full list (owner self-service, `/apply` rules-ack, background-check e2e, vendor COI/license→CINC, `/admin/vendor-compliance`, estimate-approval flow, forward-to-maia@, teach mode, CINC-native vendor name in recon, lint errors — all confirmed shipped 2026-06-30).

---

## 🟢 Development backlog — the REAL remaining work

### Top — unblocked, high value
- ✅ **COI validation — PR2b (block + Karen override)** — done, see #500 at the top of this doc.
- ✅ **Estimate board report WITH IMAGES** — done, see #501 at the top of this doc.
- ✅ **Vendor/board replies now auto-thread onto the work order** — decision made: route through `maia@` (already Gmail-watched), not a new `service@` mailbox — zero new infra, no mailbox to create/OAuth-connect. `VENDOR_REPLY_TO` (`lib/notify-recipients.ts`) is now `[maia@pmitop.com, service@topfloridaproperties.com]` (Paola still copied) across every vendor/WO email (estimate-request, estimate-followups cron, send-estimate-to-board, request-vendor-docs, service-issue, onboarding). **Root-cause fix**: `ingestInboundEmailToTicket` had a top-level `if (!allowed) return` gating the ENTIRE function to internal-domain senders — silently dropping vendor/board thread-replies even though the code's own comments already described that behavior as intended. Restructured so thread-ID match (step 1) and bare-WO-number-mention match (step 1.5) — both append-only-to-an-already-existing-ticket, and both inherently sender-safe (a Gmail threadId can't be forged from outside) — run for every sender; only ticket-*creation* paths stay gated to `allowed`. No literal freeform "compose email from a work order" UI was built (none existed before either — the existing vendor-email actions are single-purpose, not a generic compose modal); that would be a separate, larger feature if wanted later.
- ✅ **Pre-registration triage — Phase 1** — staff alert now goes to ALL staff (`fetchStaffList()`, not a hardcoded 2-address list), framed "Do you know this person?" with a one-click Dismiss magic-link + "See details & approve →" CTA into the new `/admin/pre-registrations` dashboard. Dashboard lets staff correct the self-picked persona inline, then routes "Approve/Add" to the RIGHT existing mechanism per persona: owner/board/agent → `AddPersonModal` (extended with `prefill`/`initialTab`); vendor → the CINC Vendor Onboarding flow (`OnboardVendorModal`, extended with a `phone` prefill); buyer → emails the `/apply` link ("Add to process"). "Notify access" sends a persona-aware "you're set up" email. **Tenant is NOT wired to Approve/Add yet** — shows a "Verification flow — coming soon" badge; Phase 2 builds the lease + board-approval-letter verification flow (owner confirms + either party or staff uploads both documents) before a self-identified tenant can be approved. **Bug caught in testing**: `OnboardVendorModal`'s `onClose` fires on Cancel too, not just success — first wiring marked the pre-registration "added" even when nothing was onboarded. Fixed by adding a separate `onSuccess` callback that only fires after a real create/link.

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

- ✅ **Menu-first + renumbered 2026-07-02/03 (#488, #492, #497, #498)** — every known caller goes straight from the greeting to the fixed category menu — free-speech classification as the primary router was dropped (unreliable even on Sonnet 5), except a quick emergency check that still bypasses the menu. Menu is now **1 payments · 2 account balance · 3 maintenance/repair · 4 association documents · 5 new tenant/buyer application · 6 leave a message** (payments/balance used to share one digit; split #497). Payments (1) checks collections FIRST (ORs two independent CINC signals — see the 2026-07-03 section above), then asks delivery channel (text/WhatsApp/email) instead of reading the whole ways-to-pay message aloud (#498). Options 4/5 are fixed scripts (real texted + emailed links, no LLM); 3/6 go to the Sonnet 5 answer engine; 2 is the ledger flow (also collections-gated). **SMS/WhatsApp got the same menu** (#492) after role resolution, replacing a bare "what do you need?" — free text still routes normally there (no reliability problem on text).
- ✅ **Live, overhauled 2026-07-01 (#474–#482):**
  - **Language menu** for first-time callers — EN/ES/PT up front, press 9 → FR/HE/RU/HT sub-menu, each option spoken in its own native voice; DTMF or spoken. Pick is saved per-phone (`conversation_state.session_language`) so the next call opens straight in it; a returning caller who clearly speaks a different language gets the menu again.
  - **Ledger-by-voice fixed** — "meu balanço"/balance asks in any language now route to the ledger flow instead of falling through to a hang-up (#474, keyword backstop + prompt enrichment).
  - **Non-identified path for unknown callers** — a clear, dedicated handoff (kept Maia's full self-intro, spliced in "I see that your call is coming from a non-registered phone number…", approved wording) that texts the pre-registration link; no longer buried behind the account menu (#478, #480, #481).
  - **UX polish** — 1s lead pause so the greeting isn't clipped before the caller's ear is on the phone; warm goodbye detection ("that's all, thank you", "tchau", "adiós", etc., in all languages) ends the call gracefully instead of re-prompting (#479).
  - **Root-cause fix — Twilio STT language** (#482): none of the 5 `<Gather input="speech">` tags set a recognition locale, so Twilio's speech-to-text silently defaulted to English for every call. A non-English caller's speech got mis-transcribed into English-ish text, which then got answered in English but spoken in the caller's already-selected voice ("English with an accent"). Fixed via `sttLangFor()` → `pt-BR`/`es-US`/`fr-FR`/`ru-RU`/`en-US` per Gather; he/ht fall back to en-US/fr-FR (no Twilio locale for those two, same as their Polly TTS fallback).
  - English brand-name pronunciation inside non-English voices via SSML `<lang>` (#470).
- **Voice language parity is 5 native + 2 degraded (TTS only — STT is now fixed for all 5 native + fallback for he/ht):** EN/ES/PT/FR/RU have native Polly voices; **Hebrew falls back to an English voice (still imperfect), Haitian Creole to French (approximate)** — Polly has no Hebrew/Creole voice. Text/WhatsApp = full 7 native.
- 🟡 **Deferred — natural-voice agent** (`voice_plan.md`): Vapi + bring-your-own-Claude `/chat/completions` SSE shim + Deepgram STT + Cartesia/ElevenLabs TTS + pgvector. Not built; needs accounts/keys. **Would bring voice to full 7/7 TTS parity** (ElevenLabs/Cartesia support Hebrew + Creole) — the STT gap is now closed for 5/7 regardless. Deferred because MAIA is staff-only today.
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
3. **Background check** — verify Applycheck end-to-end + surface to board. ✅ built (Applycheck itself); provider pivot is the open piece — ApplyCheck has no API, Certn was explored but stalled/abandoned, **final decision 2026-07-04 is Checkr** (docs.checkr.com) — integration NOT built, planned for next session.
4. **Per-association rules ack** in `/apply`. ✅ built.

(Detail in memory: `roadmap_reconciliation_2026_06_30.md`, `owner_self_service_decisions.md`, `screening_provider_pivot.md`, `voice_plan.md`.)

## Suggested priority
1. **Checkr integration (NEXT SESSION)** — build the provider-agnostic `lib/screening/` adapter against https://docs.checkr.com/ and repoint the background-check trigger/webhook from the dead ApplyCheck-API assumption to Checkr. See [[screening_provider_pivot]] in memory for full history (ApplyCheck rejected → Certn stalled → Checkr is final).
2. ✅ **Pre-registration triage Phase 2 + unit occupancy control** — done, see the section near the top of this doc (2026-07-04, committed). Pending your action: try `/admin/unit-status`'s survey button for real (it dry-runs by default) and confirm the Send Occupancy & Insurance Survey copy reads right before the first live send to real owners.
3. Continue the Flows diagrams series — `/apply` Tenant/Buyer Application next.
4. Medium WO/recurring items → 5. Compliance Phase 2 (deadline-rules + document RAG) → 6. smaller comms/invoice follow-ups.

**Verify on next real call:** the renumbered menu (#497) + payments delivery-channel sub-flow (#498) — confirm a real call reaches the "text/WhatsApp/email?" prompt on digit 1 and the message actually arrives via the chosen channel; confirm a real collections-blocked unit now correctly hears the agency message on digit 1 (not just the test account). Also confirm the resident portal's new "Get my account statement" button delivers a real ledger email in production (local testing was code-path-verified via curl/DB only, since local dev has no email provider credentials).

**Blocked / external:** natural-voice agent (Vapi/Deepgram/ElevenLabs accounts).
