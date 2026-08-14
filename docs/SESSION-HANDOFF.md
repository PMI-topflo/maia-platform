# Session handoff — 2026-08-14 (latest)

## Venetian Park I onboarded — and the pipeline stopped being Manors-XI-only (PRs #691–#696, all merged)

**Applications pipeline de-MANXI'd (#696).** Three couplings, all of which would have bitten association #3 the same way:
- `DRIVE_FOLDERS` was ONE global triple of Manors XI folder ids, used unconditionally — a Venetian I application would have filed its documents **into Manors XI's Drive tree, silently**. Now `associations.{official,archive,ongoing}_folder_id` + `resolveAssocDriveFolders()`; an unconfigured association gets a **named error, never a fallback**.
- `unitFolderName()` hard-coded `4174 Inverrary Drive` → now the unit's own `owners.address`.
- Unit refs were `MANXI` + digits; VPCI accounts carry a building letter (`VPCI91M`) → `resolveUnitRef()` reads CINC.
**Manors XI is unchanged** — same ids, names, refs.

**Venetian I is configured (live in prod DB).** Folders official `1wMphbTBY3C1YOe9wLdvBa8Yc7WbsaLaj` / ongoing `15JEWV6LdZ-fLVxqWHcxW0EdDsSEIcBwh` / archive `1qkPYGjrZMTATJWltWiaZf87HO4ihq1X8`; legal name set; `rules_pdf_path` stored. ⚠️ The user's first "Official" link was the PARENT container — check folder titles before wiring ids.

**Its own 27-row checklist** replaced Manors XI's inherited 39 (which included a City-of-Lauderhill certificate — wrong city; **VPCI has no certificate of use**): driver's licence · vehicle registration · Rules Knowledge Acknowledgment (e-signed) · background check · pet registration (optional) · **Liability & Renter's Insurance (annual, `provided_by: 'both'`)** · lease/purchase agreement. `chk_intake_provider` widened to allow `'both'`.

**Rules Knowledge Acknowledgment is now an e-sign form** (`rules_knowledge_ack`), replacing an 11-page print-sign-scan packet. Two instructions removed ("email it to support@", "do the background check on Rentvine") because MAIA does both; manual signature sheet replaced by verified e-signatures; §718.116(11) DELINQUENT UNIT notice added. **The board's own Rules pages are spliced in verbatim** (`lib/rules-ack-pdf.ts`) — never retyped, so the signed copy can't drift from the recorded governing document.

