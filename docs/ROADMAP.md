# MAIA Platform — Open Items / Roadmap

_Last updated: **2026-07-01**. Status key: ✅ Live · 🟡 Partial · 🔴 Not built · ⚠️ Blocked · ⛔ Decided off._
_Companion to `docs/SESSION-HANDOFF.md`. **This doc was rebuilt 2026-06-30** after the prior version drifted badly — verify against the codebase before quoting a status; squash-merges land features without anyone updating this file._

> **How to keep this honest:** before quoting a status, grep the codebase. When you ship something here, flip its status in the same PR.

---

## ✅ Shipped & live — 2026-07-01 session (#468–#482, all merged)

- **Migration audit** — 4 applied-but-unregistered migrations found + registered in `lib/migration-status.ts` (#468); confirmed no live schema drift.
- **`NEXT_PUBLIC_SUPABASE_URL` misconfig fixed server-side** (#469) — 2 server files were building a client off the public app-domain var instead of `supabaseAdmin`; fixed. ⏳ still confirm the Vercel env value + redeploy for the client `/apply` form if not already done.
- **COI validation — engine + Paola workflow** (#472, #473) — `lib/coi-validation.ts` (`validateCoi`, fuzzy name+address match vs PMI + the association, typo-tolerant, 10-case self-test); surfaced as a verdict chip on `/admin/vendor-compliance` + a "Draft COI correction" button reusing the existing preview→edit→send modal (Reply-To `service@`, BCC Paola/Fabio, staff-approved send). **PR2b (block invoice release + Karen override) is the one remaining piece — see Top below.**
- **Voice IVR full overhaul** (#474–#482) — see the **Voice / channels** section below for the complete list; the standout fix is the **Twilio speech-recognition `language=` attribute** (#482), which was silently transcribing every non-English call as English.
- **Pre-registration flow for unknown callers** (#476) — unregistered callers get a texted `/pre-register/<token>` form (role/name/email required, free-text request); submissions email PMI + Jonathan. New `pre_registrations` table, migration applied.
- **Roadmap reconciliation + rewrite** (#471, this doc) — ~11 items the prior doc called 🔴/🟡 were actually shipped; see `roadmap_reconciliation_2026_06_30.md` for the full list (owner self-service, `/apply` rules-ack, background-check e2e, vendor COI/license→CINC, `/admin/vendor-compliance`, estimate-approval flow, forward-to-maia@, teach mode, CINC-native vendor name in recon, lint errors — all confirmed shipped 2026-06-30).

---

## 🟢 Development backlog — the REAL remaining work

### Top — unblocked, high value
- 🟡 **COI validation — PR2b (block + Karen override)** — the engine + Paola's correction-email workflow are shipped (#472/#473). Remaining: block "mark compliant / release invoice" on an invalid COI, with a **Karen-only override** — clone the existing double-pay hard-block pattern in `app/api/admin/invoices/intake/[id]/push/route.ts` (`KAREN_EMAIL`/`trustedDomainVariants`, `pushAnyway`-style bool → 409 `karenOnly`). Decide whether the guard sits in `add-invoice` (like ACH/W-9), the push route (like double-pay), or both.
- 🟡 **Estimate board report WITH IMAGES** — the flow is live; only **estimate image previews** + the board-picks model are missing. Parked tiny on local branch `wip/estimate-board-compare` (`lib/estimate-preview.ts` + `20260619_estimate_board_compare.sql`), tangled with already-merged portal commits — rebuild clean off `main`.
- 🔴 **service@ email-from-WO** — send vendor emails from inside a work order via `service@topfloridaproperties.com`/`service@pmitop.com`, replies thread back onto the WO (the compose tabs + tokenized upload link + comparison + board approval already exist; only the service@ send path is missing). ⚠️ Decide: sender (`service@` vs `maia@`) and whether the mailbox is Gmail-watched for replies.
- 🔴 **Pre-registration triage** — the new `pre_registrations` table + staff email alert are live (#476), but there's no admin UI to view/mark-contacted/dismiss submissions yet. Small — worth a quick `/admin/pre-registrations` list page once a few real submissions come in.

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

- ✅ **Live, overhauled 2026-07-01 (#474–#482):**
  - **Language menu** for first-time callers — EN/ES/PT up front, press 9 → FR/HE/RU/HT sub-menu, each option spoken in its own native voice; DTMF or spoken. Pick is saved per-phone (`conversation_state.session_language`) so the next call opens straight in it; a returning caller who clearly speaks a different language gets the menu again.
  - **Category menu** (1 maintenance · 2 payments/balance · 3 applications · 4 documents · 5 message the team) — shown to new callers and as the fallback when a request is unclear; accepts a digit or natural speech.
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
3. **Background check** — verify Applycheck end-to-end + surface to board. ✅ built; screening provider pivot to Certn is the open piece (⚠️ blocked on sandbox keys — ApplyCheck has no API).
4. **Per-association rules ack** in `/apply`. ✅ built.

(Detail in memory: `roadmap_reconciliation_2026_06_30.md`, `owner_self_service_decisions.md`, `screening_provider_pivot.md`, `voice_plan.md`.)

## Suggested priority
1. **COI validation PR2b** (block + Karen override — small, finishes an already-shipped feature) → 2. **Estimate board report with images** (near-done quick win) → 3. **service@ email-from-WO** (completes vendor procurement) → 4. medium WO/recurring items → 5. Compliance Phase 2 (deadline-rules + document RAG) → 6. smaller comms/invoice follow-ups.

**Verify on next real call:** the voice IVR overhaul (#474–#482) needs a live test in Portuguese now that the STT language fix (#482) is merged — confirm Maia actually understands Portuguese speech correctly (not just the TwiML config).

**Blocked / external:** screening adapter → Certn (sandbox keys); natural-voice agent (Vapi/Deepgram/ElevenLabs accounts).
