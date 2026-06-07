# Session handoff — 2026-06-07

Snapshot for picking up on another machine. Everything below is **live in production on `main`** unless noted.

> ⚠️ **Repo path:** the canonical clone is now `~/maia-platform` (moved out of iCloud). Stale copies under `~/Documents/GitHub/maia-platform` and `~/Downloads/maia-platform` — ignore them.

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
