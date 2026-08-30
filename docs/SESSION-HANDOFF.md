# Session handoff — 2026-08-30

## Never let two people open separate applications for one unit, an accidental-data-loss recovery, and the "@maia upapp" forward shortcut fixed for residents

Direct continuation of the MANXI 802 incident (see 2026-08-28/29 below). Board forwarded a second real complaint — two people had applied for the same unit, and the previous fix hadn't addressed that yet.

### Duplicate-application prevention, `/api/pre-apply/start` (`8fe38db`, `7cfa397`)
User: "I still have 2 applications for unit 802 and also I see that 2 people applied for the same unit, we need to have a way to advise the second person that another application started... never let open 2 applications." The existing "resume instead of duplicate" check only caught the SAME email reopening the link — a genuinely different person (owner, second tenant, agent) still fell through to `createIntake()` and got a parallel application.

`findOpenUnitApplication()` now checks for an already-open lease/lease_renewal/purchase application on the unit before creating anything. First cut (`8fe38db`): a self-identified owner whose email matches a real `owners.emails` record auto-joins the existing application; anyone else is blocked and staff notified. User's next question drove the second round: **"is it possible to open the initial card so the person identifies what persona he is... and just joins automatically?"** — extended (`7cfa397`) so agent/tenant/co-applicant roles ALSO auto-join directly (they already self-identified their role on the existing persona card, no extra step needed); only an *unverified* owner claim stays gated, since that's the one role with a real database check and real financial/legal stakes if false. User then asked why the owner check couldn't also widen to a phone-based verification instead of just blocking — `isVerifiedOwner()` now matches on `owners.phone` too (digits-only comparison, matching the codebase's existing E.164 convention), not just email. Every auto-join sends a staff+lead FYI email so a genuine mix-up (two unrelated people both trying to apply) is still visible and reversible after the fact.

Verified end-to-end on a disposable test unit before pushing: agent and co-tenant both auto-joined the same application; an unverified owner claim still correctly blocked.

### MANXI 802 cleanup — and a self-caught data-loss mistake, transparently disclosed
Cleaned the real 4-way duplicate down to 1 application. **While merging the owner's 3 real documents onto the correct application, a raw `UPDATE application_documents SET application_id=...` without also updating `listing_id` left those rows pointing at a stale `listing_id`** — deleting that now-orphaned `unit_listings` row as part of shell cleanup cascade-deleted the 3 just-repointed documents. Caught immediately on a follow-up count check (11 not 14 documents). The underlying files were still safe in Supabase Storage (never deleted, only the DB rows referencing them were), confirmed via direct `storage.download()` on the exact paths (all 3 intact, real byte sizes) — re-filed correctly via `recordIntakeDoc()`, deliberately excluding `signed_lease` since the tenant's own legitimate upload was already correct there and re-inserting the owner's copy would have wrongly discarded it. Told the user directly, not glossed over.

MANXI 1002's separate, pre-existing duplicate pair (predating all of this) cleaned the same day — this time deliberately not touching any `application_documents` rows at all (lesson from 802), since the real application already had a complete, correctly-processed document set. Platform-wide scan afterward confirmed zero other units carry more than one open primary-occupancy application.

### Tenant checklist preview surfaced a real gap: "@maia upapp" never worked for the tenant it's shown to (`2a3a2eb`)
User asked to see the full tenant document checklist + a preview of the actual email tenants receive (built as an Artifact from the REAL `renderMaiaEmail()`/`getIntakeChecklist()` output, not a mockup — MANXI lease: 14 items; lease_renewal: 13). Reviewing the rendered email, user asked about its "forward this email instead" footer (`@maia upapp <ACCOUNT>`) — checking the code revealed the footer is shown to every tenant/owner, but the branch that actually files a forwarded email (`lib/maia-command-processor.ts`) required `isAllowedSender`, which only recognizes PMI's own staff domains. A tenant following that exact instruction from their own address never reached the code; their forward silently fell through to a generic AI reply.

New `isApplicationStakeholderEmail()` (`lib/application-comm-log.ts`) lets a non-staff sender through too, but only when their email matches a real stakeholder (owner/tenant/agent) on the SPECIFIC application the tag resolves to — a stranger guessing or reusing someone else's unit tag still gets nothing, no reply confirming an application exists. Compared in JS, not SQL `ilike` — `ilike` treats `_` as a wildcard and would have falsely matched `john_doe@x.com` against `john.doe@x.com`. Verified against real production data: a real stakeholder's email (as-stored and uppercased) resolves true; a random email and a nonexistent association/unit both resolve false.

Also sent a real rendered preview of the Landlord–Tenant Agreement PDF (`lib/lease-packet-pdf.tsx`, blank/unsigned review copy) when asked what that checklist item actually is.

### ⏳ NEXT
1. Still awaiting Checkr's reply on the credit-report/eviction-history gap (carried over, see 2026-08-28/29 below).
2. Older, unchanged: Checkr key prefix (test vs live) still unverified; Rentvine tenant-sync cron dead since 2026-06-17.

Memory: [[duplicate_application_prevention]], [[manxi_802_data_loss_recovery]], [[maia_upapp_stakeholder_fix]].

---

# Session handoff — 2026-08-28/29

## Application Guide polish, MANXI's international-applicant pipeline wired for real, and a default checklist template for 17 associations

Continuation of the 2026-08-25/26 MANXI Application Guide project. Started as small edits to the live Guide PDF, grew into wiring an existing-but-orphaned feature into the real approval pipeline, then into a broad "make this repeatable for every association" ask.

