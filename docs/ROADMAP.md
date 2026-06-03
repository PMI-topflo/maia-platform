# MAIA Platform — Open Items / Roadmap

_Last updated: 2026-06-03. Living document. Status key: ✅ Live · 🟡 Partial · 🔴 Not built · ⚠️ Blocked._
_Companion to `docs/SESSION-HANDOFF.md` (session-by-session state + gotchas)._

---

## 1. AP Invoice Intake & Audit  — `/admin/invoices`
The big focus of the latest session. Email → MAIA extracts → AP audits → push to CINC + Drive mirror.

**✅ Live**
- Inline per-field audit checklist (amber "Confirm" → green "Audited" pills) + action bar under the PDF.
- One review list — `needs_vendor` and `duplicate_in_cinc` folded into **Pending review**.
- Vendor search/auto-match by **DBA** (e.g. "Envera" → "Hidden Eyes LLC").
- Double-pay guard: scans CINC duplicates + 6-mo ledger (same-amount, name-agnostic) + our history; prints what it checked.
- **GL suggested from the vendor's past invoices** (expense-side ledger) + one-click "Use it".
- **Funds check** to the scheduled pay date (all open invoices + run-rate; 6-mo horizon; "move to first affordable month").
- **Pushed invoices are locked** (PATCH 409s once `pushed_to_cinc`) — fixes the double-push desync.
- Drive mirror retry (3×) + **"Save to Drive now"** re-mirror button.
- Email Karen when a non-Karen staffer marks ready.

