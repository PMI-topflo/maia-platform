# MAIA Platform — Open Items / Roadmap

_Last updated: **2026-08-30**. Status key: ✅ Live · 🟡 Partial · 🔴 Not built · ⚠️ Blocked · ⛔ Decided off._
_Companion to `docs/SESSION-HANDOFF.md`. **This doc was rebuilt 2026-06-30** after the prior version drifted badly — verify against the codebase before quoting a status; squash-merges land features without anyone updating this file._

> **How to keep this honest:** before quoting a status, grep the codebase. When you ship something here, flip its status in the same PR.

---

## ✅ LIVE — never let two people open separate applications for one unit (MANXI 802/1002, 2026-08-30)

Real incident: MANXI 802 ended up with 4 separate `listing_applications` rows because the existing "resume instead of duplicate" check only caught the SAME email reopening the link — a genuinely different person (owner, second tenant, co-tenant) still got their own parallel application. `POST /api/pre-apply/start` now checks for an already-open primary-occupancy application on the unit before creating anything (`8fe38db`): a verified owner (real `owners.emails`/`owners.phone` match) or any non-owner role (agent, tenant, co-applicant) auto-joins the existing application directly instead of spawning a new one — they already self-identified their role on the initial persona card (`7cfa397`, extending `8fe38db`'s owner-only auto-join to every role). An unverified owner claim is the one case that still blocks and routes to staff, since that's the one role MAIA can actually check against real data and a false claim carries real financial/legal stakes. Every auto-join sends a lightweight FYI notification (staff + best-effort the existing lead) so it stays visible and reversible.

Cleaned up both real affected units: MANXI 802's 4-way duplicate down to 1 (with an accidentally-cascade-deleted set of owner documents caught immediately and correctly re-filed from Storage — see `docs/SESSION-HANDOFF.md`), MANXI 1002's separate pre-existing pair down to 1. Platform-wide scan confirmed zero other units carry more than one open primary-occupancy application.

Also fixed while previewing the tenant-facing checklist email: the "@maia upapp `<ACCOUNT>`" forward-to-file shortcut shown in every resident-facing MAIA email only ever worked for staff senders (`isAllowedSender`) — a tenant following the exact instruction from their own address silently fell through to a generic AI reply instead of being filed. `isApplicationStakeholderEmail()` (`2a3a2eb`) now lets a non-staff sender through too, but only when their email matches a real stakeholder on the specific application the tag resolves to.

---

## ✅ LIVE — self-serve intake no longer lets applicants fake staff/e-signed items (MANXI 802 incident, 2026-08-29/30)

Real tenant complaint (MANXI Unit 802) traced to a platform-wide bug: the self-serve "other documents — upload if you have them" convenience section rendered `background_credit` (Background/Credit Reports, staff-only everywhere — confirmed the only `provided_by='staff'` doc_key on the platform) as an ordinary upload box, and separately let Rules Ack / Emergency Contact List / Military Service Member Disclosure / Pet Registration / Maintenance Assessment Acknowledgment — all real e-signed forms — be "satisfied" by uploading an unrelated file, since only Rules Ack had a dedicated in-page signing block. Fixed in 3 commits (`1b15202`, `e82403b`, `f6eb236`, the last two split across two sessions working the same incident, cross-verified before merging): staff-only items now excluded from the self-serve checklist entirely; all 5 e-sign registry items now get a real "Sign now →" link (`getOrCreateEsignLink()`, idempotent — no duplicate emails on refresh) instead of an upload box, enforced server-side too. Full detail in `docs/SESSION-HANDOFF.md`.

Same session: re-verified the Checkr Test Environment still works end-to-end (both auto-complete and Hudson Green scenarios) and found a real gap — the `essential` package's structured report returns `credit_report: null` and `eviction_history: null`, contradicting what Checkr's own pricing conversation described it as including. Emailed `hello-tenant@checkr.com` with exact order/report IDs; **awaiting their reply** before any association can be flipped to `maia_checkr` (see the Checkr entry below, updated).

---

## ✅ LIVE — Lease Renewal Check-In + real call-to-action on expiry reminders (2026-08-27)

Full detail in `docs/SESSION-HANDOFF.md` (top). Memory: [[lease_renewal_checkin]].

- ✅ Real bug fixed first: `sendLeasePacket()` was sourcing the lease term from unit-scoped `unit_tenant_contacts` (only refreshes on approval) instead of the current application's own extracted dates — showed a tenant the PREVIOUS tenant's term (MANXI 706, Quentin Jamal Smith). New `listing_applications.lease_start/lease_end` columns fix it at the data layer.
- ✅ **Lease Renewal Check-In** — token-gated `/lease-renewal/[token]` page + `lease_renewal_checks` table + `lib/lease-renewal-check.ts`, replacing the "Lease expiring" reminder's dead-end mailto link with real tenant/owner options that open applications, generate upload links, or update occupancy + notify staff/board. Wired into both standing crons (`lease-renewal-alerts`, `expired-leases-digest`); both now stop nagging a party once answered and skip any unit with an open application (`hasOpenApplication()`).
- ✅ Staff can now attach a lease at `/admin/pre-apply` creation time and have MAIA auto-read the tenant roster + lease term before the application exists (`extract-lease`/`extract-lease-url`) — fixed one real file-size bug in the same pass (signed Storage URL, not raw bytes through the function body — same class of bug already fixed once for MANXI 303's Purchase Agreement). See [[signed_url_upload_gotcha]].
- ✅ Real MANXI 115 applicant-roster duplicate found + fixed (typo'd name defeated the exact-match dedupe between two independent roster-insert paths); the page's top "✎ edit" button now also opens the full Applicants roster card, not just the lead applicant's name.
- 🟡 **Learned the hard way**: a bulk catch-up send hit MAIA's existing anti-runaway rate limiter and needed to be made resumable mid-run; separately over-included units far outside the real 30/7-day window before being caught and corrected. See [[bulk_email_rate_limit_discipline]] — any future bulk/catch-up send script should check this first.

---

## ✅ LIVE — 5 shipped fixes, 2026-08-24 (commits `06b8039`→`d1105c4`)

- **Ticket/work-order status model simplified** (`06b8039`) — added `canceled`, merged `closed` into `resolved` (all historical `closed` rows migrated, not just relabeled). 5 statuses total: `open`, `pending`, `waiting_external`, `resolved`, `canceled`. Don't re-add `closed`. Detail: [[tickets_status_model_simplified]] memory.
- **Resolved tab always includes archived rows** (`486e588`) — `/admin/tickets` and `/admin/work-orders`; archiving now only declutters active-work views, doesn't hide completed-work history.
- **CINC board-sync email lock** (`978d7bc`) — `association_board_members.email_locked` + "🔒 Keep MAIA email" button stops CINC-sourced stale emails from silently overwriting a working board-member address. Real incident (Angelique Philips/MANXI #1093). Detail: [[cinc_board_email_locked]] memory.
- **Application standard-reply party attribution** (`b6532f3`) — `lib/application-standard-reply.ts` now routes outstanding items/vehicle-pet questions to whichever party (owner vs. tenant) actually owns them, instead of dumping everything on whoever emailed in. Real case: MANXI 110 (Monica Blumenfeld / Susie Bell). Detail: [[application_reply_party_attribution]] memory.
- **Board-review OTP verification** (`d1105c4`) — `/board-review/[token]` closed a real gap: any link-holder could self-report as any reviewer and approve/refuse real documents with zero identity check. Now requires email OTP, enforced server-side on both the per-document and round-level decide endpoints. Detail: [[board_review_otp_verification]] memory.

## 🟡 MANXI Application Guide project — 2026-08-25 → 08-26

Full gap analysis of MANXI's real 2023 paper application against live MAIA data, driving DB fixes, two new preview artifacts, and one shipped staff panel. Full detail: [[manxi_application_guide_project]] memory.

**Shipped:**
- `association_application_rules`: MANXI now has 10 active rules (was 2) — trust-purchase ban, 2-year no-rent-after-purchase, max 1 rental/12mo, delinquency lease-block, occupancy-by-bedroom caps, no commercial/recreational vehicles, min income, credit-score advance-maintenance tiers. VPCI gained `no_trust_purchase`.
- `association_intake_documents`: vehicle_insurance now required for purchase/lease_renewal (previously lease/additional_occupant only); tenant_affidavit deactivated for lease_renewal; landlord_tenant_agreement + tenant_affidavit required on new leases; background_credit required on lease/purchase/additional_occupant; legacy `board_decision_page` deactivated.
- Real staff panel shipped: `/admin/pre-apply` "Required documents" section now shows a stat strip + Eligibility & Restrictions list (block/warn pills) sourced from `association_application_rules`/`association_questions`, above the existing checklist (commit `df2394c`, deployed, 0 runtime errors).
- Two Artifact previews built and approved ("It's perfect"): applicant-facing [Application Guide](https://claude.ai/code/artifact/404b0907-c649-4725-a821-9e79414b162a) (rules/process/fees/checklist/post-approval, real live fee amounts — $150/adult, $150/married-couple-with-cert, not $300), and staff-facing [New Forms Preview](https://claude.ai/code/artifact/5d928f04-0ec0-4716-b35f-9b8ee398b02d) (Maintenance Assessment + Military Service Member e-sign form mockups + Master Association welcome package with real logo).

**Shipped since (2026-08-26):**
- ✅ Both real bugs fixed (commit `d72e1de`): `getRelatedOccupantApplications()` shows Lease Addendum filings on the parent lease's audit view (reverse of `getCurrentLease()`); staff "Open an application" form gained a "Minor (no background check)" checkbox that sets `applicant_role='minor_dependent'` at creation instead of hardcoding `adult_occupant`.
- ✅ Both new e-sign forms built for real (commit `6d0c456`): Maintenance Assessment Acknowledgment (purchase-only, best-effort pulls the current quarterly assessment from CINC's homeowner ledger, never fabricates a figure) and Military Service Member Disclosure (all types, fillable single yes/no question). Registered through the full e-sign engine (`ESIGN_CHECKLIST_ITEMS`, `lib/esign-forms.tsx` REGISTRY, `recordEsignSignature`'s completion filing, the fillable-form dispatch in both the page and its API route, the staff panel's `ESIGN_ITEM_KEYS`). `association_intake_documents` rows live for MANXI. Detail: [[manxi_new_esign_forms]] memory.
- ⚠️ New Forms Preview artifact's stale "Checklist rows: 50" stat was checked 2026-08-26 and found already correct (48) — the earlier tag-cleanup edit had in fact been republished; no action needed.
- ✅ **The Application Guide is now a real, live feature** (commit `88fdf81`), not just an Artifact preview — built in response to "So now when the applicant or the agent receives this Guide?" MANXI-only, 4 delivery paths: a public page + PDF (`/apply/MANXI/guide`, `/api/apply/application-guide/[assoc]`), auto-attached to the invite email (`send-invite`, best-effort), an `@maia guide`/`@maia requirements` email trigger (not staff-gated — agents/applicants can ask directly), and a WhatsApp/SMS keyword shortcut (EN/ES/PT) that replies with the link. Rules and the document checklist are built LIVE from `association_application_rules`/`association_intake_documents` — never a static snapshot. Detail: [[manxi_application_guide_live_feature]] memory.

**Shipped 2026-08-27/28, scoped differently than originally planned:**
- ✅ Master Association welcome-package (commits `7eb47d4`, `149bb9e`) — **not** the 4-original-PDFs-attached-as-Association-filing this entry originally described. PMI doesn't manage Manors Club Inc. (MANXI's master association), so instead of MAIA submitting anything TO them, an approved MANXI applicant's existing approval-letter email (`lib/approval-distribution.ts`'s `distributeApprovalLetter` — already live, no new email needed) now also attaches the Club's own 2 real fillable forms (Proximity Card / Recreational I.D. Pass Registration, Elevator/Gate Pass), pre-filled with what's already on file, for the resident to print and present in person. Front Gate Barcode + Manors Club I.D. Card have no forms (bring-in-person items) — described in the email body instead, along with Manors Club's real contact (Greg Rullo, Grant Property Management). `lib/manors-club-welcome-package.ts` overlays text at exact coordinates onto the ORIGINAL embedded source pages (measured off the real PDF's text layer) — never retypes the Club's legal text. Source stored at `application-docs/MANXI/manors-club-welcome-package/source.pdf`. Signatures/dates/ID#/DOB/move-specifics left blank, never fabricated. Preview generated + user-approved before wiring into the live flow.

**Shipped 2026-08-27, scoped differently than originally planned** (see the Lease Renewal Check-In section above for the full 2026-08-27 entry):
- ✅ Delinquency notice at application-open time (commit `760ca11`) — **not** the `no_lease_if_delinquent` block-style rule originally planned here. User direction changed the shape: warn, don't block, and gate on an OPEN BALANCE AGED OVER 30 DAYS (a new signal, `lib/application-delinquency-notice.ts`'s `isOpenBalanceOver30Days()`, walking the real CINC ledger) rather than the collections-flag signal ([[cinc_collections_detection_fix]]'s `isAccountInCollections()`) this entry originally pointed at — that flag is a different, independent thing (formal collections workflow / "Block Payments" toggle) and stays unused here. Fires on `createIntake()` (owner + applicant) and on setting/changing an agent on an existing application (agent only). Verified against real production ledger data before shipping.

**Shipped 2026-08-28/29:**
- ✅ Two small live-PDF fixes (commit `df9b09b`) — `property_insurance`/lease relabeled "HO6 Property Insurance" (direct data fix, no code change needed since the guide reads the table live); new small red "(over 18yr.)" annotation under the Add'l Occ. column for `occupant_affidavit`, gated by `doc_key` (now threaded onto `GuideChecklistRow`).
- ✅ `/admin/pre-apply` Required Documents panel (commit `a283b37`) — no longer defaults/guesses an association the moment it's opened; now "Required documents for [choose an association]", listing every active association via `/api/associations` (not just ones with a currently-open application) so it's usable for reviewing/setting up an association before its first application exists. PDF Guide download link moved with it.
- ✅ **International-applicant package wired into the real MANXI purchase checklist** (commits `feafa79`, `96ce1b2`, `e308c16`, `d42cd2c`) — the CPA Financial Certification / foreign police clearance / notarized translation package built during the 2026-07-06/07 Checkr integration (see the Checkr entry below) existed only in the older standalone `/apply` self-serve form's "international" appType, never reflected in the checklist/rules that actually drive MANXI purchase approvals. Now: new purchase-only declaration ("Are you a U.S. taxpayer with at least 2 years of U.S. tax returns?") reuses the existing vehicle/pet/assistance_animal `condition_key` gating pattern end to end (`Declarations.taxReturns`, `activeConditions()`, `pendingDeclarations()`, `declaredNaKeys()`) rather than inventing a second mechanism, asked on both the self-serve applicant intake and staff-create; 3 new checklist rows + a new advance-maintenance rule (1 year in advance, since no U.S. credit score can be pulled) live in their own separate §1/§3 sections of the Application Guide rather than folded into "For purchases"; CPA guide download link added to the checklist card (`/api/apply/intl-cpa-guide?lang=`, localized); the CPA PDF itself (all 7 languages) now requires the accountant to state EXPLICITLY whether the applicant's income meets or does not meet MANXI's minimum, not just a vague "appears capable" line; MANXI's own min-income rule text now says international applicants must meet the same figure. Verified against freshly generated live PDFs at every step, not just eyeballed code.
- ✅ **Default intake checklist template seeded across 17 associations** (commit `3e1db7e`) — MANXI's checklist minus notarized-affidavit items, the Lauderhill-specific certificate, and MANXI/international-only items, seeded as Optional-by-default (Rules Ack required) across every active association except MANXI (source), VPCI (already has its own real checklist), the 2 master associations (LCLUB/VPREC — the user's own "besides the master" carve-out), and the 5 commercial condos (residential paperwork doesn't fit, same line the 2026-08-16 insurance seed already drew). Staff toggle any item on/off per association via the existing `IntakeChecklistBox` UI — no new UI needed. ⚠️ **Structural only, flagged not glossed over**: the Rules Acknowledgment checklist row is now required for these 17, but the actual e-signed rules CONTENT per association (the text applicants sign — `lib/manxi-rules-ack.ts` is the existing pattern) still needs to be authored before that item is genuinely fulfillable. Real per-association rules documents needed from the user before that follow-up can start.

---

## ✅ LIVE — real-usage bug sweep on the automatic pipeline, 16 commits (2026-08-20 evening → 2026-08-22)

Full detail in `docs/SESSION-HANDOFF.md` (top). Not a new feature — PMI ran real applications through the pipeline above and reported problems live; almost every one was a cached/derived value drifting from its live source, fixed at the shared-function level so the same class of bug can't recur in a sibling caller.

- ✅ **`board_approval_letter` checklist item retired** for `lease` / `purchase` / `additional_occupant` (nonsensical — no prior board decision exists to reference on a first-time tenancy) and **relabeled** for `lease_renewal` → "Copy of Last Year's Approval Letter" (a real, sometimes-available document there). `landlord_email` also retired (asked for an email address as if it were an uploadable file).
- ✅ Refused documents now correctly pre-tick in "Request the missing documents" (were previously indistinguishable from "never uploaded"); refusal reason travels with the re-request.
- ✅ Daily "Applications to review" digest, 7am ET (`lib/application-review-digest.ts`, reuses `getApplicationDashboard()`).
- ✅ Reminder-approval page and the Applications LIST page both now read live document/review state instead of a stale snapshot or an independent status→label mapping — the list page in particular could show "Documents approved — creating letter" on an application that had just been sent a new document request.
- ✅ **Landlord-Tenant Agreement** — was asked as a dead-end upload; now routes to MAIA's own e-signed packet (`lib/lease-packet.ts`) while staying visible on the checklist (with a "Send to sign" action) until actually signed, rather than disappearing once wired to e-sign.
- ✅ **"@maia upapp <ACCOUNT>" forward-to-file hint** now shown in 3 places: the public request card, the actual text of every resident-facing email, and the MAIA chat widget (staff persona, via a cross-component event since the widget has no application context on `/admin/pre-apply/[id]`).
- ✅ **"+ Add another page"** on the applicant upload card — real cases of tenants emailing separate page scans because the upload button only ever replaced.
- ✅ **Widget "Create a link"** — staff persona, short "MANXI 303"-style message → button that drafts the standard missing-docs reply via the same function the Gmail add-on uses.
- ✅ **`draftStandardReply()` fix** — agent-provided items (e.g. a Condo Rider only the applicant's real-estate agent can supply) were silently excluded from the reply text entirely, not just from what the recipient is asked to do — could tell an applicant "nothing outstanding" while their agent still owed something.
- ✅ **Board-review page** (the OLD manual per-document round, still a live staff escape hatch): staff/on-site pre-checks now read "AI Pre-Audited by Maia" instead of "Approved" until a real board member decides; new overall **Send Back** / **Approve** buttons distinct from the per-document controls.
- ✅ **`quickDocScanDetailed` switched from Haiku to Sonnet** — real vehicle-registration photo, Haiku deterministically misread it as "certificate of use" with an invented date (6/6 wrong runs across two image variants); Sonnet got it right 3/3 with the same prompt. Drives compliance dates, so accuracy outranks the extra per-document cost. `quickDocKind` (lower-stakes Drive-folder matching) stays Haiku.
- ✅ Not in git: Supabase Storage `application-docs` bucket was missing `image/heic`/`image/webp` from its MIME allowlist — real upload failures for HEIC photos despite app code claiming support.
- 🟡 **Tool built, not yet run**: other real car-registration documents scanned before the Sonnet switch may carry wrong or blank expirations — no error-vs-empty distinction is stored, so this needs a spot-check pass, not a query. `scripts/spot-check-car-registrations.ts` re-reads every `car_registration` document created before 2026-08-23 with the same Sonnet-backed `quickDocScanDetailed` the live "Read expiration" button uses, and reports every mismatch (dry-run by default; `--apply` corrects `expiration_date`, but never clears an existing date the way the live single-doc re-scan doesn't either). Needs real `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`/`ANTHROPIC_API_KEY` to run — not executable from a sandbox with no prod credentials. Run `npx tsx scripts/spot-check-car-registrations.ts` (dry run) first, review the mismatches, then `--apply`.

---

## ✅ LIVE — applications pipeline is FULLY AUTOMATIC end-to-end (8 PRs #723–#730 + #731/#732, merged 2026-08-20)

Full detail in `docs/SESSION-HANDOFF.md` (top). Memory: [[application_pipeline_automation]]. **Supersedes the manual-click parts of the per-document board review section immediately below** — the review mechanics (four document states, refusal-requires-reason, etc.) are all still exactly as described there; what changed is that nobody has to click anything to move an application forward anymore.

Status flow: `started → submitted → under_review → approval_sent (NEW) → approved | declined`. Every arrow past the first is now automatic:
- ✅ **`submitted → under_review`** — the instant every required document is individually approved (`lib/board-review.ts`'s `syncBoardWindow`, shared by both the staff and board decision routes so it can't fire differently depending on who completes it).
- ✅ **`under_review → approval_sent`** — same instant: `lib/board-decision-letter.ts` creates the board decision letter with default signers and emails whoever isn't already signed. Every board-facing email now CCs `PMI@topfloridaproperties.com` (`BOARD_EMAIL_CC`).
- ✅ **`approval_sent → approved`** — the instant every signer signs: `lib/board-approve.ts`'s `runBoardApprove` files keeper documents to Official, archives the On-Going folder, then `lib/application-handoff.ts` triggers the screening handoff. Requires a fully-signed letter (added in PR8 — closes a gap where the old manual button could file before the board ever signed).
- ✅ "Bring into MAIA" **retired** — was the confirmed root cause of empty-shell applications (MANXI 605). Staff creation hardened to require contact info + the required document, with a lease-extraction-or-owner-completion fallback for the case where documents arrive from the owner instead of the tenant (real case: MANXI 110, Susie Bell — see #731 below).
- ✅ 3-day missing-docs reminder to **every** stakeholder (not just whoever last emailed), gated behind a one-time PMI+Jonathan approval — `/reminder-approval/[token]`, `app/api/cron/missing-docs-reminders`.
- ✅ Real gap found + fixed in the same pass (PR8): the old manual "Approve" buttons bypassed Drive filing entirely — fixed at the API level, not just the UI.
- ✅ **#731** — staff can create an application from an owner-forwarded lease with no tenant contact info; MAIA extracts it from the lease PDF or loops in the owner.
- ✅ **#732** — the public widget's Tenant/Buyer personas now have a real, guaranteed path to `/pre-apply` (previously freeform-chat-only with no reliable association context on the external iframe embed).

⚠️ **Not yet exercised on a real application** — every PR verified against disposable test data (created + cleaned up via direct scripts against the real prod DB) and, for the two public-facing pieces, live in the browser. The Drive-filing code itself is unchanged from the already-proven manual button, but the AUTOMATIC trigger of it has not yet fired on a real approval. Watch the first few real applications go through end-to-end.

The old manual per-document board round and the manual "Mark audited" PATCH action are now vestigial staff escape hatches — intentionally left live, not deleted, not surfaced as primary UI anymore.

---

## ✅ LIVE — per-document board review + the 30-day window (PR #698, merged 2026-08-16 → `95a9483`)

Full detail in `docs/SESSION-HANDOFF.md` (top). Memory: [[board_document_review]], [[pdf-single-page-extraction-unreliable]].

**The standard rule, everywhere:** the Board may decide up to **30 days after the last requested document is received**. `lib/board-review.ts` is the one place that decides it, so the staff screen, the reviewer page, the emails and the cron cannot disagree.

- ✅ Four document states replace "saved": ⚪ waiting · 🟠 on file, not reviewed · 🟢 approved · 🔴 refused. **A document that has not arrived cannot be reviewed** — it waits on an upload, not a decision.
- ✅ `/board-review/[token]` — board + on-site manager, one link, ANY ONE settles a document, each opens inline, every decision stamped who + when (ET).
- ✅ Refusal requires a reason (API-enforced) and that reason travels into the **request email** and the **communication history**.
- ✅ Staff decide on the same record; the old application-wide Actions block is gone.
- ✅ Row restyle: one ✎ Edit opens Upload · From Drive · Request · Mark N/A, expiration inside it.
- ✅ 5-day signature reminder cron (`/api/cron/board-review-reminders`, 7am ET) — only once the window is open, never to someone who already signed.
- ✅ **Dashboards** for staff, board and on-site manager — see the section below.

## 🟡 BUILT, PARTIALLY DEPLOYED — Gmail add-on v1 for applications + unit_pets (2026-08-18)

Detail in `docs/SESSION-HANDOFF.md` (top). `unit_pets` migration + backend routes ready to ship normally. **`gmail-addon/Code.gs` needs a separate `clasp push`** — not part of the Vercel pipeline, updates a live tool staff use today for tickets, held for explicit go-ahead.
- ✅ `unit_pets` — pet data as real queryable rows (species, breed, vaccination, service/ESA branch), written on every Pet Registration signing, supersede-not-overwrite.
- ✅ `/api/addon/applications` + `/api/addon/applications/[id]/send-form` — live checklist state and one-click sends for the three form-backed items, from inside Gmail.
- 🔴 v2, not built: AI-drafted status reply inserted into Gmail's compose box (same mechanism the ticket add-on already has via `onComposeInsertDraft`) — deliberately held back; a human should read the reply before it goes.

## ✅ BUILT — Emergency Contact List + the three e-sign checklist items (2026-08-16)

Detail in `docs/SESSION-HANDOFF.md` (top).

- ✅ **`lib/application-esign-forms.ts`** — the one table saying which `doc_key`s are forms MAIA generates. Requesting one now **sends the form**; everything else still asks for an upload. Fixes a live defect where ticking "Rules Knowledge Acknowledgment" or "Pet Registration" emailed an **upload link for a document only MAIA can produce**.
- ✅ **Emergency Contact List** (`emergency_contact_list`) — e-signed, one form that adapts for a non-resident owner, sent to every owner **and** every renter. Files under `emergency_contact`, stamps `unit.emergency`, one-year expiry.
- ✅ Liability text on both variants, shown before signing as well as on the PDF, with a Ch. 718 savings clause. ✅ **Approved for use by the user 2026-08-16** — the user's own approval, **not** an attorney's; don't conflate them.
- ✅ One form per **unit** (co-owners joined, link to every address they hold), and non-unit accounts like MANXI's `Manager` excluded.
- 🔴 **Open — tenant emails.** MANXI: 53 units rented, **2** tenants have an email on file. Owners are covered; tenants are not. Use the roster request to collect them.
- ✅ Campaign UI on `/admin/compliance-outreach` — **dry-run preview of the exact recipient list**, then Confirm.
- ✅ `"Updated Vehicle Information"` → `"Car Registration"`. ⚠️ **Migration needs applying by hand.**
- ✅ **Closed:** the owner portal's three loose name/phone/email boxes are gone. `/owner/compliance/[token]` now shows the **signed list with a link to read it**, plus "Replace it — sign a new one" (user direction). A new one supersedes the last; the old copy stays on file, because a list somebody signed records what they said on that date. The legacy `emergencyContact` POST branch is kept so a link already in an inbox does not break, but nothing offers it.

## ✅ BUILT — applications dashboards for staff, board and on-site manager (branch `feat/applications-dashboards-2026-08-16`)

Full detail in `docs/SESSION-HANDOFF.md` (top).

- ✅ `lib/application-dashboard.ts` reduces every application to **whose turn it is** — `refused` · `not_sent` · `review` · `letter` · `signature` · `applicant` · `decided` — plus how long they have owed it. One library serves all three desks, so they cannot disagree.
- ✅ **`not_sent` is the hole this was worth building for**: an application can sit at `under_review` that no reviewer has ever been sent a link to. On a status column that is indistinguishable from "the board has it".
- ✅ Staff (`/admin/pre-apply`, all associations) · board + on-site manager (`/units/applications`, own association, links to the round token they were sent). `unit_manager` refused 403.
- ✅ Staff's "your turn" also picks up any open application carrying an alarm — a quiet application is the office's to chase.
- ✅ `deriveReviewState()` extracted pure from `getReviewState()`; new `getReviewStates(ids)` batches many applications into a fixed query count.
- ✅ **`npm run test:review` — 46 cases**, the third real test in the repo. Run it before touching `lib/board-review.ts` or `lib/application-dashboard.ts`.
- ⚠️ **Not render-verified** — port 3000 was held by another session and both portals need an OTP session unavailable locally. Verified by build, both test suites, and running `getApplicationDashboard()` against production. **Look at both screens on a real login.**

## ✅ LIVE — animal questionnaire, merged into pet registration

- ✅ One form, three branches (pet / service animal / ESA / "I am not sure"), merged INTO the existing `pet_registration` e-sign rather than beside it, so an accommodation request is never filed under a name that calls it a pet.
- ✅ Readily-apparent task, or apparent disability + apparent need → **the inquiry stops**. No field anywhere for diagnosis, severity or medical records; the fill route whitelists field-by-field so none can be persisted.
- ✅ `pets_allowed = false` closes the PET path and **opens** the accommodation path. Answered for all 26 associations (MANXI false, rest true) — **defaults, not board answers.**
- ✅ Files: vaccination record required when the applicant answers "yes, vaccinated"; **photo required on every branch** (user direction, 2026-08-15).
- ✅ Guarded by `npm run test:gate` — 48 cases, the second real test in the repo. Run it before touching `lib/animal-*.ts`.
- ⛔ Attorney-review gating **removed** per user direction 2026-08-15. Behavioural guardrails remain and are the substantive protection.

## ✅ LIVE — vehicle/animal declaration gate

A car-free applicant could never reach complete: vehicle documents were unconditionally required and only staff could clear them. `association_intake_documents.condition_key` + `listing_applications.declarations`; answers write BARE doc_keys into `na_items` so every existing completeness gate works unchanged.

## ✅ LIVE — staff-created applications, tenant sponsorship, request examples

- ✅ `+ New application` on the audit queue creates the application **and its Drive folder** — for documents that arrive by email. No email sent; ≥1 name required; duplicate-unit guard.
- ✅ **Tenant sponsorship** (`/sponsorship/[token]`): the approved tenant confirms an additional occupant and supplies that person's **own email — required, and rejected if it matches hers**. Email is identity for OTP and e-signature, so a shared address records the occupant's signature against the tenant's mailbox.
- ✅ Additional occupants **show** the current lease (tenant of record, term, board approval, links) rather than copying its files.
- ✅ Request emails carry the checklist's clarifier + an **example** of each document; 📎 Add example per row (nothing could set `template_path` before); 📨 Re-send rebuilds from the current checklist.
- ✅ Owner unit insurance required on **18 associations** (15 condo + LFA co-op + GVH + PVV). Out: BHB (single-family), LCLUB/VPREC (master, no units).
- 🔴 **Open: commercial insurance form** for ESSI, KANE, MACO, WBP, WBPA — CP 00 17 / BOP, not HO-6. Confirm with the agent before seeding.

## 🔴 Bugs fixed this round — watch for recurrence

- **`.maybeSingle()` on a lookup that can legitimately return several rows.** Any co-owned unit lost its owner name AND email (header + request recipient): **231 of 521 units, 37 at MANXI**. Grep for `.maybeSingle()` on `owners` before adding another.
- **Editors seeded from props once** never re-sync after the server normalises a value — `dirty` never clears and saves look like they failed.
- **An approved application could not be corrected** — the fix is confirm-then-edit with an audit stamp, not "start a new one" (which discards uploaded documents and the signed approval letter).

---

## ✅ LIVE — applications pipeline is association-generic + Venetian Park I onboarded (PRs #691–#696, 2026-08-14)

Detail in `docs/SESSION-HANDOFF.md` (top section) and memory [[venetian_i_onboarding]].

- ✅ Per-association Drive folders (`associations.{official,archive,ongoing}_folder_id`). The global Manors XI triple would have filed other associations' documents into Manors XI's tree; unconfigured associations now get a named error, never a fallback.
- ✅ Unit folder names use the unit's own address; unit refs resolved from CINC (VPCI accounts carry a building letter `MANXI+digits` can't produce).
- ✅ Venetian I: folders, legal name, 27-row checklist, stored Rules PDF, 13 folders renamed `ACCOUNT_ADDRESS`, 5 lease dates imported.
- ✅ `rules_knowledge_ack` e-sign form; the board's own Rules pages spliced in verbatim rather than retyped.
- ✅ `provided_by: 'both'` — a document can come from tenant OR owner (renter's insurance).
- ✅ **Closed (#698):** `rules_knowledge_ack` can be created and sent; MANXI now has content + stored packet + a `governing_docs_ack` item.
- ✅ **Closed (#698):** rows restyled to the previewed design — one ✎ Edit, four flag states, expiration inside the drawer.

## ⚠️ Checkr — integration re-proven working, TWO blockers before going live (updated 2026-08-30)

The integration is **live-verified end to end in production** (real sandbox orders from prod, real webhook deliveries, stored report PDFs, user completed the hosted consent flow) — re-confirmed again 2026-08-30 via the Test Environment tab, both scenarios still work.

**Blocker 1 (known since 2026-08-14): key mode unverified.** Not verified whether `CHECKR_API_KEY` is `ckr_sk_test_` or `ckr_sk_live_` — the Vercel vars are Sensitive (unreadable via UI or API) and unedited since Jul 6, when they were added with test values.

**Blocker 2 (new, 2026-08-30): the `essential` package is missing credit report + eviction history.** Pulled a completed test order's structured report (`GET /reports/{id}`, not just the PDF) — `credit_report` and `eviction_history` both come back `null`; only criminal history, sex offender registry, and global watchlist actually run. This contradicts what Checkr's own pricing conversation described Essential as including. Emailed `hello-tenant@checkr.com` with the exact order/report IDs and the full breakdown — **awaiting their reply**.

**Do not set any association's `screening_provider` to `maia_checkr` until BOTH are resolved.** A sandbox key returns canned results for real people — worse than an error, because nothing looks wrong; a package silently missing credit/eviction data would leave the board deciding on an incomplete picture. Offered, not built: an admin diagnostic reporting only the key prefix.

## 🔴 Rentvine tenant sync — dead since 2026-06-17

`/api/cron/sync-rentvine-tenants` calls `${base}/leases/export`, gets HTML, and `res.json()` throws on every run. No `res.ok` check, no status in the log line. Months of residential lease-end archiving and new-tenant adds have not happened. Found 2026-08-13, still unfixed.

---

## ✅ LIVE — Applications / Pre-Application Compliance command center (PRs #606–#689, 2026-08-06 → 08-13)

The staff workflow on **`/admin/pre-apply`** and the board view on **`/units/applications`**. Detail in `docs/SESSION-HANDOFF.md` (top three sections) and memory [[preapply_per_applicant_and_requests]].

- ✅ Per-applicant intake (tabs + roles + credit score), shared vs per-person checklist, roster read from the lease.
- ✅ Request-documents flow (Owner/Tenant/Both → standard MAIA email → token upload page) + communication history + agents CC'd.
- ✅ Approval letter: preview → email board for e-signature → auto-file → **BCC the signed PDF to all parties** (#676/#677).
- ✅ Applicant uploads mirror to Drive + notify staff **on arrival** (#683), resume instead of duplicating (#684), multi-page "+ Add page" (#687), "Move to:" re-file (#688), and **every upload reads its expiration** (#689).
- ✅ Delivery observability: plain-text alternative (#672), provider message id (#674), **Resend webhook** (#675) — ⚠️ needs `RESEND_WEBHOOK_SECRET` + the webhook registered in Resend.
- 🔴 **Open:** full row-restyle to the approved mockup; on-site manager page; dedicated occupant-affidavit template; background-check consent → Checkr wiring; owner-outreach emails into the comms timeline.

## ✅ LIVE — production fixes found via the Vercel MCP (2026-08-12)

- ✅ **Node 22** (20.x EOL; Vercel disables new 20.x builds 2026-09-30) — ⚠️ **also flip it in the Vercel project settings UI**.
- ✅ Gmail 404 flood on purged messages (#681).
- ✅ Outbound rate limit was **silently dropping staff notifications** (55 invoice confirmations to `billing@`); internal domains now get `MAIA_OUTBOUND_INTERNAL_LIMIT` (default 25) (#681).
- ✅ Reconciliation cron finishes inside a 240s budget with an hour-rotated offset instead of dying at 300s (#682).

## 🔴 Pricing / commercial (2026-08-13, decided, not implemented)

Per-association MAIA fee set at **$50/month + $0.50/unit** (MANXI 148 units → **$124/mo**). No billing mechanism exists in the platform — proposals are produced by hand today.

---

## 🟡 IN PR #506 (branch `feat/board-approval-reliability-2026-07-17`, migrations applied to prod, NOT yet merged/deployed) — 2026-07-17

Four bundles of work. **Migrations already applied to prod** (safe to deploy), but the code is only live once #506 merges.

**1. Board-approval overhaul.** Per-purpose config + committee, replacing the single shared `association_config` row.
- New tables `board_approval_config` + `board_approval_members`: signature count / approval-letter template / reminder cadence / committee are set **per purpose** (application / invoice / estimate). Backfilled from existing active board members.
- **Deciders vs Voters** — Decider's decision is binding toward the threshold, Voter's is advisory. Shared `BoardMemberPicker`.
- **New invoice board-approval** (optional, staff-triggered): send link → picked board members, per-association reminder cron (`board-approval-reminders`), and on decider approval flip the CINC invoice out of Pending Approval via `approveInvoice` + stamp approver via `createInvoiceNote`. Does NOT block the normal CINC push.

**2. Invoice→CINC push crash-resume ("Path B").** `invoice_intake_drafts.push_progress` jsonb. CINC id persisted the instant `createInvoice` succeeds; each post-create step checkpointed + skipped on retry, so a mid-push crash resumes instead of double-creating a GL line / PDF / note. Resume detected by a non-terminal draft already carrying a `cinc_invoice_id` (no new status — draft stays in Ready-to-push tab). *(Chose in-house checkpoint over Vercel Workflow SDK — reserve the SDK for a genuinely long-running flow like application→Checkr→board.)*

**3. Intent-classifier eval harness.** `lib/intent-classifier.ts` (extracted from the webhook route, behavior-identical) + `evals/` with 33 fixtures. `npm run eval:intent` → accuracy report, exits non-zero <85% (CI-gate-ready). First automated test over an AI path.

**4. Recurring crew emails + upload page.** Office copy now sent on SMS/WhatsApp channels (was email-only); crew message AND `/vendor/upload/[token]` page now show the association **name + property address** instead of the cryptic code. Verified live.

**Also in #506:** CINC Contacts & Consent v2 scaffolding (`listPropertyContacts`, `listAssociationPropertiesV2`) — **unwired**, prod flag still off; blocked on the `isCurrentOwner`/`OwnerNumber` gap (see its own section below).

**Pending TEST (post-merge):**
- Configure the **invoice committee** per association in Board Setup (starts empty — only application/estimate were backfilled).
- **CINC `approveInvoice` smoke test** — that endpoint was never exercised before; push one real invoice through board approval and confirm it actually leaves Pending Approval (best-effort, won't break the push if it fails).
- **Invoice-push resume** — push one real low-stakes invoice, confirm normal completion (resume only triggers on a real mid-push crash).
- **Board approval Decider/Voter** — confirm a Voter's approve does NOT close, a Decider's does.
- **Reminder cron** — manually hit `/api/cron/board-approval-reminders` with `CRON_SECRET` against a stale review; confirm it sends + dedups.
- **Recurring** — Paola re-sends links for Dimas's visit; confirm office copy + name/address land.

---

## ✅ DEPLOYED — blank-PDF root-cause fix, session-secret security fix, vendor-crew SMS redirect (commits through `a723d48`, 2026-07-12/13)

Full detail in `docs/SESSION-HANDOFF.md`'s top section. Headline items: (1) invoice PDFs rasterized for CINC/Drive were silently dropping all text on Vercel (pdf.js missing `standardFontDataUrl` — masked locally by Mac system fonts) — root-caused, fixed, 18 already-pushed invoices' CINC attachments corrected (Drive copies still need a manual re-mirror click each); (2) Production had **no `MAIA_SESSION_SECRET`**, silently using the hardcoded dev-default visible in this public repo — real secret generated + set + redeployed, all prior sessions invalidated as expected; (3) recurring-service crew SMS/WhatsApp replies now redirect to the upload-link form (no phone→ticket correlation existed before) with a one-time "which job?" menu when a crew member covers more than one active service; (4) `service_visits` crew-link send status now persists and shows on `/admin/recurring-services` instead of a one-time alert.

**🟡 Built + verified locally, NOT YET COMMITTED (confirm before assuming live):**
- New Flows diagram: Application Process (`/admin/flows/application-process`).
- Document-preview-not-download on `/admin/applications` + `/board/review` (signed docs, Gov ID, Proof of Income, Checkr report pop an inline image instead of downloading).
- **Tropicana II (TROP) onboarding**: "Association Details" + "Onboarding Checklist" cards on `/admin/cinc-sync/[code]` (new `PATCH /api/admin/associations/[code]`), and a real architecture fix so **every future new association's public resident-portal site works automatically** the moment its `associations` row exists — no hand-built page, no deploy (`app/[slug]/page.tsx` now renders the shared portal component directly for any active unmapped association code). TROP also got a real branded URL, `/tropicana2`.

**Pending:**
- ✅ Stripe confirmed **LIVE (production mode)**, resolved 2026-07-13. Next step: run one real end-to-end test application through `/apply` to confirm the live-mode path works.
- ✅ Drive re-mirror for the 18 PDF-fix invoices — confirmed not needed, all good (2026-07-13).
- TROP needs its real address / Sunbiz info / board-approval-signature count entered now that the UI exists.
- Check whether other associations besides TROP are missing the same core-identity fields (only TROP + the original 25 were checked).

---

## ✅ DEPLOYED TO PRODUCTION — Checkr background-check integration + application pipeline (commits through `307fc65`, 2026-07-06/07)

Replaces the dead ApplyCheck integration (no public API). Real architecture: Bearer token auth, a single `POST /orders` call per subject (applicant+property+package together), and **no embeddable consent widget** — Checkr emails the applicant a link to their own hosted page to finish consent/questionnaire. Real API base `tenant.checkr.com/api` (not `api.checkr.com/v1`). Webhook signature: `Tenant-Signature: t=<ts>,v1=<hex hmac-sha256("t.rawbody")>`.

**This is now live on www.pmitop.com, not just test/dev** — pushed to `origin/main` (auto-deploys), Checkr env vars added to Vercel Production (still test-mode key, user explicitly OK'd this for now), verified against the real production deployment. A real applicant genuinely completed the Checkr-hosted consent flow end to end via a test order and it processed correctly.

**Shipped this arc:**
- Report PDF capture — Checkr renders the actual report itself (`GET /reports/{id}/pdf`); we fetch/store/link it, never generate report content ourselves. Stored in a private `screening-reports` Supabase bucket.
- **No international Checkr package** — confirmed via Checkr's own pricing page that international checks are à la carte per-country (some take 25-31 days for one check), not a package slug. Decision: every applicant, including international, runs the same domestic Essential check; the country-specific gap (foreign criminal record, financial standing) is covered by applicant-uploaded documents instead — disclosed in 7 languages, with a downloadable CPA-requirements guide PDF the applicant can hand to their own accountant (`lib/intl-cpa-guide-pdf.tsx`, bundles Noto Sans + Noto Sans Hebrew locally since react-pdf's default font doesn't cover Hebrew/Cyrillic). ⚠️ This package lived only in the old standalone `/apply` form until 2026-08-28/29 — see the MANXI Application Guide project entry above for when it was actually wired into the real checklist/rules that drive approvals.
- **CPA Financial Certification** replaces an earlier bank-statements + bank-reference-letter design — one comprehensive CPA-prepared report (income/assets/liabilities/net worth/USD conversion/capability statement) instead of two overlapping documents.
- **New "Test Environment" tab** in `/admin/applications` — staff create a real test application (any applicant type, custom name/email, 7 languages) against the real Checkr sandbox, bypassing Stripe. Only two Checkr scenarios offered (quick auto-complete, and the "Hudson Green" tuple for a real consent-email flow) since Checkr's separate Workforce mock-candidate spreadsheet doesn't apply to the Tenant API this integration uses (confirmed directly by Checkr).
- **Board "Request More Info"** — a third option beside Approve/Reject, free text instead of a signature, emails staff, doesn't lock the reviewer's token the way a final decision does.
- **"Preview Board View"** button — staff can see exactly what a board member's review page looks like without a real per-member token.
- **Signed Rules Acknowledgment is now a real PDF** (`lib/rules-acknowledgment-pdf.tsx`) — actual drawn signature image, applicant photo, acknowledged document versions, audit trail (IP/geolocation) — instead of a one-line text summary.
- **Gov ID / Proof of Income are now per-applicant** (previously ONE shared upload for the whole application, even for a couple) — embedded in each `applicants[]`/`principals[]` entry, no migration needed. Admin + board pages both show a unified per-applicant panel: name, their own documents, their own Checkr status + report link.

**Still open:**
- ✅ Stripe confirmed **LIVE (production mode)**, resolved 2026-07-13 — needs one real end-to-end test application to confirm the live-mode path works, not a config check.
- ⛔ ~~Final combined PDF package delivered to Google Drive~~ — decided off, 2026-08-28 (duplicate of the same item lower in this doc — see "Suggested priority" #3 for why).
- A "Flows" diagram for the application process (matching the existing click-to-popup style) — requested, not started.
- Full Checkr production account authorization (test key works; going live needs Checkr's sign-off).

See `screening_provider_pivot.md` in memory for full history.

---

## 🟡 Built, in progress — per-association "in-Maia application" + eligibility rules (commit 80bcad3, 2026-07-05)

Replaces the static per-association PDF "Application Forms" (`lib/association-documents.ts`'s own comment flagged this as temporary). Two pieces:
- **`association_application_rules` table + new "Application rules" admin tab** (next to Association Document Setup) — per-association eligibility rules (individuals-only/no-LLC, min lease term, rental frequency, post-purchase hold period), each tagged `block` (mechanically enforced — `/apply` hides the option, checkout hard-rejects server-side too) or `warn` (shown to the applicant as a notice only, since checking it reliably needs data that isn't populated yet). **VPCI's 4 rules seeded** from its real Declaration + Rules and Regulations.
- **Gap found while building**: `owners.ownership_start_date` already existed in the schema but is populated for only 1 of VPCI's 78 active owners — this is what blocks the "no renting for 2 years post-purchase" rule from being a hard `block` today. Confirmed Broward County's Property Appraiser site (`bcpa.net`) has the real purchase dates (Sales History per parcel) and is readable — backfill is in progress manually (association by association), pulling the last **qualified sale** date (not just the latest deed — trust transfers/quitclaims show up too and aren't purchases).
- **Content build, one association at a time** (23 real associations, 2 `master_hoa` excluded: LCLUB, VPREC — no direct unit sales/leases). VPCI is first: extracted from its real uploaded PDFs (fixed 2 that had never actually been OCR'd — the automated pipeline had silently returned blank text for the Declaration), built a static HTML mockup for sign-off, generated an updated application-form PDF (new $150 fee, corrected board-response timeline) delivered to Downloads + the association's Drive folder.

**Next**: finish backfilling VPCI's remaining ~59 units' `ownership_start_date` (in progress with the user, manually via BCPA), wire the VPCI mockup into real `association_config.rules_sections` once approved, then move to association #2.

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
3. **Background check** — ApplyCheck rejected (no API), Certn abandoned, **Checkr Tenant API integration deployed to production 2026-07-06/07** (see section near the top of this doc) — live on www.pmitop.com with a test-mode key (user OK'd this for now); full production account authorization from Checkr still pending.
4. **Per-association rules ack** in `/apply`. ✅ built.

(Detail in memory: `roadmap_reconciliation_2026_06_30.md`, `owner_self_service_decisions.md`, `screening_provider_pivot.md`, `voice_plan.md`.)

## Suggested priority
0. ⚠️ **Watch the first real application go through the fully-automatic pipeline** (see the top section, 2026-08-20) — `submitted → under_review → approval_sent → approved` with no manual clicks. Every board email now CCs PMI. Confirm Susie Bell / MANXI 110 (#731) went through cleanly.
1. 🟡 **In-Maia application process, association by association** — VPCI in progress (mockup + PDF built, pending your sign-off), 22 real associations to go. Ownership-date backfill for the eligibility rules is the current bottleneck (manual, BCPA lookups).
2. ✅ **Checkr integration** — deployed to production 2026-07-06/07 (see section near the top of this doc). Stripe confirmed LIVE 2026-07-13. Next: run one real end-to-end test application to confirm the live-mode path, get Checkr production account authorization.
3. ⛔ ~~Final combined application PDF package → Google Drive~~ — **decided off, 2026-08-28**. Re-examined against [[drive_file_organization_system]] (design locked 2026-07-30): the real need is already covered by the existing per-unit Official/On Going/Archive Drive structure + one-click **Promote application** (copies renamed individual keeper docs to Official on approval, moves the full PII packet to Archive) — that system deliberately keeps documents as SEPARATE files, not merged, partly because a real bundle (background check report + every submitted doc + rules ack + approval letter) could easily run 50-100+ pages. No standalone "one combined PDF" feature needed.
4. 🔴 **Flows diagram for the application process** — requested, matching the existing click-to-popup style, not started.
5. ✅ **Pre-registration triage Phase 2 + unit occupancy control** — done (2026-07-04). Pending your action: try `/admin/unit-status`'s survey button for real (it dry-runs by default) and confirm the Send Occupancy & Insurance Survey copy reads right before the first live send to real owners.
6. Continue the Flows diagrams series — `/apply` Tenant/Buyer Application next (see #4 above, same item).
7. Medium WO/recurring items → 8. Compliance Phase 2 (deadline-rules + document RAG) → 9. smaller comms/invoice follow-ups.

**Verify on next real call:** the renumbered menu (#497) + payments delivery-channel sub-flow (#498) — confirm a real call reaches the "text/WhatsApp/email?" prompt on digit 1 and the message actually arrives via the chosen channel; confirm a real collections-blocked unit now correctly hears the agency message on digit 1 (not just the test account). Also confirm the resident portal's new "Get my account statement" button delivers a real ledger email in production (local testing was code-path-verified via curl/DB only, since local dev has no email provider credentials).

**Blocked / external:** natural-voice agent (Vapi/Deepgram/ElevenLabs accounts).
