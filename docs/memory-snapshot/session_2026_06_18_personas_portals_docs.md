---
name: session-2026-06-18-personas-portals-docs
description: "2026-06-18/19 session — shipped Personas hub + per-person Messages, HEIC→JPEG, association-hub type fix, vendor↔association linking (Personas + Hub), resident-portal standardization (25→1 shared component), and portal documents moved off Google Drive into MAIA. PRs #399–#405 all merged. Key pending: apply association_vendor_links migration; re-upload association documents into MAIA."
metadata: 
  node_type: memory
  type: project
  originSessionId: 0f966d35-5727-4b77-8261-7f0eced7619a
---

# Session 2026-06-18/19 — Personas, vendor linking, resident portals, documents→MAIA

All PRs **MERGED** to main. Continues [[implementation-roadmap-2026-06]].

## Shipped this session (#399–#405)
- **#399 Personas hub** — new left-nav **Personas** page (`/admin/personas`): tabs Owners/Tenants/Vendors/Board/Agents, search + association filter, "Manage →" links. Plus **per-person Messages history** (drawer): merges `general_conversations` (SMS/WhatsApp/voice/web by phone last-10 + email) + `email_logs` into one ET-timestamped timeline. API `/api/admin/personas` + `/api/admin/personas/messages`.
- **#400/#403 Vendors per association** — root bug fixed: CINC `vendorAssociation` keys the id as **`VendorID`** (capital D), not `VendorId` → it was always `undefined`, which collapsed scoping (3→1), killed enrichment, AND broke the **hub's** `getVendorComplianceStatus`/trade lookups. Normalized in `listVendorsForAssociation`.
- **#403 MAIA-local vendor↔association linking** — CINC's API is **READ-ONLY** for vendor-association accounts (confirmed against live Swagger v1.40.0 — no POST/PUT), and only a few assocs have them set up (CHV=3, GVH=2; LCLUB/DELA/etc.=0). So: new table **`association_vendor_links`** + `/api/admin/personas/vendor-links` CRUD. Personas **and** Hub Vendors tabs now scope to CINC-linked ∪ MAIA-tagged, with per-row "+ Link"/"✓ Linked·Unlink", an "in CINC" badge, a **"Set up in CINC ↗"** deep link (CINC web = `https://pmitfp.cincsys.com`), and a "+ Link a vendor" search modal (Hub). When an assoc has 0 linked vendors → falls back to full CINC catalog with a note.
- **#401 HEIC→JPEG on ingest** — sharp's prebuilt binary can't decode HEVC-HEIC ("compression not built in", on Vercel too). Switched to **`heic-convert`** (pure-JS libheif+libde265) → JPEG, then sharp resize. Renames stored object `.heic`→`.jpg`, re-points DB rows. Covers WO photos, COI, safety, assoc docs, document-intake inbox, vendor-portal uploads. `isHeicBuffer` magic-byte sniff (AVIF excluded — browsers render it).
- **#402 Association hub fixes** — `association_type` was hardcoded `null` since the hub redesign (#314, Jun 7). Now shows type badge (Condominium/HOA/Co-op/Commercial, prettifies master_hoa→"Master HOA") + `florida_statute`. Resurfaced **"👥 Unit owners & CINC sync"** (→ Board & Owners tab) and **"📄 Documents"** in Overview Quick links (they were never lost, just tab-buried).
- **#404 Resident portals standardized (25→1)** — the 25 near-identical 280-line portal pages are now 4-line shells rendering **`components/AssociationPortal.tsx`**. Adds an **identity hero** (name·type·statute·address from `associations` row) ABOVE the login gate (public + owners now see which association). **Quick Actions first**; removed the staff-style "Communications & Tickets" stats widget from owner view. Per-assoc config `lib/association-portal-config.ts`: **LCLUB + VPREC hide Estoppel/Application**.
- **#405 Portal documents → MAIA (no Google Drive)** — removed BOTH Drive blocks (per-assoc folder cards + Drive "Forms & Downloads"); all 25 portals Drive-free. Docs come from `association_documents` (Supabase storage) with short-lived **signed URLs**, fetched **client-side after login** via session-gated **`/api/portal/documents`** (resident → own assoc only; staff → any). Taxonomy (`lib/association-documents.ts` CATEGORIES) expanded: **+Application Forms** (temp home until in-Maia application), ACH Authorization, ARC, Financials, Budget, Insurance, Maintenance, Leases & Resale, Welcome Letters, FAQ. **−Board Minutes** (it's in WebAxis) and **−Violations**.

## #406 (OPEN — not yet merged as of laptop move)
- **Staff "View portal as …" preview** — gate honors `?preview=visitor|owner|board|onsite_manager`. visitor=public login screen; owner/board/onsite_manager=logged-in body framed as that persona (chip+icon) with a "Staff preview" banner. Hub **tab bar**: "🌐 View portal as: Unit owner ↗ · Board ↗ · Onsite mgr ↗ · Visitor ↗". (onsite_manager = on-site NON-PMI-staff manager.) Portal body is identical across personas today — per-persona content can layer on later.
- ⚠ **Recovered a stranded commit**: the **hub half of #403 (f457edc) never reached main** — only the Personas half merged. #406 restores `lib/association-portal.ts`, the hub Vendors-tab linking ("in CINC"/"+ Link a vendor"/"Set up in CINC"), the association-vendors CINC∪MAIA union, and the `[slug]` portal-path refactor. **Merge #406** to make the hub whole.

## ⚠ MUST-DO when resuming (pending)
0. **Merge PR #406** (portal preview + recovered hub vendor-linking).
1. **Apply the migration** `supabase/migrations/20260618_association_vendor_links.sql` by hand in Supabase SQL editor (idempotent; SQL was handed over). Until applied, vendor-linking buttons no-op gracefully. **Verify it was applied** (laptop move 2026-06-19 → ~06-29).
2. **Upload association documents INTO MAIA** — Drive was removed, so every association's portal Documents section is **empty until staff upload** via Admin → Associations → (assoc) → **Documents** (categories incl. Application Forms). Owner directive: "I will upload in Maia all files needed."
3. **Galleria Village (GVH)** had real per-category Drive folders (the only bespoke one) — those docs are **NOT auto-migrated**; re-upload into MAIA.

## Key facts learned (don't relearn)
- CINC vendor↔association linkage is **READ-ONLY** in the API (Swagger v1.40.0). No way to write the GL/account link → MAIA-local table is the workaround. CINC web UI deep link = `https://pmitfp.cincsys.com`.
- CINC `vendorAssociation` response uses **`VendorID`** + address fields; normalize it.
- `sharp` prebuilt = no HEVC decode → use `heic-convert`. AVIF is fine (browsers render).
- Resident portal canonical paths live in `lib/association-portal.ts` (code→/slug) + `app/[slug]/page.tsx`; portal config (hide flags) in `lib/association-portal-config.ts`.
- Owner explicitly: **no list of associations on the main page www.pmitop.com** — portals are direct deep links only.
- Squash-merge keeps stranding follow-up commits pushed after merge (#403→#400 stranded; #405's work stranded after #404 merged). **Push ALL commits before merging.**
