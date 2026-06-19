# Vendor compliance + CINC vendor-write (2026-06-04 session)

Canonical living spec is in-repo: `docs/ROADMAP.md` §4 (Vendor) + `CINC_API.md`
(VendorInfo + WorkOrders verified write models). Read those first.

## Shipped & live (merged to main)
- **#276** vendor attachments: PDF/doc file cards + one-click Download; vendor
  uploads hard-capped at 4 MB after compression (refused if larger); **Claude
  extract-before-compress** — classifies W-9/COI/ACH/license, masks sensitive
  to last-4, stores `extracted_doc_type`/`extracted_data` on
  `work_order_attachments` (migration `20260605_vendor_doc_extraction.sql`).
- **#277** "Apply to CINC vendor" push for **ACH + W-9** — "→ CINC" action on
  the attachment card → masked current-vs-extracted modal → `PATCH /vendors/vendor`.
  Full ACH/EIN re-extracted server-side at apply (`extractVendorDocument(...,{mask:false})`),
  never stored/sent to browser. VendorId from `work_order_details.cinc_vendor_id`.
- **#278** Daily News → **5 AM ET, DST-safe** (cron `0 9,10 * * 1-5` + route only
  sends when ET hour===5; `?force=1` bypass). Staff boxes now deep-link to MAIA.
  Email deep-links survive staff login (middleware passes `?return=`, login honors it).
- **#279** On-Hold follow-up is now a **ticket** (was work_order). **Compliance
  pre-check**: `getVendorComplianceStatus(vendorId, assoc)` reads CINC (ACH/W-9/
  COI/license + expiry); On-Hold modal shows ✅on file/⚠️expired/❌missing and
  only requests missing/expired. Endpoint `GET /api/admin/vendors/[vendorId]/compliance`.
- **#280** fuzzy-matching spec (docs). **#281** multi-invoice email: maia@ now
  accepts **image** invoices (JPG/PNG/HEIC/WebP → `imageToPdf` one-page PDF,
  size-reduced to ~900KB) AND a **forgiving subject trigger** (subject like
  "Invoices" routes attachments to intake without `@maia`; skips structured
  commands / ticket replies w/ TKT-#### in subject). Multi-PDF already worked.
- ALL of #274–#281 merged to main (verified 2026-06-04).
- ✅ Migrations APPLIED by user: `20260604_invoice_on_hold.sql` AND
  `20260605_vendor_doc_extraction.sql` ("Success. No rows returned").
- ✅ **BUG FIXED (PR #282, 2026-06-05): bulk PDF invoice email created only ONE draft.**
  ROOT CAUSE: `invoice_intake_drafts` had a partial UNIQUE index on
  `gmail_message_id` ALONE (`..._gmail_msg_uniq`), but `handleInvoiceIntake`
  inserts one row PER attachment with the same message id → PDF #1 inserted,
  PDFs #2..N hit 23505 and were swallowed as 'skipped' in the per-PDF try/catch.
  Proven on live data: 56/56 recent emails → exactly 1 draft each. NOT a trigger
  or attachment-parsing problem (#281 confirmed deployed; collectAttachments
  recurses fine; a.size always set). FIX: migration
  `20260605_invoice_intake_per_attachment_uniq.sql` adds `gmail_attachment_id`,
  drops the per-email index, new unique on `(gmail_message_id,
  coalesce(gmail_attachment_id,''))`; intake stamps attachment id + skips only
  already-drafted attachments (incremental recovery); + per-email/attachment
  logging; + `POST /api/admin/invoices/intake/reprocess {messageId,force?}`.
  ⏳ PENDING: merge #282 + USER must hand-apply the migration in Supabase, THEN
  reprocess Karen's lost email by its Gmail message id to create the drafts.

## CINC vendor-write — VERIFIED writable (CINC_API.md has full bodies)
- ACH+W-9+1099: `PATCH /management/1/vendors/vendor` (only VendorID required).
- COI+PDF: `PATCH /vendors/vendorInsuranceUpdateByteArray` (File=base64, InsuranceId=type).
- License: `POST /vendors/vendorLicense`.
- Reads/aggregator + push helpers already built in `lib/integrations/cinc.ts`:
  getVendorInsurances, getVendorLicenses, listVendorInsuranceTypes,
  getVendorComplianceStatus, createVendorLicense, updateVendorInsuranceFile.
- `/vendor/{id}/accounts` = per-assoc GL mapping, NOT banking (banking on GET /vendors).

## NEXT BUILD (not started) — COI validation phase, then push UI, then audit
1. **COI validation**: extract additional-insured entities + each policy expiry;
   verify not-expired AND lists **PMI Top Florida Properties, 1031 Ives Dairy
   Road Suite 228, Miami FL 33179** AND the job's **association** (property
   address from CINC `/associations/addresses` or unit addr minus unit #).
2. **MATCH FUZZY for BOTH name AND address** — insurers misspell/shorten the
   PMI name and association name too. Normalize + expand abbreviations
   (Rd↔Road/Ste↔Suite/FL↔Florida) + edit-distance; anchor on street#+ZIP+core
   name tokens; when name mangled lean on address (& vice-versa); fail only on
   genuine absence or clearly-different anchor, NEVER a typo.
3. **Invalid COI → all three**: flag+warn(red) + **block** compliant/release +
   **auto-draft correction email** with exact additional-insured wording.
4. **Audit (both)**: compliance **panel** on ticket + **`/admin/vendor-compliance`** page (RAG per vendor).
5. Then: COI/license **push UI** ("→ CINC" for coi/license), then **Paola's
   vendor-procurement-in-WO** workflow (emails from WO via service@, RFE upload
   links, estimate comparison, board-approval report).

## ⚠️ Merge discipline (bit us 3×)
PRs here are **squash-merged**. Commits pushed to a branch *after* the squash
get stranded (not in main). Push ALL commits before merging; if a later commit
strands, cherry-pick it onto a fresh branch off main. Docs commits stranded
repeatedly this session.