**🟡 / 🔴 Open**
- ✅ **GL auto-select** — pre-fills the dropdown when confidence is high (CINC vendor-account mapping or ≥2 past invoices); single-data-point stays a manual "Use it"; never auto-confirms the audit pill. _(PR #262)_
- ✅ **Auto-association detection** — infers the association from the vendor's confirmed MAIA history (unanimous ready/pushed drafts only). Self-corrects the Arrow-Asphalt case after the first manual set. _(PR #262)_ — 🔴 **still open:** brand-new vendor's *first* invoice (no history) would need a live CINC cross-association ledger scan; intentionally kept out of the webhook path.
- ✅ **Funds-check tuning** — knobs centralised in `FUNDS_CHECK_DEFAULTS` (tight $1,000, run-rate 3mo, horizon 6mo, all overridable per call); `tight` computed server-side; new "which open invoices count" toggle (`all` vs `due-by-scheduled`). _(PR #263)_ — 🟡 **follow-up:** a persisted per-association settings panel so the knobs change without a deploy.
- 🔴 **Drive link for manually-placed files** — the service account's `drive.file` scope can't see files it didn't create, so a manually-dropped PDF leaves `drive_file_id` null (no detail-page link). _(still open)_
- ✅ **Expense-side GL** surfaced in the Pushed banner (scannable at a glance). _(PR #262)_

---

## 2. Leasing / Application Pipeline  — `/apply`
Applicant fills form → pays fee (Stripe) → background check (Applycheck) auto-triggers → board reviews → decision.

**✅ Live**
- Multi-step **application form** with save/resume draft, co-applicant invite, lease PDF parse, association rules/docs surfaced, signature-evidence capture.
- **Stripe checkout** for the application fee (`/api/create-checkout-session`); products via `STRIPE_PRICE_*`.
- **Background check** — `/api/trigger-applycheck` calls **Applycheck** (`APPLYCHECK_API_KEY` / `APPLYCHECK_ACCOUNT_ID`), which emails each applicant a verification invite. **Auto-triggered by the Stripe payment webhook** on successful payment.
- **Board review + decision** flow (`/board/review`, `/api/board/review`, `/admin/applications`, send-to-board, approve/reject).

**🟡 / 🔴 Open**
- 🔴 **Per-association rules acknowledgment** (confirmed scope, 2026-06-03): the flow is complete; the remaining work is to add **each association's rules into the `/apply` flow so the applicant acknowledges/signs them inside the application**. Per-association rules content + an acknowledgment/signature step. Likely a small migration for the rules text (or reuse the existing association docs/rules surface).
- 🟡 Background-check **status surfacing** — `applycheck_status` is stored; verify it's shown clearly to the board and that webhooks/poll update it.
- 🟡 Edge cases: co-applicant payment splitting, resume-link expiry, partial-pay handling.

---

## 3. Owner Self-Service  — _mostly NOT built (highest-value new work)_
The items you named as carry-over. These do **not** exist yet as owner-facing features.

- 🔴 **Owner ledger by request (CINC)** — let a unit owner request and receive their CINC ledger/statement on demand. Today "ledger" only appears in **admin** reconciliation/reports; there is **no owner-facing** request → CINC fetch → deliver flow.
  - _Build sketch:_ owner authenticates (existing OTP for the `owner` persona / `/my-account`) → requests ledger → server pulls the owner's CINC account ledger → emails/streams a PDF. Needs the CINC ledger endpoint wired in `lib/integrations/cinc.ts` (we already use glTransactions/openInvoices — likely a per-owner statement endpoint to add).
- 🔴 **Owner online payments (assessments)** — owners pay assessments/dues online. Stripe exists only for **application fees** today; there's no owner→association assessment payment. Decide: Stripe vs. CINC's own pay portal vs. ACH.
- 🔴 **Owner-facing balance/status** on `/my-account` (current balance, last payment, next due) — pulled from CINC.

---

## 4. CINC Financial Integration  — `/admin/reconciliation`, `/admin/reports/monthly`
**✅ Live**
- **Bank reconciliation** sync + view (`lib/bank-reconciliation-sync.ts`, `/admin/reconciliation`), upcoming/scheduled payments, export.
- **Monthly reports** — financials, board message, PDF, publish/email (`/admin/reports/monthly`).
- **CINC sync / onboarding** for owners + documents/insurance/safety (`/admin/cinc-sync`).
- Deep CINC client (`lib/integrations/cinc.ts`): vendors, invoices, GL transactions (all-accounts), budgets, bank balances, work orders, duplicate detection.

**🟡 Open**
- ✅ **Reconciliation "Upcoming Payments"** now driven by `scheduled_pay_date` — CINC approved-unpaid rows show our planned pay date (badged), plus a new `MAIA · scheduled` stream for ready-to-push drafts not yet in CINC. No double-counting. _(PR #263)_
- ✅ **Reserve / debt-service verified + fixed** — found the "Pay from" dropdown only filtered `"debt service"` by description while `deriveBankKind` also flagged loan/mortgage/escrow, so those leaked into the payable list. Now share one `isDebtOrEscrowAccount()` predicate. Reserve handling was already correct. _(PR #263)_

---

## 5. Communications · MAIA Email · Gmail Add-on
**✅ Live**
- **MAIA email command system** (`lib/maia-command-processor.ts`): `@maia` triggers, Claude parse → Supabase upsert, attachments to storage buckets, freeform conversations.
- **Gmail Workspace add-on** (the sidebar "bar"): association picker, suggestions, ticket linking, dynamic `@maia upload this invoice #CODE` copy line.
- Communications inbox, Dialpad call sync, WhatsApp/Twilio, Resend email.

**⚠️ / 🔴 Open**
- ⚠️ **One-click "forward invoice to maia@" in the add-on** — blocked: the RESTRICTED scopes (`gmail.compose`) were admin-trusted but per-user **re-consent was never completed**. Currently manual forward. Decide: finish re-consent rollout, or keep manual.
- 🟡 **Add-on install rollout** to the whole team (Workspace admin push) — see the install email drafted this session.

---

## 6. Cross-cutting / Infra / Conventions
- **Node 20.x required** (Vercel + both dev machines). Use nvm; `nvm use 20`.
- **Branch discipline** — always branch off *current* `origin/main`; re-fetch after each merge. (The "merge-race" bit us repeatedly.)
- **Vercel queue** occasionally stalls — cancel stuck preview builds, push an empty commit to retrigger.
- **Secrets** live only in `.env.local` (gitignored) → keep a copy in 1Password; `GOOGLE_SERVICE_ACCOUNT_JSON` is prod-only (empty locally).
- 🟡 **Cleanup**: pre-existing `react-hooks/set-state-in-effect` lint errors; prune merged local branches; `middleware`→`proxy` Next.js 16 deprecation.

---

## 6b. Staff Daily News + Improvement-ideas board — _NEW (requested 2026-06-03), not built_
A branded daily HTML email — **"PMI Top Florida Daily News"** — to the whole team, plus an idea-intake → admin triage loop.

**Requested behaviour**
- 🔴 Daily (Mon–Fri) branded HTML email (PMI Top Florida look — navy `#1f2a44` / orange `#f26a1b`, reuse `lib/report-email.ts` patterns).
- 🔴 **One section per staff** (Jonathan, Isabela, Paola, Karen, Fabio), each showing **week-to-date (Mon→today)**:
  - tickets + work orders **opened** and **resolved** (counts),
  - currently **open** and **open-and-late** counts, colour-coded.
- 🔴 Per-staff **"suggest a MAIA improvement"** link (optional) → feeds a backlog.
- 🔴 **Dashboard triage screen** (Fabio) for the ideas list with **accept / done / delete** states.

**What the data supports (from the 2026-06-03 code map)**
- Tickets **and** work orders both live in `tickets` (`type` = `'ticket' | 'work_order'`); `created_at`, `resolved_at`, `status`, `due_at` (for "late"), `archived_at`. Staff attribution is **only** `assignee_email` (expanded across `@topfloridaproperties.com`/`@pmitop.com`/`@mypmitop.com`).
- Staff roster: `pmi_staff` (`name`, `email`, `alt_emails`, `active`).
- Email via `sendEmail()` (lib/gmail.ts, Resend→Gmail fallback); branded template precedent `lib/report-email.ts`; tokenized-link precedent `report_feedback`.
- Cron precedent: `app/api/cron/compliance-alerts` (CRON_SECRET bearer), registered in `vercel.json`.

**⚠️ Key gotcha + open decisions (see memory `staff_daily_news.md`)**
- **Unassigned tickets (`assignee_email IS NULL`) appear in nobody's section** — decide: omit, a "Team / Unassigned" section, or attribute to a manager.
- Define **"late"** (`due_at < now` AND not resolved? what when `due_at` is null?).
- Confirm: one newsletter with everyone's sections sent to all (transparency) vs each person gets only their own; send time (EST); idea link per-staff tokenized.
- Needs a new migration: `maia_improvement_ideas` (idempotent + GRANTs per the new-table template).

## 7. Decisions captured (2026-06-03)
Answers from the PM, now the spec for these tracks:
1. **Application forms** — the whole flow is built; the ONLY remaining work is to **add each association's rules into the existing `/apply` flow so the applicant acknowledges/signs them inside the application** (per-association rules content + acknowledgment step). Not a bug, not new infra.
2. **Owner ledger by request** — owner is identified **once** via the existing owner OTP, then may **request their ledger by any channel: email, WhatsApp, or text (SMS)**. Multi-channel delivery, not in-portal-only. Needs a CINC per-owner statement fetch + Resend/Twilio delivery.
3. **Owner payments rail** — owners pay via **CINC WebAxis login, check, or ACH forms**. **Stripe is application-fee ONLY.** So owner "online payments" = surface a WebAxis link + check/ACH info on `/my-account`; no Stripe owner-assessment flow.
4. **Background check** — ⏳ next up: verify Applycheck is wired end-to-end (status callback/poll, board surfacing, re-invite) and report the real gap.

(Full detail also in memory: `owner_self_service_decisions.md`, `staff_daily_news.md`.)