**13 Venetian I Drive folders renamed to `ACCOUNT_ADDRESS`** (#695 built the engine; the renames themselves were done directly). Matcher verified 13/13, 0 wrong. Old names logged in `drive_folder_renames` — reversible.

**Lease dates imported.** VPCI had **zero** `unit_tenant_contacts` rows; now 5, read out of the actual lease PDFs. **Every lease has already expired except one** — 97M (Aharonov/Vaknin) runs to **2026-08-31 and its lease is UNSIGNED**; its 7-day renewal alert fires **2026-08-24**.

**Also merged:** #691 re-read a stored document's expiration on demand (+ backfilled 7 rows; MANXI 1002's HO-6 was already expired), #692 owner fills the tenant roster and tenant items are held until they do, #694 `@maia upapp MANXI103` files an email into the application's communication history.

### ⏳ NEXT
1. **Nothing creates a `rules_knowledge_ack` document** — the form renders, but no applicant can be sent one. Same wiring check for `pet_registration` (confirmed: should trigger the existing pet e-sign form) and `renters_insurance`. **This is what blocks a real VPCI application.**
2. **Checkr:** integration is proven end-to-end in production; only the KEY MODE is unverified — Vercel vars are Sensitive and unedited since Jul 6, so probably still `ckr_sk_test`. **Do not flip anyone to `maia_checkr` until the prefix is confirmed live.**
3. Row-restyle of `/admin/pre-apply/[id]` — **the approved mockup is not in the repo and has never been seen. Ask for it; don't invent it.**
4. Owner outreach for VPCI gaps: 50K no screening + no lease since 2024-11; 91M no board approval; 97M-2024 no eviction reports; 97M-2025 unsigned lease.
5. Official folder intentionally empty until a future feature emails owners to declare leased / owner-occupied / vacant.
6. **Rentvine tenant-sync cron has been dead since 2026-06-17** — `${base}/leases/export` returns HTML, `res.json()` throws every run, no `res.ok` check. Still unfixed.

---

# Session handoff — 2026-08-13 (latest)

Snapshot for picking up on another machine. Everything below is **live in production on `main`** unless noted. Drive/AI/email paths are **prod-only** (local service account + `RESEND_API_KEY` are placeholders/absent) — validate live on **MANXI 309 (purchase, approval letter signed)**, **103 / 1002** (applicant-uploaded docs), or **901 / 801**.

---

## 2026-08-12/13 — approval-letter distribution, production fixes found via Vercel MCP, applicant-upload gaps (PRs #665–#689, all merged)

### Approval letter — from "create" to "everybody has the signed PDF"
- **#668** "Create & send for signatures" now actually emails the board (it silently required a second hidden button). **#667** the section appears as soon as an application is submitted. **#669** issue date on the letter. **#670** applicant + approved occupants pulled from the **whole roster** (was only the primary → blank on 801). **#671** names the expected approvers + shows their emails. **#673** "Copy signing link" that persists across reloads.
- **#676 / #677** `lib/approval-distribution.ts` → `distributeApprovalLetter()`: on full signature (and via a manual **📤 Send signed letter to all parties** button) the signed PDF is emailed **BCC** to applicant, owner, both agents, signers, on-site manager and PMI, with a congratulations email; recorded in the **communication history**. Also **flags a missing applicant email/phone** — the letter can't reach someone MAIA has no contact for.
- **#666** "📨 Send invite" button; **#665** the link generator shows the unit's owner (name + email) automatically.

### Email deliverability (the "Angelique didn't receive it" thread)
- **#672** every MAIA email now carries a **plain-text alternative** (Yahoo/Gmail treat HTML-only as spammy). **#674** `providerMessageId` recorded on every send. **#675** new **Resend delivery webhook** at `/api/webhooks/resend` (Svix-verified) recording delivered / bounced / complained per email.
- ⚠️ **User-side setup still owed:** add the webhook in the Resend dashboard (`https://www.pmitop.com/api/webhooks/resend`) and set **`RESEND_WEBHOOK_SECRET`** in Vercel.
- Root cause of that thread was **not** DNS — Resend showed Delivered, and DKIM/SPF/DMARC all verified.

### Production issues found with the Vercel MCP (none had been reported by staff)
The Vercel MCP is now connected (`vercel mcp --clients "Claude Code"`; `npx vercel plugins add` does not exist in CLI 58.9.5). Reading real runtime errors surfaced three live bugs:
1. **#681 Gmail 404 flood** — a vanished/purged message threw on every poll. Now returns `null` instead of erroring.
2. **#681 rate limit was silently dropping staff email** — the per-recipient cap (3 / 5 min) killed **55 invoice-approval confirmations** to `billing@` during batch sends. Internal domains now get a higher cap (`MAIA_OUTBOUND_INTERNAL_LIMIT`, default 25). This is exactly the "Karen sometimes gets no confirmation" complaint. **All invoices themselves landed in MAIA** — only notifications were lost.
3. **#682 reconciliation cron** was dying at 300s. Now hour-rotated offset + a 240s budget, reporting `assocsDeferred`.
- **#674 Node 22** (20.x is EOL; Vercel disables new 20.x builds 2026-09-30). ⚠️ **User-side:** flip the Node version in Vercel project settings too.

### Applicant uploads were arriving invisibly
- **#683** every applicant upload now **mirrors to Drive immediately** and the **first document pings staff** — before, files only reached Drive/staff when the applicant pressed SUBMIT at the very end (MANXI 1002: three documents in, nobody told).
- **#684** opening the link twice used to create a **new application every time** → it now **resumes** the existing unsubmitted one; the dashboard gained a **📥 Documents arriving** in-progress block. (Two empty duplicates on 1002 and 613 were deleted.)
- **#685** "📤 Send these documents to Drive" for applications whose files never mirrored.
- **#686** a **shared** document counts no matter who uploaded it (applicant uploads stamp `stakeholder_id`; the shared lookup required null → showed "Missing" on 103/1002).
- **#687** "**+ Add page**" keeps a multi-file document (e.g. a 3-page lease scanned as 3 files) together on one checklist item; **#688** "**Move to:**" re-files a misclassified document onto a different item without delete + re-upload.
- **#689** **every upload now reads its expiration date.** Only the Drive scan ran `quickDocScan`, so anything uploaded directly (applicant link or staff) was stored with **no expiration and no filing name** — the exact feature the intake exists for. `DOC_TYPE_TOKEN` + `suggestedIntakeName()` now live once in **`lib/intake-naming.ts`** (the duplicated copy is how `signed_purchase` went missing and a purchase agreement filed itself as "Document" — **#680** fixed the naming/archive-folder side of that).

### Other fixes
- **#678** the expired-file alarm only counts documents on **this** application's checklist (a purchase was showing a phantom "expired lease"); **#679** the meta editor now **reports documents left over** when the application type changes (the real cause).

**⏳ NEXT / owed:**
1. **User-side setup:** Resend webhook + `RESEND_WEBHOOK_SECRET`; Node 22 in Vercel project settings; `vercel login` for the CLI.
2. **MANXI 309:** click **📤 Send signed letter to all parties**, then **Board approved → Confirm & execute**.
3. **MANXI 103 / 1002:** click **📤 Send these documents to Drive**; on 103 use **Move to: Full Executed Lease** for the two misfiled lease pages. Re-uploading anything now captures expirations (#689) — old rows still need a manual expiry or a re-scan.
4. Still open from before: full **row-restyle** to the approved mockup; on-site manager page; dedicated occupant-affidavit template; background-check consent → Checkr wiring.
5. **Business collateral produced this session (not in the repo):** a MAIA briefing + pricing model, and a MANXI board proposal at **$50/month + $0.50/unit → $124/mo for 148 units**, leading with expiration tracking + full CINC integration.

---

# Session handoff — 2026-08-11

Snapshot for picking up on another machine. Everything below is **live in production on `main`** unless noted. Drive/AI/email paths are **prod-only** (local SA is a placeholder) — validate live on **MANXI Unit 901 (Shadia Boyd, lease renewal)** or 801 (multi-applicant: Jean/Nicholas/Jane Bruna).

---

## 2026-08-10/11 — Applications: per-applicant model + request-docs + comms + agents + CINC email cleanup (PRs #634–#663, all merged)

Huge continuation of the Applications command center. Full detail in memory [[preapply_per_applicant_and_requests]].

- **Per-applicant intake (Tenant-Evaluation model):** `association_intake_documents.per_applicant` + `allow_multiple` (2 tax returns) columns; **applicants read from the lease automatically** (`autoRosterFromLease`); `application_stakeholders.applicant_role` (Primary/Co/Owner/Tenant/Spouse/Adult-Occ/Minor/Guarantor) + `credit_score`; per-applicant docs render as **TABS** (name+role+missing badge); scan auto-assigns per-person files by name; **shared vs per-applicant** split on both `/admin/pre-apply/[id]` and the board `/units/applications`. Approved apps **locked** from meta-edit (#635). Additional-occupant/lease-renewal **carry-over** of the previous term's keeper files.
- **Request documents flow:** checkbox items + **Owner/Tenant/Both**, standard MAIA email (`lib/maia-email.ts`) + secure token upload page `/request/[token]` (no login) that files back onto the app. Email lists requested items + **"Already on file" (w/ expiry)** + cross-notes the other party. **Recipient email confirmed/editable before sending** (#659). **"Tenant contact info"** item → the **owner fills the tenant's email/phone** when the lease lacks it (#654). **Agents** (owner=listing_agent, applicant=applicant_agent) CC'd (#663). Upload pages have a **message box** (#661).
- **Communication history** under the request box: every request (recipients, items, note, replies) + the **Board Approval Letter — only once the board has signed it** (#662).
- **Approval letter (Board Decision Page):** available after **audit**; **👁 Preview** (no create/send); **lease term prefilled from the lease**; **✉ email the board for signatures**; **auto-files** as `board_approval_letter` on full signature (#650).
- **Guided page:** progress stepper + MAIA **screams on expired files** (red alarm) (#653). *(Additions on the working page, not the full mockup rewrite — row-restyle still pending.)*
- **CINC owner-email cleanup (data + sync):** the `owners.emails` field had accumulated **stale addresses** (never-drop union merge). Fixed: CINC is now **authoritative** (sync prunes to CINC, #660); **one-time cleanup ~399 units portfolio-wide** aligned to CINC (backup `owners-emails-backup-ALL.json`, reversible); units where CINC has NO email left intact for review — **MANXI 207/505/708/711/802, SP 10B**. See [[cinc_owner_emails_authoritative]].

**Schema added (RPC, live):** `association_intake_documents.{per_applicant, allow_multiple}`; `application_stakeholders.{applicant_role, credit_score}`; `document_requests` table (+ `owner_note`/`tenant_note`). Standard email header rule: [[maia_email_standard_header]].

**⏳ NEXT / owed:**
1. Test the whole flow live on **901** (roster from lease → request docs → owner/tenant/agent emails → comms history → approval letter preview+send).
2. Full **row-restyle** to the approved redesign mockup (status pills per row, sections) — only the stepper+alarm shipped.
3. Review the **6 skipped owner-email units** (no CINC email) against CINC; decide their emails.
4. Offered: owner-outreach emails into the comms timeline; both-agents-on-everything (currently each agent copied on their own side); dedicated occupant-affidavit template; background-check consent → Checkr.
5. Ownership Transfer / Occupancy Registration types were **removed** per user (#647).

---

# Session handoff — 2026-08-07

Snapshot for picking up on another machine. Everything below is **live in production on `main`** unless noted.

> ⚠️ **Repo path:** the canonical clone is now `~/maia-platform` (moved out of iCloud). Stale copies under `~/Documents/GitHub/maia-platform` and `~/Downloads/maia-platform` — ignore them.

---

## 2026-08-06/07 — Applications COMMAND CENTER + Drive filing UI (PRs #606–#622, all merged)

**What shipped (all live on `main`):** the full staff Applications workflow on **`/admin/pre-apply`** (now the primary "Applications" menu item; the old Checkr `public.applications` screen renamed **"Applications (Checkr)"**, kept for the future MAIA+Checkr flow). See [[pre_application_compliance]] memory for the blow-by-blow.

- **Dashboard (#609/#612):** every application grouped by stage (Collecting docs → Submitted → Under review → Approved/Declined) + a **"On Going Applications — Drive folder"** section listing the 13 unit folders already in Drive (many pre-date the pipeline → "Drive only").
- **Bring into MAIA (#613):** one click creates a `listing_applications` record linked to the unit's existing On Going Drive folder.
- **Scan & import (#615/#616):** reads each Drive file **by content** via `lib/quick-doc-classify` (ONE Haiku call/file → `{label, expiration}`; replaced the heavy escalating classifier that was **timing out** = the "not valid JSON" error), matches to the checklist, imports. Capped 40 files, resilient to non-JSON.
- **Reviewable doc rows (#618/#619/#620/#622):** inline **👁 Preview** (iframe/img via `/doc/[docId]` GET-redirect = **fresh signed URL each click**, fixes the `InvalidJWT exp` error); editable **expiration** + **"Does not expire (keep current)"**; **✎ rename** editable (`suggested_name`, auto `YYYY_MM_Type`); **Ignore**; **Mark N/A** (applicant lacks it → drops from missing-required); **📁 From Drive** picker to assign any folder file to an item, with **page-range extract** ("3-4" pulls just those pages of a combined PDF via pdf-lib — the "W-2 inside full_report.pdf" case) + **keep original name**.
- **Board approved (#614):** dry-run preview → confirm → copies ⭐**keepers** to Official renamed `YYYY_MM_Type` + MOVES the whole folder to OLD/Archive + trashes the On Going wrapper + extracts lease→`unit_tenant_contacts` + marks approved. **KEEPER LIST (locked):** Deed/Ownership · Lease (+ Landlord–Tenant Agreement) · HO-6 Insurance · Certificate of Use · Governing-Docs Ack · Board Approval → Official; everything else (IDs, tax returns, PII) Archive only.
- **Applicant-facing:** notarized-form **📥 download to print & notarize** + upload (#617); e-signed Landlord–Tenant Agreement auto-files to the app + On Going on completion (#621).
- **Notify (#611):** owner emailed when a NON-owner starts an application (reply-to support@).
- **Unit page (#608):** "📋 Application in progress" card (docs + dates the board keeps asking for).
- **#607 REVERTED the #606 premature auto-Official** (Official only on board approval).

**Schema added (RPC, all live):** `application_documents.{expiration_date, suggested_name, no_expiration}`; `listing_applications.na_items`; `association_intake_documents.{template_path, requires_notarization}`; `application_stakeholders` signing cols (#604). MANXI lease checklist = 12 items (added board_decision_page, tenant_affidavit, landlord_tenant_agreement, board_approval_letter).

**⏳ NEXT (user testing owed — Drive+AI paths are PROD-ONLY, not verified live by me):**
1. **Scan unit 1003 fresh** → confirm expiration reading now works (was the gap) + page-extract splits the right pages.
2. **Board-approved DRY-RUN on ONE unit** → review plan → execute → verify Official+Archive via the Drive read connector before running the rest.
3. Deferred: auto-rename files **inside the On Going Drive folder on save** (currently rename only applies when copied to Official; editable-rename + keep-name partially cover it).
4. Offered: preview-with-clickable-page-picker instead of typing ranges.
5. Finish 7-language translation of the docs/verify/rules steps (English fallback in place; persona+invite done).
6. **User-side:** move the misfiled `2026_08_Lease_Agreement.pdf` out of MANXI912 Official (from the #606 bug); set `ADDON_TOKEN_SECRET` in Vercel (Paola sidebar); Checkr prod-auth → flip MANXI to `maia_checkr`.

Drive SA = `maia-drive-writer@maia-platform-494322.iam.gserviceaccount.com`. Folder IDs: official `1kRDm6ajZr8lXuXGcAXTnA3vigzhLCZpz` · ongoing `1rX11uKdi5y0rAfaLPvRRlJ_aCactViuZ` · archive `11mMQghXeQfPuXEO4YnWgecqaTKuLKhs8`.

---

## 2026-08-05 — LEASING PLATFORM B1–B4 + Pet Registration + Pre-App intake (huge session, ~23 PRs)

**Shipped (all live on `main`):**
- **Leasing platform B1–B3:** B1 lease-packet field wiring (#575); B2 verified-signature layer — email+phone OTP (SMS/WhatsApp)+geo/device on the signed PDF (#584); B3 **shared e-sign engine** `esign_documents` + registry + verified-signing page (#585) → **Pet Registration** form (fill + vaccination uploads + verified e-sign, per-assoc pet_limit) (#586) + 30/7/expired pet-renewal alerts + PDF fix (#587). See [[lease_packet_esign]].
- **B4 Pre-Application Compliance intake — CORE COMPLETE:** slice 1 per-type doc checklist config `association_intake_documents` (MANXI seeded) (#588); slice 2 public `/pre-apply/[code]` flow (#589); unit-scoped email link + **Drive routing** (MAIA auto-creates `On Going Applications/Unit N - Applicant` subfolder, mirrors docs) (#590); slice 3a audit view + dual approval (#592); slice 3b **hybrid screening switch** (`associations.screening_provider`, MANXI=tenant_evaluation) + approval handoff + **tax-vs-W2 check** (#593). See [[pre_application_compliance]].
- **UX polish:** CINC balance colors (#577), board-cert "Why expired?" 7 langs + per-doc boxes (#578), Axela ledger flag (#579), onsite-manager board-cert uploads (#580), owner-compliance (#581)+tenant-verify (#583) per-doc boxes.
- **Fix:** Gmail sidebar "unauthorized" (Paola) root-caused to the 2026-07-12 session-secret rotation invalidating add-on tokens → dedicated `ADDON_TOKEN_SECRET` (#591). See [[gmail-addon]]. **ACTION: set `ADDON_TOKEN_SECRET` in Vercel + Paola re-mints at /admin/addon.**

**NEXT:** Board Decision Page e-sign (B4 nicety); to go full MAIA+Checkr for MANXI — Checkr production auth + real E2E test + intake→`public.applications` bridge, then flip the switch. [[board_onboarding_questionnaire]] (growing per-assoc config spec).

---

## 2026-08-05 (cont.) — balances CINC-style, board-cert "Why expired?" (7 langs) + per-doc boxes, Axela flag, onsite uploads, owner-compliance boxes

**MERGED (all deployed):**
- **#577 balances = CINC:** `lib/format-currency.ts` (`formatBalance`+`balanceColor`) — **positive BLUE, negative RED in parentheses**, zero gray. Applied to `/units` grid + drill-down tables + unit-detail Balance card. Collections shown by its own chip/badge, not by re-coloring the number.
- **#578 board-cert "Why is it expired?" (7 langs) + per-document upload boxes:** `lib/board-cert-rules-i18n.ts` (DBPR rules condo Ch.718 vs HOA Ch.720, all 7 portal langs, Hebrew RTL) + `components/BoardCertWhyExpired.tsx` (ⓘ modal w/ own lang switcher, picks kind). Wired: staff hub, board self-upload page, `/units` banner. Replaced the doc-type `<select>` with a **separate labeled upload box per document** (kind-aware). Self-upload API returns `kind`+summary+per-doc dates.
- **#579 Axela flag:** collections balances flagged "CINC may not match the Axela collections-agency ledger" (`COLLECTIONS_BALANCE_NOTE`). Banner + per-balance ⚠ tooltip + unit-detail caution + grid tooltip. Collections-scoped (only they have an Axela ledger). **User is pursuing an Axela API connection** — this is the interim caution.
- **#580 onsite-manager uploads on `/units`:** new units-auth'd routes `/api/units/board-certifications/{upload-url,submit}` (PENDING row, MAIA date read, approver email; gated by `resolveUnitsAuth`+`canUpload`). `/units` banner now shows per-document upload boxes when `canUpload`. Migration `20260805_board_cert_uploaded_via_units.sql` widened `uploaded_via` CHECK to add `'units'` (applied+verified). All 3 personas (staff hub / board self-link / onsite+board on units) can now upload.
- **#581 owner-compliance per-document boxes:** replaced the shared "dump all files" uploader on `/owner/compliance/[token]` with one labeled `DocUploadBox` per required doc; each sends its `item_key`(+declared insurance type) so MAIA files it against the exact item. Applicant `/apply` was already per-box. **Tenant-verify NOT yet converted** (offered).

**Karen Fisher (MANXI) — RESOLVED:** opened her uploaded PDF → it's a genuine **Board Member Certification Form** (signed 2024-06-11), NOT a CE cert. Correctly filed; she legitimately stays **CE overdue** until an actual continuing-ed certificate (dated ≤ last 12 mo) is filed. No change.

---

## 2026-08-05 — board-cert "CE overdue" label + Lease-Packet field wiring (B1). NEXT: verified-signature layer (B2)

**MERGED to `main` (deployed):**
- **#574 — board-cert "CE overdue" label:** on the Association Hub Board officers box, a member whose multi-year DBPR certificate is still valid but whose **annual continuing-ed has lapsed** was flagged `⚠ Expiring` (reads as "coming up soon"). Now relabels to **`⚠ CE overdue`** when the overdue CE (not the cert) is the trigger; a genuinely near-window cert still shows `Expiring`. `BoardCertSummary.continuingEdOverdue` added. Mirrors the `/units` block's "Cont. ed due" relabel (#572). **Karen Fisher (MANXI):** cert valid to 2031-09-19, CE was due 2025-09-19 → correctly overdue. ⚠️ She then uploaded a doc that landed as **Certification form (2024-06-11)**, NOT a continuing-ed cert — that does NOT clear CE-overdue. To clear it she needs a **Continuing-ed** doc dated ≥ last 12 months.
- **#575 — Lease-Packet field wiring (B1 done):** Property Address, Owner Mobile, Primary Tenant Mobile on the Landlord–Tenant Agreement PDF showed "—"; now snapshotted at send time — `owner_mobile`←`owners.phone`(fallback `phone_e164`), `tenant_mobile`←`unit_tenant_contacts.tenant_phone`, `property_address`←assoc `principal_address`+unit#+city/state/zip. Migration `20260805_lease_packet_contact_fields.sql` (applied to prod, idempotent, registered). Verified by rendering the real PDF. **Deferred still "—":** Emergency Contact + Board Approval Date. ⚠️ MANXI tenant phones mostly blank (approval-move filed them without phone) → tenant mobile "—" until the owner-outreach campaign fills them.

**NEXT (leasing platform, in order):** **B2 verified-signature layer** (email OTP always + phone OTP SMS/WhatsApp when a number's on file — now supplied by B1 — + geo/device; generalize e-sign into shared "association e-sign forms"; board asked for this), then **B3** Decision-Page + Pet-Registration forms, then **B4** Pre-Application Compliance intake. See the 2026-08-01 section below for full B2–B4 spec.

**Still owed (A — MANXI):** run **Reset-Official → re-File** on `/admin/documents/organize` (Official folder still mixed old+new; File's Drive copy is not idempotent). Then targeted owner email for the 53 leased units to capture tenant email/phone. Eyeball MANXI511/MANXI608 swap-guard flags.

---

## 2026-08-03/04 — MANXI signed-approval report + filing engine, lease alerts, board-cert fix; NEXT: Official reset run + owner tenant-contact email

**MERGED to `main` (all deployed):**
- **Lease-expiry alerts + on-site manager upload (#558):** daily cron `/api/cron/lease-renewal-alerts` (12:00 UTC) — exact-day **30d + 7d** before `unit_tenant_contacts.lease_end`: internal FYI (PMI+AR+building_managers+board) + resident reminder (owner+tenant). `/api/admin/building-managers` GET/POST(bulk paste)/PATCH + `OnsiteManagersBox` on `/admin/cinc-sync/[code]` (name/email/phone). Kaye Brunson / wilsonpealpm@gmail.com / 954-953-1236 was the first on-site mgr. Styled the file-input as an orange block (`::file-selector-button`).
- **Weekly expired-leases digest (#567):** cron `/api/cron/expired-leases-digest` (Mon 13:00 UTC) — units past `lease_end`, grouped by assoc, internal digest to PMI+AR+managers+board (NOT residents). Staff dry-run; `?send=1`.
- **Approvals report (#566, #568):** `/api/admin/documents/drive/approvals-report` on `/admin/documents/organize` → **125 signed · 76 current · 50 superseded.** No orderBy (Drive rejects orderBy+fullText). No-unit rows resolved from the PDF **address** ("from PDF" tag). Per-unit newest = **current** (filed), older = **superseded** (archived).
- **Reset-Official + approval-move engine (#569, #570):** Step 1 `reset-official` archives all Official subfolders → OLD `Pre-2026-cleanup <date>` (move, recoverable). Step 2 `approval-move` per current row → extract tenant/email/phone/dates (owner≠tenant swap-guard) → upsert `unit_tenant_contacts` + `unit_occupancy='leased'` → file `unit.approval_letter` (drive_url=source pdf, expiry=lease end or approval+1yr; purchase=null) → copy renamed into Official/MANXI###/Lease|Purchase Applications. Dry-run previews; batched 5/call.
- **Board-cert "still Missing" fix (#571):** certification FORM now counts as the initial cert (user decision); purple Leased chip.

**2026-08-05 morning polish (merged):** #572 — audit now reads `unit_tenant_contacts` (preferred over RentVine `association_tenants`) so the 53 filed leased units show tenant+lease-end; board-cert banner shows "Cont. ed due · <date>" when the flag is continuing-ed (not the far-off cert exp — Karen Fisher); purple Leased tile tag + legend; Leased/Vacant/Collections drill-downs now render a full table (Unit·Owner·Tenant·Lease end·Balance·Status·Missing). #573 — On-site managers box: inline-editable name/email/phone + Save + Remove (was add/deactivate only; phone wasn't shown). Full paste-ready remaining-work doc generated for the next session.

**STATE / NEXT SESSION:**
- **USER RAN dry-run + File (skipped reset).** 53 leased units filed + backfilled `unit_occupancy='leased'`. Official **NOT yet reset** → mixed old+new. **TODO: run Step 1 Archive Official→OLD, then File again** (reset FIRST — File's Drive copy is not idempotent; DB writes are). Swap-guard flagged MANXI511, MANXI608 — eyeball.
- **Tenant email/phone blank** (approval letters lack them). **NEXT (offered, not built): targeted owner email for the 53 leased units** → owner self-service (`/owner/compliance/[token]` leased section already captures tenant name/email/phone) — preview-first send. Tenant reached via `/api/admin/compliance/request-tenant`.
- Empty-folder cleanup already exists (`/admin/documents/organize` → 🧹 Empty subfolders).
- Older backlog below (verified-signature layer, Decision/Pet e-sign, Pre-App Compliance intake, lease-packet field wiring) still open.

---

## 2026-08-01 — 4 compliance enhancements, emergency-contact + CINC-account backfills, Lease-Packet e-signature; NEXT: verified-signature layer + more e-sign forms + Pre-Application Compliance intake

**MERGED to `main` (all deployed, verified):**
- **Four "do all in order" compliance enhancements:** (1) **swap guard** — ✦ Read + Save-tenant flag when an extracted "tenant" name matches the unit's CINC owner (`namesOverlap`, drive-organize `read`/`save-tenant`); (2) **#544** — Lauderhill Certificate of Use filed under its own `unit.lauderhill_cou` item + registered as a MANXI custom requirement; (3) **#545** — **Emergency Contact annual renewal**: `unit.emergency` now expiry-tracked; owner-compliance save stamps expiry +1yr; new **monthly cron** `/api/cron/emergency-contact-renewal` (1st @ 14:00 UTC) emails owners whose emergency contact is ≤45d/expired (paced via `owner_compliance_requests.last_sent_at`, gated by `OWNER_AUDIT_ENABLED`); (4) **#546** — **Approval Letter expiry = lease end** (`unit.approval_letter` expiry-tracked; filing pulls `unit_tenant_contacts.lease_end` via new `unitLeaseEnd()`; save-tenant keeps them in sync).
- **Data backfills (prod, one-off scripts):** defaulted **every unit's emergency contact to the owner** (name/phone/email from `owners`) so the field isn't blank + owners update later — **621 units / 26 assocs** (expiry 2027-08-01 → renewal cron staggers). Non-destructive, deduped co-owners. AND surgically **backfilled 73 owners' `account_number`** from CINC `PropertyHOID` (via `listAssociationProperties` PropertyID→HOID map — NOT the broad `applySync`); the 321 "missing account" owners were a sync gap, now 248 remain = intended (VPREC master HOA 246 + 2 with no CINC link).
- **#547 — Lease-Packet e-signature** (per-unit, all associations): owner + tenant e-sign the **Landlord–Tenant Agreement** in MAIA (typed name + drawn signature + timestamp/email/IP audit trail); both-signed → files `unit.landlord_tenant_agreement` with expiry = lease end; required-when-leased for MANXI. Plus a **Direct Rent Demand Notice (§718.116(11))** generator. Migration `20260801_lease_packets.sql` (applied): `lease_packets` table + `associations.legal_name`. Code: `lib/lease-packet-pdf.tsx` (react-pdf, both docs verbatim), `lib/lease-packet-token.ts` (HMAC packetId+role), `lib/lease-packet.ts`, `/api/lease-packet/[token]` (+ `/pdf`), `/lease-packet/[token]` public signing page, `/api/units/lease-packet/{send,rent-demand}`, button on `/units/unit`. Verified end-to-end. Full detail: memory `lease_packet_esign.md`.

**NEXT SESSION (2026-08-02) — design locked/OK'd across a long design conversation, NOT built. Build in this order:**
1. **Lease-Packet Agreement field wiring (START HERE — agreed, unblocked, small).** Wire the fields that show "—" today: **owner mobile** (CINC `owners.phone`, confirm via form), **tenant mobile** (`unit_tenant_contacts.tenant_phone`), **property address** (compose from association address + unit #, verify vs lease/approval later). Deferred: emergency contact (after owner form campaign), board approval date (from scanned/generated approval letter). Occupants+minors → captured by the Pre-App intake, not here. **This also supplies the phone number the 2FA phone factor (item 2) needs.**
2. **Verified-signature layer — generalize the e-sign engine into a shared "association e-sign forms" system, add multi-factor identity to the signed certificate.** Board specifically asked for this. On the signed PDF ("Electronic signature & verification certificate"): **email OTP** (always), **phone OTP via SMS text OR WhatsApp** (WhatsApp for intl applicants — reuses Twilio SMS + the already-approved WhatsApp OTP template), **geolocation + device** with browser consent (IP-city fallback). Reuses `lib/rate-limit.ts` + `app/api/auth/` OTP infra + the apply-form geolocation pattern (`components/SignatureEvidence`, `record-signature-evidence`). Rule: email OTP required always; phone OTP required when a number is on file (never block). Preview mockup rendered this session.
3. **Add two more forms to the e-sign engine** (`~/Downloads/Decision Page Notorized.pdf`, `~/Downloads/pet_registration_application_manors.pdf`): **Board Decision Page** acknowledgment — e-sign, **notary DROPPED (user chose "e-sign replaces notary")**; **Pet Registration** — fill (pets/vet/vaccination uploads) + e-sign + a **downloadable blank-PDF link** to the applicant, conditional on `unit.pet`.
4. **Pre-Application Compliance intake (the big one)** — memory `pre_application_compliance.md` + diagram artifact `2cff34de-f419-4c92-8701-ffcec937eb49`. One link for tenant/buyer/agent → self-ID (agent uploads listing agreement + creds, gets status link) → pick type (Lease/Purchase/Additional Occupant/Lease Renewal) → **per-type doc checklist** (reconciled against the real MANXI slides — see below) → **audit by PMI + Jonathan (before anything enters MAIA)** → **review & approve by on-site manager OR board (either; board also sees balance + ledger)** → populate MAIA → background check. **Build on existing `application_stakeholders` + Checkr — do NOT rebuild.** ⚠️ **"Tenant Evaluation" = the CURRENT screening system; "MAIA + Checkr" = the replacement we built** — don't conflate.
   - **Per-type doc lists** (reconciled vs Manors XI requirement slides — first draft was missing several): **Renter/Lease** = signed lease agreement, driver's license, car registration, landlord email, last 2 tax returns, vehicle insurance (new board request) + landlord: property insurance (owner HO not renters), certificate of use. **Buyer/Purchase** = signed purchase agreement, driver's license, car registration, last 2 tax returns. **Lease Renewal** (new term) = tenant: vehicle reg, vehicle insurance, ID + landlord: homeowner insurance, cert of use (if expired). **Additional Occupant** = ask current-lease vs new-lease → age → 18+ background check, under-18 name+age only.
   - **Rules = SHOWN & SIGNED, not enforced** (occupancy 1BR=3/2BR=4, buyer income $42k/$52k, no trusts/LLCs, 30-day advance, pet/vehicle rules; credit-score advance-maintenance = buyer info → **estoppel**). The ONE real validation: **MAIA checks the tax upload is a tax return, not a W-2.** Thresholds stored **per-association** (like `association_document_requirements`), not hard-coded.

**Open questions for tomorrow:** (a) build the two forms (item 3) standalone or fold into the Pre-App intake (item 4)? (Decision Page really lives inside it.) (b) Pet form — keep the 2-pet limit or allow more?

---

## 2026-07-29 — unit-audit expiry tracking, tenant Approval Letter, upload notifications; NEXT: Drive approval-letter bulk import

**MERGED to `main`:**
- **#517** — added **"Approval Letter"** to the leased-tenant document set (`lib/compliance-taxonomy.ts` `unit.approval_letter` + `getTenantComplianceState`).
- **#518** — **unit-audit expiry tracking**: `/units` now has **Expired** + **Expiring ≤30d** blocks; every block is **clickable** → drawer listing units with the expiring/expired docs + dates + a **Request update** button per owner and **Request from all N** (reuses `/api/units/owner-outreach`). Audit (`lib/association-audit.ts`) reads `compliance_records.expiry_date`, folds in the lease (via `lease_end_date`) and custom items (Lauderhill Certificate of Use). PLUS ingestion hardening: manager/board/staff uploads (`/api/units/documents/submit`) now run `normalizeUpload()` before MAIA reads them (PDF shrink + HEIC→JPEG + image resize) so expiry is actually captured; fixed a latent `status='expired'` CHECK-constraint bug in the review route. PLUS **approver notifications**: uploads to the units queue now email **PMI@ + ar@topfloridaproperties.com** (Jonathan/AR), configurable via `UNIT_UPLOAD_NOTIFY_EMAILS` (was: nobody was notified). Tenant self-service uploads still notify no one — user said route those to PMI+Jonathan too, NOT yet built.

**NEXT SESSION (planned, scope locked, NOT built) — Drive approval-letter bulk import.** Full detail + folder IDs in memory `drive_approval_letter_import.md`. Headline: bulk-import MANXI board approval letters + compliance docs from Google Drive into MAIA using the **existing** `/admin/documents/inbox` → "Import from Google Drive" tool (scan → classify → review queue). Scope: **Folder 2 (canonical `MANXI###`) + Folder 1 (recent)**, docs = **approvals + Certificate of Use + insurance + leases only** (skip PII). Two enhancements to build first: (1) the importer skips native **Google Docs** — many approval letters are Docs — so add export-Doc→PDF; (2) a doc-type whitelist filter to skip IDs/credit/criminal/tax. Then dry-run report → import → staff approve → feeds #518's expiry blocks. Prereq (user): share **Folder 1** with the Drive SA (Folder 2 already shared).

---

## 2026-07-27 — Manors XI unit-audit portal, owner self-service compliance page, CINC board position-sync

**MERGED to `main` (squash, main content-verified after each):**
- **#511–#513** — MANXI (Manors XI) **unit-audit portal**: floor-plan grid (10×15, floors descending), per-unit compliance/occupancy/balance+collections, manager document uploads → staff/board approval queue, "email owner to confirm/update records" with page preview, owner-email occupancy-first (owner-occupied / vacant / leased) + manager tenant uploads, zero balances shown blue, collections via `isAccountInCollections` (ORs collections-list AND Block-Payments toggle — MANXI's 27 in-collections units only caught by the toggle).
- **#514** — **owner self-service compliance page** (`/owner/compliance/<token>`): contact-info-on-file card (confirm / request-a-change, staff-reviewed, never auto-overwrites CINC owners record); emergency contact as **fields** not a file, one-tap "Use my unit manager" (from `unit_managers` scoped to the unit — NOT the building on-site manager, user emphasized the distinction); tenant section **multiple occupants** (+ Add); Ownership Verification explained with county Property Appraiser link (`lib/property-appraiser.ts`, defaults Broward). Migration `20260727_owner_compliance_enhancements.sql` (idempotent, registered, applied): `unit_tenant_contacts.occupants`, `owner_compliance_requests.{contact_confirmed_at,contact_change_request,emergency_contact}`.
- **#515** — **CINC board position-sync**: board members that drifted in position (e.g. Member At Large → Secretary in CINC) used to hide behind a green `✓ SYNCED` badge — the board diff never compared role, and Apply only inserted/deactivated. Now the diff compares role+email and emits an `UPDATE` row (amber badge, "Will change: role X → Y", pre-ticked) that Apply pushes into `association_board_members.role`. Guard: only pulls a value CINC actually has. No migration. Verified live: DELA's Sean Bari (#1206) surfaced as an actionable UPDATE.

**Pending your action:**
- **DELA — Sean Bari's position**: apply the pending `UPDATE` on `/admin/cinc-sync/DELA` → Board & Owners (or edit directly at `/admin/board-setup`). His CINC position is Secretary; MAIA still had Member At Large at session end (nothing was auto-applied).
- Owner-compliance page not yet exercised by a real owner end-to-end; the manager-uploads approval queue from #511-513 likewise wants one real round-trip.

## 2026-07-12/13 — blank-PDF root-cause fix, session-secret security fix, vendor-crew SMS redirect, Tropicana II (TROP) onboarding

**DEPLOYED (pushed + Vercel-verified READY):**
- **`c0c2c2d`** — root-caused blank invoice PDFs: `lib/pdf-normalize.ts`'s rasterizer never passed pdf.js its `standardFontDataUrl`, so any oversized born-digital PDF that hit the rasterize-fallback path drew every text glyph as nothing (logos/barcodes/gridlines still rendered — only text vanished). Worked fine locally (Mac system-font fallback masked it); broke silently on Vercel's font-less serverless runtime. Re-attached corrected PDFs to CINC for all 18 already-pushed invoices this had silently corrupted (found by scanning `invoice_intake_drafts` for stored PDFs over the 1MB threshold that would have hit the rasterize path). Drive copies for those 18 still need a manual "Re-mirror to Drive" click per invoice in `/admin/invoices` (local dev has no Google creds to do it via API).
- **`12a2c64`** — `app/admin/invoices/cinc/[invoiceId]/page.tsx` was showing `AttachmentInfo[0]` (CINC's *oldest* attachment) as the primary preview; `attachInvoicePdf()` only ever ADDS, never replaces, so a re-attach left the original stale doc as the default view. Now sorts by highest `ImageID` (no date field on that VM) and shows the most recent.
- **`10250f5`** — **security fix**: Vercel Production had **no `MAIA_SESSION_SECRET` set at all** — `lib/session.ts` was silently falling back to the hardcoded dev-default string baked into this **public** repo, meaning anyone could forge a valid session for any persona/association and skip OTP. Generated a real secret, set it in Vercel, redeployed. Side effect (expected, already happened): every previously-active session was invalidated — everyone re-verifies via OTP once.
- **`a723d48`** — recurring-service crew (`vendor_employees`) texting/WhatsApping in now get redirected to their upload-link form instead of free-text handling (SMS/WhatsApp has no reply→ticket correlation the way Gmail `threadId` gives email). A crew member covering >1 active job is asked once which job it's for (numbered menu, `conversation_state`-tracked); one active job skips straight to the link. Also wired up long-dormant `service_visits.links_sent_at`/`links_sent_results` columns (existed from an unapplied-in-code migration) so `/admin/recurring-services` shows persistent send status instead of a one-time `alert()`.

**Built and verified locally, NOT YET COMMITTED — ask before next session assumes it's live:**
- Flows diagram: new **Application Process** diagram (`/admin/flows/application-process`) covering `/apply` → Stripe → Checkr → board review → applicant notification, same click-to-popup pattern as the other two. Estimate & Board Approval / Vendor Onboarding diagrams reviewed for drift (one real drift item found + documented: #503's reply-to-threading change).
- Document-preview-not-download: `/admin/applications` and `/board/review` document links (signed Rules Ack, Gov ID, Proof of Income, Checkr report) now pop an inline image modal (`components/DocumentPreviewTrigger.tsx` + `/api/document-preview`) instead of forcing a download.
- **Tropicana II (TROP) onboarding** — new association, CINC-synced (owners/board/budget) but the core `associations` row was otherwise empty (type/service/statute/address/Sunbiz all null) with **no UI anywhere in the platform** to fill those in — `/api/admin/cinc-sync/onboard` deliberately leaves them null "for staff to fill in afterwards" but that "afterwards" screen never existed. Built:
  - "Association Details" card + edit modal on `/admin/cinc-sync/[code]` (new `PATCH /api/admin/associations/[code]`).
  - "Onboarding Checklist" card on the same page — live status + links for Board & Owners, governing docs, board-approval signatures (`/admin/board-setup` — **TROP's still unset**, this gates the `/apply` board-review threshold), application rules, custom doc requirements, recurring vendors, insurance.
  - **Root-caused why there's no "Create Public Site" button**: the 25 resident-portal pages (`/islandhouse`, `/onebay`, etc.) are each a 4-line wrapper around one shared `<AssociationPortal code="…">` component, routed through a **hardcoded** `ASSOCIATION_PORTAL_PATH` map — a brand-new association's code was never in it, so its portal 404'd with no automated way to add one (Next.js compiles routes at build time; no button click can create a live route without a deploy). Fixed at the root: `app/[slug]/page.tsx` now renders `<AssociationPortal>` directly for any active, unmapped association code — **every future new association's public site now works automatically the moment its `associations` row exists, no deploy needed.** TROP additionally got a real branded URL, `/tropicana2`, registered the normal way for consistency with the other 25. Verified live with a throwaway test association (fully data-driven, zero hardcoding).
  - (Dropped mid-build, don't resurrect without re-confirming: Sunbiz-document-upload auto-extraction for the address/filing fields — user caught that a Sunbiz printout's "Principal Address" is often the *registered agent's* address, not the real property, which is exactly what Checkr background checks and `/apply` lease-matching need. Manual entry only, by design.)

**Pending your action:**
- ✅ **RESOLVED 2026-07-13: Stripe is confirmed LIVE (production mode).** Next step is not a config check anymore — **run one real end-to-end test application** through `/apply` (real card, real Checkr order) to confirm the live-mode path works exactly like test-mode did.
- ✅ **RESOLVED 2026-07-13: no Drive re-mirror needed** — user confirmed the 18 invoices' Drive copies are already fine, nothing further to do there.
- TROP needs its real address / Sunbiz filing info / board-approval signature count entered (the UI now exists — `/admin/cinc-sync/TROP` → Edit details / `/admin/board-setup`).
- Decide if other associations besides TROP are missing the same core-identity fields (only TROP and the original 25 were checked this session).

---

## 2026-07-06/07 — Checkr background-check integration, DEPLOYED TO PRODUCTION

Full detail in `docs/ROADMAP.md`'s top section and memory `screening_provider_pivot.md`. Headline: the Checkr Tenant API integration (real host `tenant.checkr.com/api`, Bearer auth, single `POST /orders` call, webhook-driven status) is now genuinely live on **www.pmitop.com**, not just tested locally — pushed to `origin/main`, Checkr env vars added to Vercel Production (test-mode key, user explicitly OK'd for now), and verified against the real deployed site. A real applicant completed the actual Checkr-hosted consent flow end to end and it processed correctly.

**Shipped:** report-PDF capture (Checkr renders it, we fetch/store/link it); retired the never-real "international Checkr package" in favor of every applicant running the domestic Essential check + applicant-uploaded documents for the international-specific gap (CPA Financial Certification replacing an earlier two-document design, disclosed + a downloadable requirements PDF in all 7 `/apply` languages, Hebrew rendered RTL with a bundled font since react-pdf's default doesn't cover it); a "Test Environment" tab in `/admin/applications` letting staff run real test applications through the real Checkr sandbox without touching Stripe; board "Request More Info" (free text, doesn't lock the reviewer's token); a staff "Preview Board View" button; a real signed Rules & Regulations Acknowledgment PDF (actual signature image, audit trail) replacing a one-line text summary; and Gov ID/Proof of Income becoming per-applicant instead of one shared upload for a whole couple/commercial application, surfaced in a unified per-person panel alongside each person's own Checkr status.

**Real bugs found and fixed along the way (not just features):** webhook envelope had the wrong ID-extraction order (would have silently matched every real webhook to the wrong row); a resumed application draft never rehydrated previously-uploaded documents (silent data loss on resubmit); Vercel Production had zero Checkr env vars and the auto-triggered deploy needed a manual redeploy to actually bind new ones; multi-applicant apps had no way to see either person's Checkr report once complete.

**Pending your action:**
- ✅ **RESOLVED 2026-07-13: Stripe confirmed live** (see the 2026-07-12/13 section above) — remaining step is a real end-to-end test application, not a mode check.
- Decide the target Google Drive folder/organization for the final combined-PDF-package feature (documents + reports + signed rules ack + signed approval letter, one download) — the upload mechanism is already known (same pattern as `lib/drive-invoice-mirror.ts`), just needs a folder decision.
- Confirm whether the board's "approval letter" (currently just template text shown on the review page) should become a real signed PDF artifact too, for that same combined package.
- Still want a "Flows" diagram for the application process, matching the existing click-to-popup style — not started this session.
- Full Checkr production account authorization (test key works everywhere; going properly live needs their team's sign-off).

---

## 2026-06-06/07 — MAIA reliability hardening (incident response, all merged #291–#303)
A multi-day reliability incident, now fully resolved. maia@ is **LIVE**.

**Root cause of the outage:** an **auth mismatch** — Vercel `GMAIL_PUBSUB_SECRET` drifted from the Pub/Sub push endpoint's `?token=maia2026pmi`, so the webhook **401'd every push** → zero mail delivery for ~8h. Fixed by aligning the env secret to `maia2026pmi` + redeploy. (Staff inboxes are separate Google accounts/quotas; only maia@ was also hit by a Google rate-limit throttle that clears on the daily quota reset ~3 AM ET.)

**Shipped:**
- **#291** runaway-loop fix: cursor-advance **before** processing + `MAIA_WEBHOOK_DISABLED` kill switch. **#292** global Claude circuit breaker (`lib/anthropic-guard.ts`, `record_ai_call` cap 250/5min, env `MAIA_AI_DISABLED`). **#293** removed the 15-msg cap that dropped backlog.
- **#294** ack Gmail 429s (no 500→Pub/Sub redeliver storm) + deactivate staff accounts on `invalid_grant`. **#295** self-healing Gmail 429 cooldown (`gmail_cooldown_until` on `maia_watch_state` + `staff_gmail_accounts`). **#298** resilient selects (a not-yet-migrated column can't break the webhook).
- **#296** prompt caching on freeform (Sonnet) + chat (Haiku) system prompts.
- **#297** passive DB-derived health panel on `/admin/tools` Gmail section + **cooldown-aware Diagnose/Sync** (clicking them was prolonging the throttle).
- **#299** invoice dedup on **stable `attachment_filename`**, NOT Gmail's volatile `attachmentId` (the 88×-duplicate bug). Migration `20260607_invoice_dedup_by_filename.sql` (applied).
- **#300** invoice **Pushed → Archived** tab. **#301+#302** skip vendor **email-signature/logo images** (`lib/email-attachment-filter.ts`: logo-named OR <40KB OR inline-and-small; PDFs always kept) + `dedupeAttachments()` (same photo quoted N× → handled once), in invoice intake **and** work-order photo ingest.
- **#302** resync now processes **only messages not in `email_logs`** — stops re-creating deleted drafts + re-acking on resume. **#303** recognize **PMI Top Florida Properties as the vendor** on PMI-issued RVP/management-fee invoices.

**Cleaned up live:** invoice drafts 545→14, WO photos 7223→2 (+ swept ~7221 orphan storage objects).

**⚠️ Lessons:** (1) Gmail `attachmentId` is **volatile** — never a dedup key. (2) **Squash-merge strands** commits pushed *after* the merge (#301 follow-up stranded → re-applied in #302) — push ALL commits before merging. (3) Don't probe a throttled mailbox — each call resets Google's penalty.

**Owner-side follow-ups (not dev):** existing RVP drafts read under the old prompt need a manual vendor pick (or re-forward); set up **"PMI Top Florida Properties" as a CINC vendor** for the associations so RVP auto-matches; review/push the **14 pending invoices**.

---
## Shipped 2026-06-03 (merged to main)
- **PR #262 — invoice Tier-1 quick wins:** GL **auto-select** when confidence is high (CINC vendor-account mapping or ≥2 past invoices; single point stays manual "Use it"; never auto-confirms the audit pill); **auto-association** inferred from the vendor's unanimous confirmed history (Arrow-Asphalt case self-corrects after first manual set); **expense GL** surfaced in the Pushed banner.
- **PR #263 — Tier-2 financial correctness:** reconciliation **Upcoming Payments driven by `scheduled_pay_date`** (CINC rows badged with our planned date + new `MAIA · scheduled` stream for not-yet-pushed ready drafts, no double-count); **debt/escrow account guard** (shared `isDebtOrEscrowAccount()` so the "Pay from" dropdown and `deriveBankKind` can't drift — loan/mortgage/escrow no longer leak into the payable list); **funds-check tuning** (`FUNDS_CHECK_DEFAULTS` knobs, server-side `tight`, new `all` vs `due-by-scheduled` open-invoice toggle).

## Next up
- **Background check (decision 4):** verify Applycheck end-to-end (status callback/poll, board surfacing, re-invite); report the real gap.
- **Staff Daily News + improvement-ideas board** (new request — see ROADMAP §6b + memory `staff_daily_news.md`). Scoped, not built; has open decisions (unassigned-ticket handling, "late" definition, send time, newsletter-to-all vs per-person).

---
## Earlier — 2026-06-02

## How to resume (read this first)
- Production = tip of `origin/main`. Verify with the public GitHub deployments API (repo is **public** — no auth needed).
- All work this session is merged to `main`. Local `main` may be behind — `git checkout main && git pull` first.
- **Branch discipline (important):** always branch off **current** `origin/main`. Reusing a stale branch silently reverts others' merged work (hit this repeatedly — the "merge-race"). After a `gh pr merge`, re-fetch before the next branch.

## Shipped this session (all live)
- **AP invoice-audit screen** (`/admin/invoices`): inline per-field green-check pills (amber "Confirm" → green "Audited"), action bar under the PDF.
- **One review list**: folded `needs_vendor` **and** `duplicate_in_cinc` into **Pending review** (no separate tabs); the audit duplicate-guard hard-blocks marking a duplicate ready.
- **Vendor search by DBA** + server auto-match distinctive-token fallback (e.g. "Envera" → "Hidden Eyes LLC").
- **Recent payments + double-pay guard**: scans the real operating account, same-amount sweep (name-agnostic), prints what it checked.
- **GL suggested from the vendor's past invoices** (expense-side of the all-accounts ledger) + one-click **"Use it"**.
- **Funds check** to the scheduled pay date: current balance − all open invoices − this push + run-rate; 6-month horizon + "move to first affordable month". (CINC cash sign: deposits = **negative** `DebitAmount`, payments = **positive** `CreditAmount`.)
- **Pushed-invoice lock** (#259): PATCH route 409s any edit once `pushed_to_cinc`/has `cinc_invoice_id` — fixes the double-push desync. + Drive **retry** (3×) + **"Save to Drive now"** re-mirror button & `POST /intake/[id]/remirror`.
- **Control Panel auto-refresh** (60s while visible) so the dashboard isn't stale.
- **Email Karen** when a non-Karen staffer marks an invoice ready.
- **Gmail add-on**: dropdown-garbling fix, dynamic `@maia upload this invoice #CODE` copy line, blocked one-click forward removed (manual forward to maia@ works).

## Backlog / what's next (prioritized)
**High**
- **GL auto-select** (pre-fill the dropdown when confidence is high) instead of "Use it".
- **Auto-association detection** for invoices that arrive with no association (Arrow Asphalt had none — staff set VPREC manually). Improve `detectAssociationCode` or prompt.
- **One-click forward in the Gmail add-on**: blocked because the RESTRICTED scopes (`gmail.compose`) were admin-trusted but the per-user **re-consent was never completed**. Either finish re-consent or keep manual forward.

**Medium**
- **Funds-check tuning**: the "tight" threshold ($1,000), the run-rate window (3 mo), and a toggle for which open invoices count.
- **Drive link for manually-placed files**: the SA uses `drive.file` scope and can't see files it didn't create, so a manually-dropped PDF leaves `drive_file_id` null (no detail-page link). Consider a broader scope or a name-search adopt step.
- **Expense-side GL** enrichment on the **Pushed** invoices view.
- **Reconciliation "Upcoming Payments"** driven by `scheduled_pay_date`.

**Low / cleanup**
- Pre-existing `react-hooks/set-state-in-effect` lint errors (CashFlowForecast / VendorCombobox / FundsCheck) — don't block build.
- Prune stale local branches (all merged).

## Gotchas learned this session
- **Vercel queue stalls**: a stuck preview build blocks others. Cancel the stuck build, then push an empty commit to retrigger.
- **CINC GL ledger**: omit `accountNumber` on `glTransactionsByDateAndAssocCode` to get **all** accounts. An invoice's GL = the **non-cash debit** line whose description carries the invoice #.
- **`listAssociationBankAccounts`**: a debt-service account on a `10-` cash GL used to shadow the real Operating account — `deriveBankKind` now excludes debt/loan/escrow.
- **Local `.env.local`**: `GOOGLE_SERVICE_ACCOUNT_JSON` is **empty** (Drive creds are prod-only) → can't run Drive ops locally. CINC + Supabase service keys ARE present (handy for live data checks via REST/probe scripts).
- **Env var names**: Supabase URL is `SUPABASE_URL`; service key is `SUPABASE_SERVICE_KEY` (NOT `..._ROLE_KEY`).

## Recently reconciled data
- Draft 46 (Arrow Asphalt #35302, $402,112.94) was pushed to CINC (invoice **16263**) but had reverted to `pending_review` — manually reconciled back to `pushed_to_cinc`. Its `drive_file_id` is null (PDF was placed in Drive manually; SA can't see it).