### Two small live-PDF fixes, verified by regenerating the actual PDF (`df9b09b`)
User caught two things reviewing the live Guide: `property_insurance`/lease needed relabeling to "HO6 Property Insurance" (a plain data fix — the guide's §3 table is built live from `association_intake_documents`, so no code change was needed), and the small red "(over 18yr.)" note that used to sit under the Occupant Affidavit row in an earlier Artifact mockup had never actually made it into the real generator. Added it for real, gated on `doc_key === 'occupant_affidavit'` (threaded a new `docKey` field onto `GuideChecklistRow` to make that possible) — confirmed via pdfjs text-coordinate extraction on the live PDF that it lands 12pt directly under the row, not near the section header (a user report that turned out to be a stale cached download, not a real bug).

### Required Documents panel no longer guesses (`a283b37`)
User: the panel used to silently pick an association (first one with an open application, or MANXI) the instant it was opened. Now "Required documents for [choose an association]" — nothing loads until staff pick one — and the list now covers every active association via `/api/associations`, not just ones with a currently-open application, so it's usable while setting one up before its first application exists.

### International-applicant package — existed, was orphaned, now actually wired in (`feafa79`, `96ce1b2`, `e308c16`, `d42cd2c`)
The CPA Financial Certification / foreign police clearance / notarized translation package was built back during the 2026-07-06/07 Checkr integration (the international-applicant gap Checkr itself doesn't cover) — but it only ever lived in the OLDER standalone `/apply` self-serve form's "international" appType, never reflected in the checklist or rules that actually drive real MANXI purchase approvals through the newer staff-driven pre-apply pipeline. User: "Let's add to Manors the international applicant package we developed."

Built a real purchase-only intake question — "Are you a U.S. taxpayer with at least 2 years of U.S. tax returns?" — by extending the EXISTING vehicle/pet/assistance_animal `condition_key` declaration pattern rather than inventing a second mechanism: `Declarations.taxReturns` on `listing_applications`, `activeConditions()`/`pendingDeclarations()`/`declaredNaKeys()` in `lib/intake-documents.ts` + `lib/animal-accommodation.ts` all extended to handle a new `international` condition. Asked on both the self-serve applicant intake (`app/pre-apply/[code]`) and staff's "Open an application" form. Answering "No" surfaces 3 new checklist rows (migration `20260828_manxi_international_applicant_docs.sql`, widened the `chk_intake_condition` check constraint) and a new rule: one year of maintenance in advance instead of the credit-score bands, since no U.S. credit score exists to check.

**Iterated on user feedback across 3 rounds, each verified with a real preview before moving on:**
1. First cut folded the new rule into "For purchases" and interleaved the 3 checklist items into the main table by sort_order. User: pull both out into their own dedicated sections. `GuideRuleGroup`/`MANXI_RULE_GROUPS` gained an `international` key (own §1 group, after all/lease/purchase); checklist rows with `condition_key='international'` now split into their own `internationalChecklist` array at data-assembly time and render as a separate callout box in §3, with each item's note visible (added `note` to `GuideChecklistRow`, previously dropped).
2. Sent a live preview of the actual declaration-card UI (an Artifact reproducing the real component's exact copy/colors, not a fresh mockup). User: show the full card with ALL pending questions together (vehicle/tax/animal), not the tax one in isolation; reword the question to "Are you a U.S. taxpayer with at least 2 years of U.S. tax returns?"; the CPA Financial Certification checklist card needs an actual link to the CPA requirements guide it references. All three fixed — the guide link points to the existing `/api/apply/intl-cpa-guide?lang=`, localized to the applicant's language.
3. User: the income-minimum rule line needs to state international applicants are held to the same figure, and the CPA guide itself needs to require an EXPLICIT meets/does-not-meet statement, not just the existing vague "appears financially capable" line. MANXI's `min_annual_income` rule label updated directly (data fix); a new bullet added to `lib/intl-applicant-docs-content.ts`'s `cpaBullets` in **all 7 languages** (en/es/pt/fr/ht/he/ru) — deliberately worded to reference "the Association's Application Guide" rather than hardcoding MANXI's own $42k/$52k figures, since that content module is shared across every association's international applicants, not MANXI-specific.

Every round verified against a freshly regenerated live PDF (not just read code) before calling it done — `curl`'d straight from `localhost:3000` during dev, confirmed the exact text and its position, only then committed/pushed/confirmed 0 runtime errors on Vercel.

### Default intake checklist template, seeded across 17 associations (`3e1db7e`)
User: "Create to all default template like MANXI's existing ~20-row checklist minus the MANXI-specific stuff... we will have them all created in the other associations as default so it will be easy to setup new associations." Built the template from MANXI's real checklist minus the notarized-affidavit items, the Lauderhill-specific certificate, and the just-added international-only rows — 35 rows (Optional by default; Rules Knowledge Acknowledgment required, per the same day's earlier standing policy: "all associations besides the master require rules ack + contact info, everything else optional") across `lease`/`lease_renewal`/`purchase`/`additional_occupant`.

**Scope decisions made and reported, not silently guessed**: seeded to every active association EXCEPT MANXI (the source), VPCI (already has its own real ~11-doc_key checklist from its 2026-08-14 onboarding — layering a generic template on top would collide), the 2 master associations LCLUB/VPREC (the user's own "besides the master" carve-out), and the 5 commercial condos (residential paperwork — driver's license, individual-buyer tax returns — doesn't fit a commercial unit; same line the 2026-08-16 property-insurance seed already drew). 17 associations, 595 rows total, verified by row count after applying.

**Real gap flagged, not glossed over**: the Rules Acknowledgment checklist row is now required for these 17 associations, but the actual e-signed rules CONTENT per association (the text applicants sign — `lib/manxi-rules-ack.ts`/`lib/vpci-rules-ack.ts` are the only two that exist) hasn't been authored yet. The checklist item shows up; there's nothing to send until real governing-rules documents are provided per association. Separate follow-up, needs the user to supply source documents the way MANXI's and VPCI's were originally supplied.

### Checkr re-verified end to end, and a real gap found + reported to Checkr
User: "I want to use again the test environment before integrating." No staff session available locally, so re-ran the Test Environment's actual underlying path (`screening.createOrder()` → `screening_subjects` → report storage) directly against the real sandbox rather than clicking through `/admin/applications`. Both scenarios still work exactly as documented: **auto** completes in seconds with a real stored report PDF; **Hudson Green** goes `waiting_for_applicant`, emails a real hosted-consent link, and completes on its own after the sandbox processes it (~1-2 min later, confirmed by re-polling).

**Real finding, not a MAIA bug**: pulled the structured report object (`GET /reports/{id}`, not just the PDF) and confirmed `credit_report` and `eviction_history` both come back `null` on the `essential` package — only criminal history, sex offender registry, and global watchlist run. This contradicts what Checkr's own pricing conversation described Essential as including. Emailed `hello-tenant@checkr.com` with the exact order/report IDs and the full null/populated breakdown, asking them to confirm whether the account's package is misconfigured or this is expected sandbox behavior. **Awaiting their reply** — this needs resolving before any association gets flipped to `maia_checkr` (on top of the already-known unconfirmed test-vs-live key mode).

Also confirmed while investigating: `docs.checkr.com` is Checkr's **general employment** API, a different product from the **Tenant Screening** API (`checkr-tenant-api-docs.redocly.app`) this integration actually uses — same wrong-product confusion the original 2026-07-05 build hit once already. Flagged directly rather than acting on anything from the wrong docs set.

### Real incident: MANXI 802, self-serve intake let an applicant "satisfy" staff- and e-signed items with random uploads (`1b15202`, `e82403b`, `f6eb236`)
Board forwarded a tenant complaint ("the app won't work, I've already uploaded everything") with screenshots. Investigation found two separate things:

**Not a bug**: her real application was complete and already submitted — she'd also accidentally started a second application under a typo'd email (`.hotmail.com` instead of `.gmail.com`) that got stuck after hitting the OTP resend rate limit. Replied to her (board CC'd) with an exact timeline pulled from real logs.

**A real, platform-wide bug**, found reviewing her actual uploaded files: the self-serve checklist's "other documents — upload if you have them" convenience section rendered `background_credit` (Background/Credit Reports, `provided_by: 'staff'` — the ONLY staff-only doc_key platform-wide, confirmed by querying every association) as an ordinary upload box, and she uploaded what looks like a different person's background-check screenshot into it. The same page also let her "satisfy" the Rules Knowledge Acknowledgment, Emergency Contact List, and Military Service Member Disclosure — all real e-signed forms (`lib/application-esign-forms.ts`'s `ESIGN_CHECKLIST_ITEMS` registry) — by uploading unrelated files (an insurance PDF, a random phone-contact screenshot), because only Rules Ack had a dedicated in-page signing block; the other three fell back to the same generic upload control as everything else.

Fixed in three commits, the last two done by a peer session working the same incident from the background-task chip, cross-verified before merging:
1. `1b15202` — `GET /api/pre-apply/[token]` now excludes `provided_by='staff'` items and `governing_docs_ack` from the checklist entirely; `record-doc` rejects both server-side too (defense in depth against a stale page or a direct call).
2. `e82403b` — new `getOrCreateEsignLink()` (`lib/application-esign-forms.ts`) mints (or reuses, idempotently — no duplicate emails on page refresh) a real signing link for Emergency Contact List and Military Service Member Disclosure, rendered as a distinct "Sign now →" card instead of an upload box. Needed `esign_documents.application_id` to actually be set on insert (the column existed for a different purpose and was silently never populated) to make the reuse lookup precise.
3. `f6eb236` — same widening applied to `pet_registration` and `maintenance_assessment_ack`, the other two registry entries with the identical latent gap, explicitly flagged as not-yet-fixed in `e82403b`'s own commit message. Verified against a disposable TROP purchase test application (pets allowed there, unlike MANXI) — all 5 e-signed doc_keys correctly 403 on raw upload, `drivers_license` correctly still succeeds as a control.

⚠️ **Two sessions worked this in parallel** (this one + a peer session that had started the earlier-spawned background-task chip) — cross-checked each other's diffs and cleanup SQL before either committed; no conflicts, but worth knowing this pattern is possible when a chip gets started separately from where it was suggested.

### ⏳ NEXT
1. **Author rules-ack content for the 17 newly-templated associations** — needs real governing-documents/rules text per association from the user before the required checklist item can actually be fulfilled.
2. **Awaiting Checkr's reply** on the credit-report/eviction-history gap on the `essential` package before flipping any association to `maia_checkr`.
3. Staff-side "Required documents" panel and the association setup UI already support toggling any of the new template rows on/off per association (`IntakeChecklistBox` at `/admin/cinc-sync/[code]`) — no new UI needed, just needs actual use.
4. Older, unchanged: Checkr key prefix (test vs live) still unverified; Rentvine tenant-sync cron dead since 2026-06-17.

Memory: [[manxi_application_guide_project]], [[manxi_application_guide_live_feature]], [[screening_provider_pivot]].

---

# Session handoff — 2026-08-27

## Lease-packet date bug fix, Lease Renewal Check-In feature, and two real pre-apply UX bugs

### Lease-packet term bug — MANXI 706, Quentin Jamal Smith (`dca02c7`)
Real complaint: a tenant about to e-sign the Landlord-Tenant Agreement saw the PREVIOUS tenant's 2024-2025 lease term instead of his own real 2026-08-21–2027-08-20 term (verified against the actual signed lease PDF, page 1 — ruled out a model misread before looking further). Root cause: `sendLeasePacket()` only ever sourced dates from `unit_tenant_contacts`, which is scoped to the UNIT and only refreshes on approval — so it still carried the prior tenancy's dates while a new application was in flight. `lib/lease-extract.ts` already read the correct term at intake (`backfillPrimaryContactFromLease`), the dates were just discarded, never saved. New `listing_applications.lease_start/lease_end` columns give the current application its own place to hold its term; `sendLeasePacket`'s `tenantOverride` now prefers them. Live packet + application corrected directly (verified unsigned first).

### Lease Renewal Check-In — new feature (`22f38c7` → `65ea9e4`)
User showed screenshots of the "Lease expiring in N days" reminder emails and asked what happens after they're sent — answer was "nothing, just a mailto link." Built a real call to action: token-gated `/lease-renewal/[token]` page (tenant: renew/vacate/vacated/already-signed/start-renewal-application; owner: occupancy toggle + renew/already-signed), backed by a new `lease_renewal_checks` table (one row per unit+lease_end, stable across both the 30-day and 7-day reminder windows) and `lib/lease-renewal-check.ts`. Each answer triggers the matching side effect — idempotent application-opening + full document-request push, a real signed-lease upload link, or occupancy update + owner/staff/board notify. Both standing crons (`lease-renewal-alerts`, `expired-leases-digest`) now link to it and stop nagging a party once they've answered. `hasOpenApplication()` — a permanent new rule — skips a unit already carrying any non-terminal application. Detail: [[lease_renewal_checkin]] memory.

### MANXI catch-up send — real incident + two live corrections
User asked to resend the check-in link to all MANXI units with expiring/expired leases, excluding board from internal recipients and skipping units with open applications. First live run hit MAIA's existing anti-runaway rate limiter (`lib/outbound-rate-limit.ts`) almost immediately — only 21 of ~68 attempted emails actually delivered, but the response reported full intended counts as if everything went out (`sendEmail` returns `{messageId:'blocked-by-...'}` rather than throwing, wasn't being checked). Made the endpoint resumable (checks `outbound_send_attempts` before each send). **Separately caught mid-run**: the catch-up's deliberate bypass of the standing 30/7-day exact-date match meant units 60-337 days out also got sent the "Lease expiring" reminder — 2 owners (Unit 402, Unit 304) already got one before this was caught; sent a correction email to both, scoped the remainder to expired + ≤30-days-out. Temp endpoint removed once done. Detail: [[bulk_email_rate_limit_discipline]] memory.

### Two real `/admin/pre-apply` bugs, both live
- **MANXI 115 duplicate applicant** ("Natasha Hall" + "Natasha Halll", one with no email, one with a typo'd name + real email) — root cause: `autoRosterFromLease`'s roster-add and the owner/tenant-facing roster form's own insert both write applicant rows independently, deduping only by exact email or exact name match; a typo defeated both. Fixed the live duplicate directly (merged into one correct row). Separately: the top "✎ edit" button (next to "Type: Lease renewal") only ever edited the lead applicant's name + type — the real roster editor is a different, separate, collapsed-by-default "Applicants" card further down. User asked for one click to reach both; the top button now also expands and opens that card into edit mode (`7ac2af5`).
- **Lease auto-read at application creation** (`938edb3` → `f5ee5d4`) — user wanted to type just association+unit, attach the lease, and have MAIA pull the tenant roster + lease term off the document instead of retyping it. New `extract-lease`/`extract-lease-url` routes run the existing `lib/lease-extract.ts` reader before any application exists. First version pushed the raw file through the Vercel function body and hit the SAME "Request Entity Too Large" non-JSON-response bug already fixed once for real uploads (MANXI 303) — fixed the same way, signed Storage URL first. Detail: [[signed_url_upload_gotcha]] memory.

### ⏳ NEXT
1. Nothing outstanding from this session — all shipped work verified deployed with 0 runtime errors.
2. Older, unchanged: Checkr key prefix still unverified; Rentvine tenant-sync cron dead since 2026-06-17.

Memory: [[lease_renewal_checkin]], [[bulk_email_rate_limit_discipline]], [[signed_url_upload_gotcha]].

---

# Session handoff — 2026-08-22

## A stream of real-usage bug reports from live staff testing (2026-08-20 evening → 2026-08-22), 16 commits

No single feature this round — PMI actively used the automatic pipeline (shipped 2026-08-20) on real applications and reported problems as they hit them. Pattern worth naming: almost every bug here is the same shape — **a cached/derived value drifted from the live source of truth**, or **a checklist item asked for something that could never actually be supplied**. Fix each at the shared-function level, not the caller, since most of these functions have 2-3 callers (Gmail add-on, admin screen, widget, emails) that must not be able to disagree.

### Checklist cleanup — "Board Approval Letter" retired/relabeled per type (`666b526`, `a9e5812`, `1cacb6b`)
Real reports on MANXI 110 (Susie Bell renewal) and MANXI 912 (Querline Pinckney's first lease): MAIA was asking owners for a "Board Approval Letter" that could never be genuinely supplied. Checked actual usage history before touching each: every `board_approval_letter` document ever filed on `lease`/`purchase` was `uploaded_by_role: 'drive-scan'` or `'esign'` — MAIA's own scan of the application's OWN signed decision letter after the fact, never a real owner response. **Retired** (soft `active=false`) for `lease`, `purchase`, `additional_occupant`. **Relabeled**, not retired, for `lease_renewal` → "Copy of Last Year's Approval Letter" — a prior year's letter is a real, sometimes-available document there.

### Same evening, more retirements and fixes from MANXI 912 (`845c443`, `385cf76`)
- `landlord_email` — required item asking for an email address as if it were an uploadable document. Retired; MAIA already has the real owner email in `owners` whenever one exists.
- `isMissing()` on the staff review screen only checked "does a document row exist" — a **refused** document still has one, so it never got pre-ticked for re-request and its refusal reason never reached the owner. Now treats refused as outstanding too, with its own badge.
- Gmail add-on's Application card matched only by thread or by an `application_stakeholders` email — an owner known only via the `owners` table (not yet an explicit stakeholder on this application) matched nothing. Added an owners-table fallback.
- New "Send Tenant Evaluation guide" button — applicants had no self-serve way to start their own background check.

### Daily "Applications to review" digest (`ec8dbb3`)
User direction: "I need to receive daily the list of applications that I need to review... with a direct link." `lib/application-review-digest.ts` reuses `getApplicationDashboard()` (not a re-derivation) for two sections — `not_sent` (documents on file, nobody's decided them yet — the one recurring task the automatic pipeline never removed) and `refused`. 7am ET, every day. `APPLICATIONS_REVIEW_RECIPIENTS`.

### Two more "cached snapshot disagreed with live state" bugs (`ada5202`, `43f6b2d`)
- The reminder-approval page (`/reminder-approval/[token]`) still listed a checklist item **hours after it was retired**, because GET read a JSON blob written once at draft time and never refreshed, while POST already recomputed live. GET now calls `getOutstandingSummary()` live too.
- **The bigger one**: "why is [MANXI] 901 in 'Documents approved — creating letter' right after I just requested more documents?" The Applications LIST page had its own independent status→label mapping and never used `decideStage()` — the same live computation the staff/board/on-site dashboards already share. Found 2 real mismatches (801: 0/16 docs ever decided; 901: 3/7 decided, 4 waiting) both stuck via the old, since-retired "Mark audited" button clicked back on Aug 11/12, before the completeness gate existed. Data fixed (`20260821_fix_stale_under_review_status.sql`), and the list page now calls `getApplicationDashboard()` like everything else — can't drift again. Bonus: `refused` is now its own visible stage, which the old status-only view had no way to show.

### Landlord-Tenant Agreement — was asked as an upload, corrected twice (`e8dbac9` → `7d57e44`)
First pass found the real bug — the applicant-facing card showed an "Upload" button for a document that was actually MAIA's own e-signed packet (`lib/lease-packet.ts`), never fulfillable by upload, confirmed via 3 real prior requests that never got satisfied — and fixed it by routing to `sendLeasePacket()`. **First fix removed the item from the missing-list entirely once wired to e-sign; user redirected: "I want the card to have all is missing and a button to push the e-signed form if needed, not remove completely."** Rebuilt as a status-aware `esign_packet` item kind that stays visible until actually signed, with its own "Send to sign" button the owner/tenant can trigger themselves (`findUnitLeasePacket()`, new public route `/api/request/[token]/lease-packet`).

### "@maia upapp <ACCOUNT>" forward-to-file hint, rolled out to 3 places (`ec152f6`, `a0addf3`, `d186672`)
Staff already had this shortcut on the admin screen. User asked for it everywhere a resident might act: the public `/request/[token]` card footer, the actual text of every resident-facing email (`renderMaiaEmail()` in `lib/maia-email.ts` — one shared change, not one per email type), and the MAIA chat widget itself (pinned bar, driven by a `maia:upapp-hint` window event the admin page dispatches since the widget has no application context on `/admin/pre-apply/[id]`).

### "+ Add another page" (`6a32b90`)
Real cases: a tenant note ("I have more paper to upload"), and MANXI 303's Wilner Florestan emailing 9 separate page scans to `support@` because the upload button only ever replaced. The backend's append path already existed (gated per-`doc_key` for genuinely separate files like 2 years of tax returns) but was never exposed to the UI independent of that config. New explicit `append` flag works on any item. Required warning text per user direction: pages must be from the same document or the file gets rejected and the application risks denial/delay.

### MAIA widget: "Create a link" for staff (`20a3d1c`) → surfaced a real drafting bug (`a61005c`)
User direction: saying a short "MANXI 303"-style message in the widget (staff persona only, length-gated so a real question can't misfire) now shows a **Create a link** button that calls the same `draftStandardReply()` the Gmail add-on already uses. Building this **surfaced a real bug**, live on MANXI 303 (Wilner Florestan, purchase): his agent-provided Condo Rider was refused, but `draftStandardReply()` told **him** "nothing outstanding" — agent items were excluded from what he's asked to DO (correct) but that also excluded them from what he's TOLD (wrong). Fixed at the shared-function level: agent items now get their own draft paragraph with the refusal reason, `refusedReason` added to `OutstandingRow`.

### Board-review page overhaul — AI Pre-Audited, Send Back / Approve (`68c72fe`)
User pushed the first complete purchase application to the board and gave detailed feedback on the resulting email + page. **Important context surfaced before building**: this is the OLD manual "document review round" (superseded for the automatic pipeline, but intentionally left live as a staff escape hatch) — the user confirmed "apply all my feedback to this page anyway."
- Email/page previously labeled staff/on-site pre-checks as "Approved" — now "AI Pre-Audited by Maia" until an actual board member decides; buttons stay neutral white until then, verified against MANXI 303's real 8-row round (all currently `decision.role: 'staff'`).
- Email CTA "Upload your documents →" → "Check files and give the final approval →" (wrong audience for a board reader).
- New overall **Send Back** / **Approve** buttons (`/api/board-review/[token]/finalize`) — Send Back opens a note, emails the office with the note + current refusals; Approve checks for an existing signed-letter-in-flight first (MANXI 303 already had one, auto-sent 2:21am) so it reports "already sent" instead of duplicating.

### Two more real bugs, reported together (`11a00aa`, `b90d2f6`)
Unit 613: staff approved Car Registration in the main checklist, but the "Request the missing documents" panel below still showed it ticked/"missing". Root cause: that panel's checkbox `state` seeds from the checklist **once on mount** via a lazy `useState` initializer, and the panel stays mounted (just hidden) across the page's live reloads — so it never re-synced. Fixed with a `useEffect` that follows any row the user hasn't manually touched. Same report also caught `/api/request/[token]/upload` (the owner/tenant "request a specific document" link) never calling `quickDocScan` at all, unlike every other upload path — wired in.

Then: "I added the expiration manually and I did push the button to scan and it didn't work before adding manually." **Downloaded the actual stored photo and ran it directly through the scan** — a Florida vehicle registration clearly reading "Expires Midnight Mon 3/8/2027." Haiku, even after a prompt fix and at temperature 0, deterministically misclassified it as "certificate of use" and invented a date not printed anywhere (3/3 identical wrong runs). Sonnet, same prompt, same image, got the correct label and date (2027-03-08) 3/3. Switched `quickDocScanDetailed` from Haiku to Sonnet — accuracy matters more than one extra Sonnet call per document. Also tightened `SCAN_PROMPT` (explicit vehicle-registration-vs-certificate-of-use disambiguation, explicit MONTH/DAY/YEAR guidance — the staff member who hand-entered the date made the identical 3/8→Aug 3 mistake the model did). `quickDocKind` (Drive-folder name matching, lower stakes) left on Haiku. Corrected unit 613's `expiration_date` in prod from the wrong 2027-08-03 to 2027-03-08.

### Not in git — infra/data fixes made directly
- **Supabase Storage `application-docs` bucket** was missing `image/heic`/`image/webp` from its MIME allowlist despite app code (`ALLOWED` regex) claiming support — root cause of a real MANXI 613 tenant upload failure ("The string did not match the expected pattern") trying to upload a HEIC car-registration photo. Fixed via `updateBucket`; verified live; test artifacts cleaned up.
- **Susie Bell / MANXI 110** lease renewal actually created for real (was blocked until `#731` landed) — confirmed the lease-extraction fallback worked; owner Monica Blumenfeld was emailed.

### ⏳ NEXT
1. **Spot-check more real car-registration documents across the portfolio**, not just unit 613 — Haiku's misread was systematic (wrong on 6/6 runs across two image variants before the Sonnet switch), so other units scanned before this fix may be carrying wrong or blank expirations. There is no error-vs-empty distinction stored on the document row itself, only what `quickDocScanDetailed` returns live today.
2. **`gmail-addon/Code.gs` still not deployed** (carried over — see 2026-08-18 entry below). Unrelated to this round's work but still owed.
3. Watch the first REAL board-review "Send Back" / "Approve" click on the old manual round — `finalize` route is verified against production data read-only, not yet click-tested end-to-end by a real board member.
4. Older, unchanged: Checkr key prefix still unverified; Rentvine tenant-sync cron dead since 2026-06-17.

Memory: [[application_pipeline_automation]], [[board_email_cc_preference]].

---

# Session handoff — 2026-08-20

## Applications pipeline made FULLY AUTOMATIC end-to-end (8 PRs, #723–#730, all merged) + two live bugs fixed (#731, #732)

User's final instruction after a 5-rule design conversation held one-at-a-time over several turns: **"Move forward, I want all Fully automatic."** Status flow is now `started → submitted → under_review → approval_sent (NEW) → approved | declined`, and every arrow past the first now fires on real state, not a staff click.

### The finding that shaped the whole design
`application_document_reviews` is a **single shared population** — staff and board decisions write the SAME row (unique on `application_id, scope_key`). `getReviewState().complete` has no idea who decided. So once staff finish approving every document, having the board separately "review" the identical set again would be redundant — **the board's real decision point is signing the approval letter**, not a second document pass. This is why PR6 skips straight from "documents complete" to "letter created and sent," with no intermediate board document-review step in the automatic path (the old manual per-document round stays as a staff escape hatch only).

### PR1 — retire "Bring into MAIA", harden staff creation
Confirmed root cause of empty-shell applications (MANXI 605 and its kind): the "Bring into MAIA" button hardcoded `assoc='MANXI'`, created zero `application_stakeholders` rows, and set `status:'submitted'` directly, bypassing `createIntake()` entirely. **Deleted.** Staff's "+ New application" form now requires the lead applicant's email+phone AND the type's required document upload (signed lease / purchase agreement — additional-occupant checks the unit's current lease for the occupant's name first, falling back to a Lease Addendum only if not found). Also fixed, found while touching the same code: `board-approve`'s `KEEPER_DOC_KEYS` never included `signed_purchase` (only the older, unrelated `purchase_agreement` key) — a purchase application's own signed agreement was silently dropped from the Official folder on approval.

### PR2 — owner gets a real link
`notifyUnitOwnerOfNewApplication` used to be FYI-only, no link at all. Now mints a real owner-role `application_stakeholders` token (reusing the exact collaborator-invite machinery multi-collaboration already has) so the owner can add their own agent or fill their part — same `canAddCollaborators` gate extended from lead-only to lead-or-owner.

### PR3 — 3-day missing-docs reminder to ALL stakeholders
New `application_reminder_approvals` table (migration applied) + `lib/application-reminder.ts` + `app/api/cron/missing-docs-reminders`. First cycle drafts and emails PMI+Jonathan an approve link (`/reminder-approval/[token]`) instead of sending anything; **once approved, every later cycle auto-sends with no re-asking** ("approve once" — explicit user direction). Stops once nothing's missing (re-checked every cycle). Extracted `lib/application-outstanding-summary.ts` out of `lib/application-standard-reply.ts` so the single-recipient draft and this collective reminder share one "what's missing" computation.

### PR4 — `submitted → under_review`, automatic
Centralized in `lib/board-review.ts`'s `syncBoardWindow` (not duplicated in its two callers — staff `review-decision` route and the board's own decision route both already call it) — the instant `state.complete` becomes true, status flips, scoped to currently-`submitted` only so a later re-completion (e.g. a correction after decline) never moves an already-decided application backward.

### PR5 — introduce `approval_sent` everywhere, INERT
Deliberately zero-behavior-change PR before PR6's real wiring — added the new status to every `.in('status', [...])` allow-list across the codebase. **Must-fix caught here, not optional**: `lib/esign.ts`'s two status-filtered application lookups would have silently stopped finding an application the instant it could sit in `approval_sent` between letter-creation and full signature — fixed in the same PR the new status was introduced, before anything could produce it.

### PR6 — `under_review → approval_sent`, automatic — first real external blast radius
New `lib/board-decision-letter.ts` — the single place letter-creation + signer-invitation-sending now lives; the EXISTING manual "Create & send" button now calls into this same lib too, so a staff-created letter and an auto-created one can never diverge. **Per explicit user direction given at this point in the session**: every email MAIA sends to the board (review round, signature reminder, signer invite) now CCs the office — `BOARD_EMAIL_CC` in `lib/board-review-email.ts`, defaults to `PMI@topfloridaproperties.com` — "so I can follow up and adjust the system if needed" now that these fire automatically. Migration added `document_review_rounds.purpose` (splits the OLD manual per-document round from the NEW automatic signature-reminder round — the reminder cron now runs two passes on two different cadences, 5-day old / 3-day new, so "pick the newest round" can never confuse them) and `esign_documents.application_id` (closes a real race: the old association+unit+status lookup could resolve to the WRONG application once a unit has two in-process applications at once — demonstrated live during verification, the old lookup really did pick the wrong one).

### PR7 — `approval_sent → approved`, automatic — highest blast radius
`lib/board-approve.ts`'s `runBoardApprove` — the Drive-filing/archiving code is an **unchanged, byte-for-byte extraction** of the already-proven manual button (only when it's called changed, not what it does), now also called automatically from `lib/esign.ts`'s signing-completion hook. `lib/application-handoff.ts`'s `handoffOnApproval` (the screening-provider handoff) is wired in too — confirmed it previously only ever fired from the manual PATCH `approve` action, never from the Drive-filing button. **Deliberately did not run a live test against real Drive folders** (Official/Archive are real, shared folders staff use daily) — verified everything else exhaustively against disposable test data instead. User's call after being shown this tradeoff explicitly: **"merge it, let it run."**

### PR8 — UI pass, and a real gap found while cleaning up
Found while removing now-redundant manual buttons: the OLD "Approve — board/on-site manager" buttons (PATCH `action='approve'`) **never ran the Drive-filing pipeline at all**, before or after PR7 — clicking them would mark an application approved while its Drive folder was never archived. **Fixed at the API level**, not just hidden in the UI: the PATCH `approve` action now calls `runBoardApprove` itself. Mirror-image gap also closed: `runBoardApprove`'s real (non-preview) run now **requires a fully-signed letter** before it will file anything — previously nothing stopped staff from clicking through preview→execute before the board had signed. "Mark audited" removed from the UI (superseded by PR4, and it never checked completeness — a real footgun once superseded). Decline stays the one clear, deliberate manual fork.

### Two more, same session, real production blockers
- **#731 — staff couldn't create an application when documents arrived from the owner, not the tenant.** Real case: MANXI 110, a lease renewal for Susie Bell forwarded by owner Monica Blumenfeld with no tenant contact info in the email at all. `lib/preapply.ts` gained `backfillPrimaryContactFromLease` (extracts the tenant's own email/phone off the signed lease itself, same `extractLeaseDetails` the self-serve auto-roster path already uses — takes only the FIRST address when a multi-tenant lease returns a comma-joined pair, found live) and `loopInOwnerForMissingContact` (adds the unit's real owner as a stakeholder + emails them the same collaborative link, when extraction doesn't apply or comes up empty). `create/route.ts`'s hard block now only fires when neither lifeline exists.
- **#732 — the public widget had no path to `/pre-apply` at all** for Tenant/Buyer personas. Root cause: `app/widget/page.tsx` (the external iframe embed on third-party association sites) never passes `associationCode` — only `FloatingWidget` (mounted on the 25 in-app association portal pages) does. New `apply` phase in `components/MaiaWidget.tsx`, reusing the same `AddressSearch` component agent/vendor already use to resolve the association when it isn't already known, translated into all 7 widget languages. **Verified live in the browser** (fully public, no auth needed) in both contexts.

### Verification discipline this session
Staff OTP login needs Gmail creds not configured locally, so nothing staff-facing could be click-tested directly. Every PR instead verified via disposable test applications created directly through `createIntake()`/`npx tsx` scripts against the REAL production Supabase project (same DB local dev points to) — always cleaned up after, confirmed via a follow-up query. The two public/unauthenticated pieces (the widget, `/pre-apply` itself) WERE click-tested live in the browser. Real Google Drive folders were deliberately never touched during verification.

### ⏳ NEXT
1. **Watch the first few real applications go through the automatic chain end-to-end** — nothing has run this live yet except the disposable test data above. First real `under_review → approval_sent` will send real board emails (CC'd to PMI now); first real `approval_sent → approved` will really archive a Drive folder.
2. **Susie Bell / MANXI 110** — retry creating her lease renewal now that #731 is live; confirm the lease extraction actually found her contact info (or that Monica got the owner-completion email).
3. Old manual "Mark audited" PATCH action and the old per-document board round are now vestigial escape hatches, intentionally left live (not deleted) per the "leave escape hatches" pattern — don't be surprised they still exist if grepping for them.
4. Older, unchanged: Checkr key prefix still unverified (don't flip anyone to `maia_checkr`); Rentvine tenant-sync cron dead since 2026-06-17.

Memory: [[application_pipeline_automation]], [[board_email_cc_preference]], [[staff_create_lease_contact_fallback]], [[widget_no_association_context]].

---

# Session handoff — 2026-08-18

## Gmail add-on v1 for applications, and pets become real rows

Two pieces, asked for together: stop the reply-by-email back-and-forth, and make sure a "form" MAIA sends actually writes queryable data — not just a signed PDF nobody can query without opening it.

### `unit_pets` — pet data as rows, not JSON trapped in a PDF
`20260818_unit_pets.sql`, needs applying by hand. Signing a Pet Registration now writes one row per animal (species, breed, vaccination date, photo path, service/ESA branch) via `applyPetRegistrationAnswers()` in `lib/esign.ts` — same completion hook as the emergency-contact write-through. **Supersede, never overwrite**: a fresh registration deactivates the unit's prior active rows and inserts the new set; the old rows stay on file. "Which units have a dog" and "whose rabies record expires next month" are now real queries instead of "open every signed PDF by hand."

### The standard reply — redirect to self-serve, don't file by hand

User direction, same day: staff shouldn't be filing tenant/owner email attachments by hand as the default — the reply should always redirect them to the self-serve upload link, in the same shape every time, "so we can build an agent to reply automatically" later. `lib/application-standard-reply.ts` + `POST /api/addon/applications/[id]/draft-reply`.

Reuses the real `document_requests` row the admin panel creates (same table, same `/request/[token]` page) but does **not** call `sendDocumentRequestEmails` — the drafted reply *is* the email, a second automated one would duplicate it. Form-backed items (Rules Ack / Pet Registration / Emergency Contact) still send immediately, unchanged from v1 — only the upload redirect became draft-first.

**Two real bugs the first live test caught, both fixed:**
1. The reply listed `board_approval_letter` — `provided_by: 'landlord'` — as something owed *from the tenant*. Fixed with a role filter: a tenant-addressed reply only asks for `applicant`/`both` items, an owner-addressed one only `landlord`/`both`. Verified against MANXI 613: "Board Approval Letter" no longer appears once addressed to Mark.
2. A form-send failure (Kimberly has no email yet, so Rules Ack can't reach her) disappeared silently — the item just sat in "still needed" with no explanation. Fixed: failures surface as a **`[Staff note — remove before sending]`** block naming the exact blocker, so it can't ship unnoticed.

**Known, pre-existing limitation surfaced, not introduced:** `/api/request/[token]/upload` always files a per-applicant item to the *primary* applicant — it has no way to route "this one is specifically Kimberly's." The draft's `document_requests` row is deduped to one row per `doc_key` (matching the admin panel's own granularity) rather than exposing a link that silently can't deliver on the per-person distinction the email text describes.

Gmail wiring reuses the **existing** `onComposeInsertDraft` mechanism byte-for-byte — same cache key (`'draft_' + threadId`), no new insert path. **📨 Draft: ask them to upload** is now the primary button on the Applications card.

### Gmail add-on — Applications, v1
Extends the **existing, already-deployed** ticket add-on (`gmail-addon/Code.gs`) rather than building a second integration. Two new endpoints:
- `GET /api/addon/applications` — matches the open email to an application (Gmail thread first via `application_communications`, then contact email), returns **live** `getReviewState()` output: totals, named missing items, refused items with reasons, due date, and which of the three form-backed items (`governing_docs_ack` / `pet_registration` / `emergency_contact`) are still `waiting`.
- `POST /api/addon/applications/[id]/send-form` — thin wrapper over `sendEsignFormsForItems`, the exact function the admin request panel calls. No second way these three documents get created.

**Real bug caught before shipping**: the first draft of `sendable` only looked at *required* checklist rows — silently hiding Pet Registration, since it's optional almost everywhere. That would have hidden the send button in precisely the case that motivated building it (an applicant claiming pets were "already handled" when they weren't). Fixed to check all rows, verified against the real application both ways.

Verified end-to-end against a real production application (MANXI 613): matching resolved the correct application by contact email, `getReviewState()` returned the exact same totals as the admin screen, `sendable` correctly includes all three form types once optional items are counted.

⚠️ **`Code.gs` is not deployed.** Unlike everything else this session, this doesn't go out through Vercel — it's a separate Google Apps Script project (`clasp push`), already authenticated on this machine and linked to the **live, currently-installed** ticket add-on. The backend routes are live; the new "🏠 Application" card section in Gmail is only live once `clasp push` runs. Held for explicit go-ahead since it updates a tool staff use daily for tickets right now.

---

# Session handoff — 2026-08-17

## VPCI application rules — signage, short-term rentals, the 20% cap

Three rules from the Venetian Park Condominium I board, in `20260817_vpci_signage_rental_rules.sql`. ⚠️ **Needs applying by hand in the SQL editor.**

| `rule_key` | value | enforcement |
|---|---|---|
| `no_for_sale_sign` | true | warn |
| `no_short_term_rental` | true | warn |
| `max_rented_pct` | 20 | warn |

**Written as rules, not as the questions they arrived as.** `label` is applicant-facing — `/api/pre-apply/[token]` serves it straight to the person filling in the application — so "Am I allowed to place a For Sale sign?" becomes the prohibition itself. Somebody reading a checklist needs to be told what the rule is, not asked what they were wondering.

**All three are `warn`, not `block`,** and the distinction is this table's own: `block` means the server can refuse the application on it. None of these can be — a sign is placed after move-in; short-term letting is a future act, already stopped at intake by `min_lease_days = 90`; and the 20% cap needs a live count of rented units that occupancy data cannot yet support. Surfacing them and flagging for the board is honest; claiming enforcement that isn't there is not.

**NOT re-added: "must own two years prior to rental."** VPCI already carries it as `no_rent_years_after_purchase = 2` (seeded 2026-07-05). A second row saying the same thing is how two rules start to disagree.

All four keys are now in `KNOWN_RULES` so staff can edit them in Association document setup without the "custom rule" escape hatch.

---

# Session handoff — 2026-08-16

## Emergency Contact List, and the three checklist items that were forms all along

**Two checklist items promised a form and delivered an upload box.**

### The defect worth remembering
The request-documents panel listed **"Rules Knowledge Acknowledgment (e-signed)"** and **"Pet Registration (e-signed)"** as ordinary tick boxes. Ticking one emailed the applicant a secure **upload** link — asking them to upload a document *only MAIA can produce*. There was nothing to attach. The two forms were reachable only from separate buttons further down the staff screen. Emergency Contact List would have joined them.

`lib/application-esign-forms.ts` is now the single table: a `doc_key` either has an entry there, in which case requesting it **sends the form**, or it does not, in which case it asks for an upload. The panel shows **✍️ MAIA sends it to sign** instead of an Owner/Tenant/Both control that never had any effect on those rows.

### Emergency Contact List (`emergency_contact_list`)
- **One form that adapts** (user direction). A non-resident owner is confirming their **tenant's** household, so occupants arrive prefilled from the tenant record, reworded, and the signed page says "Unit owner (non-resident)". Contacts, key holder and entry permission are asked identically.
- **Sent to every owner — rented out or not — and every renter.** They know different things: the renter knows who sleeps there tonight; the owner knows who holds a key and is who the Association may reach about the unit.
- **Contact 2 is deliberately out-of-area** — a local emergency contact is evacuating in the same storm.
- **"Help evacuating" is disability-adjacent** and built like the animal questionnaire: optional, one boolean, purpose printed on the signed page, and **no field anywhere for a reason** — the fill-route whitelist is the structural guarantee, not the wording.
- **Liability text on both variants** (`EMERGENCY_LIABILITY`) — shown on screen *before* signing as well as on the PDF. Written with a **savings clause** for Ch. 718 and the governing documents, because an association cannot contract out of its statutory duties and a disclaimer that tries to is the kind a court strikes down whole. ✅ **Approved for use by the user, 2026-08-16.** That is the user's own approval — it has **not** been reviewed by an attorney, and the two are not the same thing. Don't record it as legal sign-off.
- **One form per UNIT, not per owner row.** A co-owned unit has a row per owner (231 of 521 portfolio-wide) usually sharing one mailbox — MANXI 103 was sending Andre *and* Marcia Danford separate forms to the same address. Names are joined on the form ("Andre Danford & Marcia Danford") and the link goes to every distinct address they hold; any one of them can sign it.
- **Non-unit accounts are excluded.** MANXI's owners table has accounts literally named `Manager`, which were being sent a list for "Unit Manager". A unit reference always contains a digit — that test is association-generic and holds for VPCI's building-letter refs too.
- Signing files the PDF under `emergency_contact` and stamps `unit.emergency` with a **one-year** expiry.
- **Campaign is DRY RUN by default** — `/admin/compliance-outreach` → *Emergency Contact List → Set up a send* previews the exact recipient list; nothing leaves until Confirm.

**Live preview numbers (2026-08-16, read-only against prod):**

| | MANXI | VPCI |
|---|---|---|
| Recipients | **149** | **64** |
| Owners (of which rented out) | 147 (53) | 60 (5) |
| Renters | **2** | 4 |
| Skipped | 2 non-unit accounts, 52 no tenant email | 1 no tenant email |

⚠️ **Every unit's owner has an email; almost no TENANT does.** MANXI has 54 `unit_tenant_contacts` rows and **2** carry an email, so 51 of 53 rented units reach the owner only. That is the correct fallback — the owner gets the landlord variant and confirms the tenant's household — but the tenants themselves get nothing. **Collecting tenant emails is the highest-value follow-up**; the roster request (`tenant_contact_info`) is the tool for it.

### Car Registration
`"Updated Vehicle Information"` → `"Car Registration"`. The label promised a form; the `doc_key` has always been `car_registration` and what is collected is the registration document. The other **7** rows for that key already said "Vehicle Registration" — only MANXI `lease_renewal` carried the old wording. ⚠️ **Migration `20260816_car_registration_label.sql` must be applied by hand in the SQL editor** (auto-mode blocks service-role writes to prod, and `CLAUDE.md` says migrations go there anyway).

### Also generalised
The fill route and `needsFill` were pet-specific. **"Filled" now means what each form exists to collect** — an animal for the animal form, somebody to call for the emergency list.

---

## Applications dashboards — staff, board, on-site manager (branch `feat/applications-dashboards-2026-08-16`)

The last item from the 2026-08-15/16 list. Three views, **one library**, because a board screen and an office screen that disagree about whether an application is late will get somebody acting on the wrong one.

### The question a dashboard answers
Not "which applications exist" — the table already did that — but **whose turn is it, and for how long has it been their turn.** A document count says nothing: "14 documents" is equally true of an application nobody has touched in three weeks and one that is finished.

`lib/application-dashboard.ts` reduces every application to one stage:

| Stage | Owner | Meaning |
|---|---|---|
| `refused` | applicant (staff drive it) | sent back; a replacement must come in |
| `not_sent` | **staff** | every document is on file and **nobody has been asked to review it** |
| `review` | board / on-site manager | the reviewers have it |
| `letter` | **staff** | all approved; the Board Decision is not written |
| `signature` | board | the letter is out, awaiting signatures |
| `applicant` | applicant | required documents have not arrived |
| `decided` | — | approved or declined |

**The order of those branches IS the rule**, and it is `decideStage()`, pure and tested:
- **refused before waiting** — a refusal is a specific instruction about one document and must not be buried in a generic "still waiting on documents".
- **waiting before review** — the board cannot review what has not arrived, so an application with a gap is never described as being with them.
- **`not_sent` vs `review`** — identical on a status column, and the difference is everything. This is the hole the dashboard was worth building for: an application can sit at `under_review` that **no reviewer has ever been sent a link to**.

### What each desk gets
- **Staff** — `/admin/pre-apply`, all associations. Their turn is `refused` + `not_sent` + `letter`, **plus any open row carrying an alarm**: an application that has gone quiet is the office's to chase, nobody else will. (Without that rule the staff view reported "your turn: 0" against real production data where all 8 open applications were waiting on applicants.)
- **Board** — `/units/applications`, their association only. Their turn is `review` + `signature`. Rows link to the **round token they were actually sent**, the only place they can decide.
- **On-site manager** — same page, same numbers, `review` only: they review documents but do not sign the Board Decision.
- `unit_manager` is refused (403) — an owner's per-unit manager, not association staff; an association-wide list of applicants is not theirs to read. See [[manager_roles_distinction]].

Alarms: `overdue` (past the 30-day window) · `due_soon` (≤7 days left) · `stalled` (`STALLED_DAYS = 14`, no movement). Silent when zero.

### Structural changes worth knowing
- **`deriveReviewState()` extracted from `getReviewState()`** in `lib/board-review.ts` — pure, and now the single derivation behind both the one-application screens and the dashboards. Coercions moved to the DB boundary; behaviour identical.
- **`getReviewStates(ids)`** — the same state for many applications in a **fixed** number of queries (one checklist read per *association*, not per application). The per-application reader would have issued ~1500 queries for 300 applications.
- **`npm run test:review`** — **46 cases**, the third real test in the repo. Covers the window rule (a document that has not arrived cannot be reviewed; a refusal closes the window again; `dueAt = opened + days`), N/A and declaration retirement, per-applicant expansion excluding minors, and every `decideStage` branch order. **Run it before touching `lib/board-review.ts` or `lib/application-dashboard.ts`.**

### ⚠️ Verified how far
`npx tsc --noEmit` clean · `npm run lint` clean on every touched file · `npm run build` succeeds, both new routes present · `test:review` 46/46 · `test:gate` 48/48 · **`getApplicationDashboard()` run against production**: 10 applications, 8 `applicant` / 2 `decided`, no alarms; MANXI 309 correctly shows its letter 2/2, MANXI 801 correctly leads with its document gap despite a letter already existing.

**NOT render-verified.** Port 3000 was held by another session's dev server that did not respond, and both portals need an OTP session that cannot be created locally. **Look at both screens on a real login before relying on them.**

---

## Applications: the board actually reviews documents now (PR #698, MERGED → `95a9483`)

Nine commits, squash-merged. **All five migrations were applied to production DURING the build**, so prod ran new schema against old code until the merge; the merge closed that. Verified after: all tables present, 0 test rows left, `pets_allowed` null on 0 associations.

### The rule everything hangs off
**"The Board may decide up to 30 days after the last requested document is received."** One sentence (`boardWindowSentence()`), shown identically to applicant, owner, agent and board. Two consequences enforced in `lib/board-review.ts`, the single place that decides them:
- A document that has **not arrived** cannot be reviewed. It waits on an UPLOAD, not a decision. This was the real defect in the old screen, where "saved" was a document's only state.
- The window opens only when every required document has arrived **and** been approved. A refusal closes it again.

### What shipped
- **Four document states** replace one: ⚪ waiting · 🟠 on file, not reviewed · 🟢 approved · 🔴 refused. Green means a human read it.
- **`/board-review/[token]`** — board + on-site manager. One link, **any one** approver settles a document; each opens INLINE (doc route scoped to the round's application). Every decision stamps who + when in ET.
- **Refusal requires a reason, enforced by the API.** The reason then travels: into the **request email** ("Sent back by Walter Giles: …") and into the **communication history**. Without that, the second request email was indistinguishable from the first.
- **Staff decide on the same record** from `/admin/pre-apply/[id]`. The old Actions block (Mark audited / Request more / Decline) is **gone** — it asked for an application-wide verdict that never said WHICH document was wrong.
- **Row restyle**: one ✎ Edit opens Upload · From Drive · Request it · Mark N/A + rename/refile/move/Add example; expiration + "Does not expire" moved inside it.
- **Animal questionnaire merged INTO `pet_registration`** — one form, three branches (pet / service / ESA / "not sure"). Readily-apparent task or disability ends the inquiry; no field anywhere for diagnosis or medical records; fill route whitelists field-by-field. Vaccination record required when they answer "yes it's vaccinated"; **photo required on every branch** (user direction). `npm run test:gate` = 48 cases.
- **Vehicle/animal declaration gate** — a car-free applicant could never reach complete. Answers write BARE doc_keys into `na_items`, so every existing gate works unchanged.
- **Staff-created applications** + Drive folder (`+ New application` on the audit queue). No email sent; ≥1 name required; duplicate-unit guard; Drive failure reported not swallowed.
- **Tenant sponsorship** (`/sponsorship/[token]`) — the approved tenant confirms an additional occupant and gives that person's **own email, required, rejected if it matches hers**. MANXI 1003 is why: the occupant's paperwork carried the tenant's address, and email is identity for OTP + e-signature.
- **Additional occupants SHOW the current lease**, no longer copy its files (user direction) — copies drifted, duplicated in Drive, and carried a stale expiry.
- **Examples in request emails** — `template_path` had no API or UI; now 📎 Add example per row + 📨 Re-send rebuilds from the current checklist.
- **Owner unit insurance required on 18 associations** (15 condo + LFA co-op + GVH + PVV). Out: BHB (single-family), LCLUB/VPREC (master, no units), 5 commercial condos (need CP 00 17 / BOP, pending).
- **MANXI Rules Knowledge Acknowledgment** wired (`lib/manxi-rules-ack.ts`, packet pages 5-26 stored, `governing_docs_ack` item). Assembles to 25 pages.

### Bugs found and fixed
- **`.maybeSingle()` on the owners lookup** → PGRST116 on any co-owned unit → owner name AND email blank on the header and in the request form. **231 of 521 units portfolio-wide, 37 at MANXI.** Now reads all rows ("Andre Danford & Marcia Danford").
- **ApplicantsCard / RequestDocs seeded from props once** → server normalisation (phone) meant `dirty` never cleared, "Save applicants" never disappeared, saves looked like they hadn't taken.
- **Approved applications couldn't be corrected** — the meta route refused and said "start a new one", discarding uploaded docs + the signed approval letter. Now confirm-then-edit, stamped on the review note.
- **MANXI 1003 approved with an EMPTY roster** → no name anywhere, and the unit had **no tenant record at all** so its lease expiry was tracked nowhere. Backfilled from the stored approval letter: Yanytza Batista Carmona + Kaioni Shaw (4), term 15 May 2026 → 15 May 2027.

### ⚠️ Gotcha worth keeping
**Single-page PDF extraction returned the WRONG pages** on the 26-page Manors XI packet. It made a correctly-ordered packet look scrambled and I nearly "fixed" it with three page swaps that would have genuinely scrambled a recorded governing document. **Verify page order with a full-document `pdftoppm` render or `pdfimages -list`, never single-page reads.** See [[pdf-single-page-extraction-unreliable]].

### ⏳ NEXT
1. ~~**Dashboards** for staff, board and on-site manager~~ — **built**, see the section above.
2. **First production runs to watch:** the 7am ET reminder cron (silent until an application is fully approved — that's correct); **Drive folder creation on staff-created applications** (only ever ran locally, where it correctly failed with no service account); the first request email carrying notes + examples.
3. **MANXI 1003 additional occupant** — create it for **Rushayne K Shaw**, then send the sponsorship to Yanytza. Do NOT type his email from the Tenant Evaluation form: that is HER address. His credit report is **549 with serious delinquency**, below MANXI's 635 advance-maintenance floor — put it in front of the board with the sponsorship.
4. **Commercial insurance form** for ESSI, KANE, MACO, WBP, WBPA (CP 00 17 / BOP — confirm with the agent).
5. Older, unchanged: **Checkr key prefix** unverified (don't flip anyone to `maia_checkr`); **Rentvine tenant-sync cron dead since 2026-06-17**.

---

# Session handoff — 2026-08-15 (latest)

## Vehicle/animal declaration gate, assistance-animal routing, Manors XI rules packet

**The applicant now answers the yes/no gates themselves.** `association_intake_documents.condition_key` + `listing_applications.declarations` (migration `20260815_vehicle_animal_declarations.sql`, applied to prod). Before this, "Vehicle Registration" and "Vehicle Insurance" were unconditionally required, so **a car-free Venetian Park I applicant could never reach complete** — only staff could clear it, by hand, via `na_items`. The declaration writes BARE doc_keys, which every existing completeness gate already reads as "applies to nobody", so nothing downstream needed rewriting and the answer survives a later roster change. `naFor()` on `/admin/pre-apply/[id]` now honours a bare key for per-applicant rows too.

**`pets_allowed = false` no longer means "no animal questions".** The animal gate asks WHAT KIND — pet / service animal / ESA — and routes to different document sets (`lib/animal-accommodation.ts`, from `docs/ASSISTANCE-ANIMAL-PROCEDURE.md`). A no-pets association closes the pet path and **opens** the accommodation path. A pet declared where pets are prohibited is never silently dropped: the applicant is told, and staff get a flag. Applicant and staff both see what may and may **not** be asked — the service-animal path names "a doctor's letter or any medical documentation" as never requestable. **MAIA organises; it does not adjudicate.** Verified live on VPCI (pets allowed) and MANXI (pets prohibited).

**`npm run test:gate`** — new, and the second real test in the repo. 18 cases; case 7 is the fair-housing guarantee that `pets_allowed = false` never closes the accommodation path. Run it before touching `lib/animal-accommodation.ts`.

**`associations.pets_allowed` is now a real migration.** It had only ever been set directly on production, so a fresh environment did not have the column. All 26 associations answered: MANXI `false`, everything else `true`. ⚠️ **These are defaults, not board answers** — the 5 commercial associations (ESSI, KANE, MACO, WBP, WBPA) and the 2 master/rec entities (LCLUB, VPREC) are defaults of convenience.

**Pet registration + assistance-animal items are on every association**, all 4 application types, both optional and conditional — so they stay invisible until an applicant declares an animal. MANXI's ad-hoc `pet_esa_documents` (lease_renewal only) is deactivated in favour of `assistance_animal_documentation`; it had never been used.

**Manors XI can now be sent a Rules Knowledge Acknowledgment.** `lib/manxi-rules-ack.ts` + a `MANXI` case in `rulesAckContentFor()`, and the packet's official source documents are stored at `MANXI/rules-and-regulations-source-documents.pdf`. MANXI also gained a `governing_docs_ack` checklist item — the e-signed acknowledgment files under that key, and MANXI had no such item, so the document had nowhere to land. Assembles to **25 pages** (2 cover + the board's 22 verbatim pages + signatures), verified by rendering.

⚠️ **The packet's exhibits are fine — the packet is correctly ordered.** Verify page order with `pdftoppm` (full-document render) or `pdfimages -list`, **not** with single-page extraction: the single-page path returned pages 7/8/11/13/19/26 as each other's content for this file and nearly caused a "fix" that would have genuinely scrambled a governing document. Confirmed order: Ex 1 = 1989 Rules (p7-11), Ex 2 = 1986 Rules (p13-17), Ex 3 = Manors Club 2012 master rules (p19-26).

**Only pages 5-26 are spliced** into the acknowledgment. Pages 1-4 are the packet's own cover, requirements summary and an acknowledgment with blank ink-signature lines — `rules_knowledge_ack` supplies all three, and splicing them would put blank signature lines beside the verified e-signature block. That content lives in `MANXI_RULES` / `MANXI_INSTRUCTIONS` on the MAIA cover instead. Same convention as VPCI (8 pages, rules only).

**MANXI's `no_pet` rule row normalised** — it had been entered by hand as the JSON *string* `"true"` rather than a boolean, and its label now states what actually happens rather than reading as a blanket animal ban.

### ⏳ NEXT
1. **The assistance-animal decision record is NOT built** (step 4 of the procedure doc): no structured decision row, no running ~10-day clock, no reminder. Staff see the guidance and the narrow denial grounds; that is all. **Get the attorney sign-off before building the part that adjudicates.**
2. **The admin-side panel on `/admin/pre-apply/[id]` was typechecked but not seen** — the staff portal needs a session I could not create locally. Look at it on a real application before relying on it.
3. Each board should confirm its own `pets_allowed` rather than living on the default.
4. **Checkr key prefix** still unconfirmed — nobody moves to `maia_checkr` until it is known.
5. **Rentvine tenant-sync cron still dead since 2026-06-17.**

---

# Session handoff — 2026-08-14

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

### 2026-08-15 — Manors XI purchase requirements + assistance-animal groundwork

**MANXI purchase** gained three items from the association's own packet: HO-6 policy **quote** (issued policy due after closing), escrow deposit letter (10% held in escrow), and the Florida Board of Realtors **Condominium Rider** (routed to the **agent**, who the request-docs flow already CCs).

**`associations.pets_allowed` added** — MANXI `false` (its packet says "NO PETS ALLOWED AT ANY TIME"), VPCI `true`. **24 associations are still null and need their board's answer.**

⚠️ **`pets_allowed = false` must NOT mean "no animal questions".** A no-pet association must still consider a reasonable accommodation for a service animal or ESA. The full build spec — including the different documentation rules for service animals vs ESAs, and the things MAIA must be structurally unable to ask for (diagnosis, medical records, notarization, pet fees) — is in **`docs/ASSISTANCE-ANIMAL-PROCEDURE.md`**. **Not built. Needs an attorney's sign-off before it gates a real application.**

**Still not built:** the vehicle/pet **yes-no confirmation gate** in the applicant flow (all associations). Both items are currently unconditionally required at VPCI, so a car-free applicant is permanently incomplete.

**Manors XI rules packet** (`Manors_XI_Applicant_Rules_Acknowledgment_Packet_Clean.docx`) — its Exhibits 1-3 are **scanned images**, and there's no LibreOffice on this machine to convert them. Export it to PDF and it wires exactly like Venetian I's. The text content extracts cleanly (106 paragraphs) for `rulesAckContentFor('MANXI')`.

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
