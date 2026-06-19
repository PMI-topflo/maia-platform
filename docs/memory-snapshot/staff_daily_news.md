---
name: staff-daily-news
description: "Spec + data model + open decisions for the \"PMI Top Florida Daily News\" staff email and the MAIA improvement-ideas triage board (requested 2026-06-03)."
metadata: 
  node_type: memory
  type: project
  originSessionId: c35ddde2-be05-4020-9cf7-5b48340de70b
---

**SEND IT NOW:** /admin/ideas → "📣 Send Daily News now" (staff-session auth, no CRON_SECRET) — PR #266. That button + bot-exclusion (`isHumanStaff` drops maia@/AI accounts) must be merged+deployed first. Recipients: Fabio(pmi@pmitop.com), Isabela(ap@), Jonathan(ar@), Karen(billing@), Paola(service@). ⚠ This local env has NO send creds (no CRON_SECRET/Resend/Gmail — all prod-only) + Supabase key only, so sends can't be triggered from a Claude Code session; must go through the deployed app (the button, or the cron, or Vercel "Run cron").

**STATUS: built in PR #265 (2026-06-03), awaiting migration apply + merge.** Decisions baked in: one newsletter to everyone · "Team · Unassigned" section · late = due_at + priority-age fallback (urgent 1d/high 3d/normal 7d/low 14d) · **auto-send Mon–Fri 6:00 AM ET** (PR #266; DST-proof: `vercel.json` cron `0 10,11 * * 1-5` + handler gates on real ET hour===6, so exactly one of the two UTC fires; `?force=1` bypasses gate, `?dry=1` previews). ⚠ BEFORE it works: apply `supabase/migrations/20260603_maia_improvement_ideas.sql` by hand (also in `/admin/tools`). Preview without sending: `GET /api/cron/daily-staff-news?dry=1` with the cron bearer. Files: `lib/staff-news.ts`, `app/api/cron/daily-staff-news/`, `/improve` + `/api/improve`, `/admin/ideas` + `/api/admin/ideas`. Follow-ups: cron is fixed-UTC (5pm EDT/4pm EST); `/api/improve` public + unauth'd (validated, no rate-limit).

**Feature (requested 2026-06-03):** A branded daily HTML email — **"PMI Top Florida Daily News"** — to the whole team, plus an idea-intake → admin triage loop.

Requested behaviour:
- Daily (Mon–Fri) branded HTML email, PMI Top Florida look (navy `#1f2a44` / orange `#f26a1b` — reuse `lib/report-email.ts` patterns).
- **One section per staff** (Jonathan, Isabela, Paola, Karen, Fabio), each showing **week-to-date (Mon→today)**: tickets + work orders **opened** and **resolved** (counts), and currently **open** and **open-and-late** counts, colour-coded.
- Per-staff **"suggest a MAIA improvement"** link (optional) → feeds a backlog list.
- **Dashboard triage screen** (for Fabio) over that list with **accept / done / delete** states.

**Data model (from the 2026-06-03 code map — all confirmed in repo):**
- Tickets AND work orders both live in the `tickets` table; `type` = `'ticket' | 'work_order'`. Columns: `created_at`, `resolved_at`, `status` (open/pending/waiting_external/resolved/closed), `due_at` (nullable — basis for "late"), `archived_at`, `assignee_email`. WO extension table `work_order_details` (vendor info, not staff).
- **Staff attribution is ONLY `assignee_email`** (a plain email string), expanded across trusted domains `@topfloridaproperties.com` / `@pmitop.com` / `@mypmitop.com` via `lib/staff-lookup.ts`.
- Staff roster: `pmi_staff` (`name`, `email`, `alt_emails[]`, `active`). 
- Email: `sendEmail({to,subject,html,text})` in `lib/gmail.ts` (Resend → Gmail fallback; from `maia@pmitop.com`). Branded template precedent: `lib/report-email.ts` (`buildReportEmail`, `mdToEmailHtml`). Tokenized-link precedent: `report_feedback` table + `/report-feedback/[token]`.
- Cron: precedent `app/api/cron/compliance-alerts` (auth = `Authorization: Bearer ${CRON_SECRET}`), registered in `vercel.json`. Add e.g. `/api/cron/daily-staff-news`.

**⚠️ KEY GOTCHA:** Unassigned tickets (`assignee_email IS NULL`) belong to **no** staff section and would silently vanish from the report.

**Open decisions (ask before building):**
1. Unassigned tickets → omit / "Team · Unassigned" section / attribute to a manager?
2. Define "late" → `due_at < now` AND not resolved? Behaviour when `due_at` is null (most tickets may lack it)?
3. One newsletter with everyone's sections sent to all (transparency) vs each person gets only their own section?
4. Send time (EST) and Mon–Fri only (week-to-date resets Monday)?
5. Improvement-idea link: per-staff tokenized (like `report_feedback`) so submissions are attributed?

**Build shape (4 parts):** (a) metrics query over `tickets` grouped by `assignee_email` for the Mon→today window; (b) branded HTML builder reusing `report-email.ts`; (c) cron route + `vercel.json` entry; (d) new idempotent migration `maia_improvement_ideas` (status accept/done/delete + GRANTs per `supabase/migrations/_TEMPLATE_new_table.sql`) + a tokenized submit page + an admin triage screen.

See [[next_session_priorities]] and in-repo `docs/ROADMAP.md` §6b. Migration rules: [[migration_workflow]].
