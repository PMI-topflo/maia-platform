# MAIA Platform — Open Items / Roadmap

_Last updated: 2026-06-02. Living document. Status key: ✅ Live · 🟡 Partial · 🔴 Not built · ⚠️ Blocked._
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
- 🟡 **GL auto-select** (pre-fill the dropdown when confidence is high) instead of "Use it".
- 🔴 **Auto-association detection** when an invoice arrives with no association (Arrow Asphalt had none — staff set VPREC by hand).
- 🟡 **Funds-check tuning**: the $1,000 "tight" threshold, the 3-month run-rate window, toggle for which open invoices count.
- 🔴 **Drive link for manually-placed files** — the service account's `drive.file` scope can't see files it didn't create, so a manually-dropped PDF leaves `drive_file_id` null (no detail-page link).
- 🟡 **Expense-side GL** shown on the **Pushed** invoices view.

---

## 2. Leasing / Application Pipeline  — `/apply`
Applicant fills form → pays fee (Stripe) → background check (Applycheck) auto-triggers → board reviews → decision.

**✅ Live**
- Multi-step **application form** with save/resume draft, co-applicant invite, lease PDF parse, association rules/docs surfaced, signature-evidence capture.
- **Stripe checkout** for the application fee (`/api/create-checkout-session`); products via `STRIPE_PRICE_*`.
- **Background check** — `/api/trigger-applycheck` calls **Applycheck** (`APPLYCHECK_API_KEY` / `APPLYCHECK_ACCOUNT_ID`), which emails each applicant a verification invite. **Auto-triggered by the Stripe payment webhook** on successful payment.
- **Board review + decision** flow (`/board/review`, `/api/board/review`, `/admin/applications`, send-to-board, approve/reject).

**🟡 / 🔴 Open — _confirm exact scope with the team_**
- ❓ "Application forms" was named as an open item — **need the specific gap** (a field/validation? a new association's rules? multi-language? a step that's not saving?). Code shows a complete flow, so this is a refinement list to define.
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
- 🟡 **Reconciliation "Upcoming Payments"** driven by the invoice **scheduled_pay_date** (ties into the new funds check).
- 🟡 Verify reconciliation handles the non-operating / reserve / debt-service accounts correctly (we just fixed `deriveBankKind` misclassifying debt-service as operating).

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

## 7. Needs your input (to make this exhaustive)
These were named across sessions but I don't have the original detailed requirements — tell me the desired behavior and I'll scope/build:
1. **Application forms** — what specifically is still open (a field, a validation, a new association, a bug)?
2. **Owner ledger by request** — delivery (email PDF vs. in-portal), which CINC ledger/statement, auth (owner OTP).
3. **Payment method integration** — owner assessments? vendor payments? which rail (Stripe / CINC portal / ACH)?
4. **Background check** — is Applycheck fully wired end-to-end, or is there a remaining gap (status callback, board view, re-invite)?
5. Anything else from prior sessions not reflected above.
