---
name: gmail-addon
description: Gmail sidebar add-on for guided ticket creation + visibility; backend API + staff-reply capture
metadata: 
  node_type: memory
  type: project
  originSessionId: 5535fc12-a76a-4fb2-af51-d628810ff193
---

Gmail Workspace **sidebar add-on** is the chosen adoption path for tickets/work-orders (NOT invisible auto-create-everything — the owner found that confusing). Staff use a guided panel inside Gmail to create tickets/WOs correctly and see their queue; replying from Gmail updates the ticket as a byproduct.

**Shipped (2026-05-31), all merged-pending:**
- PR #233 — backend: `lib/addon-token.ts` (per-staff HMAC bearer, `MAIA_SESSION_SECRET`, 1yr) + `/api/addon/*` routes (`context`, `tickets` list, `tickets/ensure` guided create, `tickets/[id]` PATCH, `tickets/[id]/draft` AI-draft-no-send) + `/admin/addon` page (mints+shows each staffer's token) + **`gmail-addon/`** Apps Script source (appsscript.json, Code.gs, DEPLOY.md).
- PR #234 — staff reply capture: in `ingestInboundEmailToTicket` thread-reply branch, when maia@ is only CC'd (To: = outside party) the staff reply is recorded **outbound** (attributed to staffer) instead of inbound. Relies on **maia@ staying CC'd on threads** (owner's committed workflow). Dedup via RFC822 Message-ID. No Gmail watch change.

**Deploy (owner's side):** `gmail-addon/DEPLOY.md` — clasp push → private Workspace Marketplace install (no public review); each staffer pastes token from `/admin/addon`.

**Add-on org-rollout gotchas (hit 2026-06-03 — "works for me but not staff / not showing to install"):**
1. **"Works for me" = a Test deployment** — those are owner-only. Staff need a real Marketplace publish + Admin install; there is NO other org-distribution path for Workspace add-ons.
2. **Apps Script project must use a USER-MANAGED GCP project** (not the "Default" Apps-Script-managed one) to deploy as an Add-on — else Deploy is greyed out. Switch in Project Settings → Change project → enter the **GCP project NUMBER** (~12 digits, NOT the project ID like "maia-platform-494322"; the number is on the Cloud console project dashboard). We point it at the existing `maia-platform-494322` project (same one as the Drive SA). Switching revokes old auth + can't revert — expected.
3. **`urlFetchWhitelist` is REQUIRED in appsscript.json** for any add-on using UrlFetchApp (the Maia add-on calls `/api/addon/*`). Not enforced for test deployments, only the real deploy. Added `["https://www.pmitop.com/"]` (PR #272). Edit it live via Apps Script → Project Settings → "Show appsscript.json in editor".
4. Then: Deploy ▸ New deployment ▸ Add-on → copy **Deployment ID** → Cloud console **Google Workspace Marketplace SDK** (enable + App Config Private + paste Deployment ID + Store Listing → Publish) → **Admin ▸ Apps ▸ Google Workspace Marketplace apps ▸ Install**. Restricted scope `gmail.compose` → mark app trusted in Admin ▸ Security ▸ API controls if staff get "unverified".
Apps Script Script ID (Maia): `1mLyT024zp40pDOHSZxlhW27WdH_yOC1I-Z-gLJO5kRWaSvOKs7CL9wmw`.

**Recurring vendor services (architecture):** Phase 1 (#236) — recurring_services + vendor_employees + service_visits; /admin/recurring-services setup UI. recurring_services has `cadence` (services weekly) vs `billing_cadence` (bills monthly) — landscaping etc. bill ONE monthly invoice covering the month's weekly visit-WOs (documentation, not billed 1:1). Phase 2 (#237) — generate weekly visit WOs + send crew the vendor-portal link via their channel + language; vendor reports auto-translated to English (lib/translate.ts), original kept; DEFAULT LANGUAGE ENGLISH everywhere. Phase 3a (#238) — Friday agenda cron (office/crew register crew+dates for next week). Conventions: tickets+WO share one table + one TKT-YYYY-NNNN sequence; reclassify toggle exists and correctly does not rename.

**All open follow-ups + remaining phases (3b/3c) + the 3 new 2026-05-31 requests live in the master backlog → [[next-session-pending-items-as-of-2026-05-29-revised]] (`next_session_priorities.md`).**
