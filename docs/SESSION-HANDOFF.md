# Session handoff — 2026-06-02

Snapshot for picking up on another machine. Everything below is **live in production on `main`** unless noted.

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
