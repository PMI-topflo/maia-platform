---
name: invoice-process-rework
description: AP invoice intake process rework (PR
metadata: 
  node_type: memory
  type: project
  originSessionId: c35ddde2-be05-4020-9cf7-5b48340de70b
---

**PR #267 (2026-06-03)** reworked the AP invoice intake flow (`/admin/invoices`). Six changes:
1. **Auto-save on confirm** — confirming a field's green check in EDIT mode persists current values + checklist (no separate Save). `valuesPatch()` helper in InvoiceIntakeQueue.tsx; `persistChecklist(next, {includeValues})`.
2. **"Transfer to Push"** is Pending review's only forward action (renamed from "Mark ready"); CINC push stays on the Ready-to-push tab; Karen's control renamed "Return to team". Workflow: staff confirm in Pending → Karen emailed → Karen pushes/edits/returns.
3. **PDF block-on-fail** — push route now `normalizePdf(buf, {targetBytes: 700_000})` and BLOCKS before `createInvoice` if base64 > 1,000,000 (so no PDF-less CINC invoice). `app/api/admin/invoices/intake/[id]/push/route.ts`.
4. **Drive mirror at Transfer-to-Push** (in the intake PATCH route via `mirrorDraftToDrive`) + surfaces the real error to the UI.
5. **Double-pay HARD-BLOCK** — push blocks same vendor+amount+association in last 60 days REGARDLESS of invoice number; **Karen-only override** (pushAnyway, enforced server-side via `trustedDomainVariants(KAREN_EMAIL)`).
6. **Re-attach** — `POST /intake/[id]/reattach-cinc` + "📎 Re-attach PDF to CINC" button on pushed cards; fixes CINC invoices already pushed without a PDF.

**Root causes found (forensics via live CINC + Supabase, both have keys locally):**
- **PDF not attaching**: old push NEVER normalized at push time — it only checked stored size and SILENTLY SKIPPED attach if >1MB. Phone-photo check requests (multi-MB) → CINC invoice with 0 attachments (e.g. CINC 16272 Michele $300).
- **Drive mirror** (TRUE ROOT CAUSE, from the prod error): **"Service Accounts do not have storage quota."** A service account owns NO Drive storage, so creating a file it would OWN always fails — **sharing the folder does NOT fix it** (that was a wrong guess; scope was also wrong). `GOOGLE_SERVICE_ACCOUNT_JSON` IS set in prod (verified). **Fix = PR #268** (`lib/drive-invoice-mirror.ts`): supports (A) **domain-wide delegation** — set env `GOOGLE_DRIVE_IMPERSONATE`=a Workspace user email; mirror acts AS that user via JWT subject → file owned by them, existing My Drive folder works (requires authorizing the SA client-id for the drive scope in Workspace Admin); or (B) **Shared Drive** — put folder in a Shared Drive + add SA as member (already supported via supportsAllDrives; set `INVOICE_INTAKE_DRIVE_FOLDER_ID`). PR #267 already switched scope drive.file→full drive. Folder default id `1EFtayKzeg5zRtYvshQ8vHPUpNOv93O4m`. The pushed-card now shows the action result INLINE near the buttons (was only at card bottom → looked dead).
- **normalizePdf failed in Vercel prod (CONFIRMED + FIXED, PR #269):** worked locally (23.7MB→0.03MB) but prod returned raw 22.6MB → "PDF too large" on re-attach. Cause: `@napi-rs/canvas`/`pdfjs-dist`/`sharp` were only TRANSITIVE deps (via pdf-parse/next) AND the canvas native `.node` binary (`@napi-rs/canvas-linux-x64-gnu`) loads via a dynamic platform-require that Next file-tracing can't follow → binary missing from the function → createCanvas threw → fell back to original. Fix #269: promote the 3 to DIRECT deps (pinned) + `outputFileTracingIncludes` in next.config for `/api/admin/invoices/**` + `/api/maia-email/**` (include `@napi-rs/canvas*` + `pdfjs-dist`) + surface normalize note in the 413 (`[compressor: …]`).
- **CINC 16272 PDF FIXED manually (2026-06-03):** I attached the locally-normalized 0.03MB PDF directly via CINC API (`PUT /management/1/associations/InvoiceAttachmentsBase64`, body `{InvoiceID,FileName,File:base64}`, Bearer from client_credentials) → ImageId 55291, FileName "BHB Michele Sorrentino May Compensation $300.pdf". Have CINC creds locally (CINC_CLIENT_ID/SECRET).
- **Drive `unauthorized_client`** (as of last test): DWD not yet recognized — most likely wrong Client ID in Workspace Admin (must be SA numeric OAuth2 client_id, not email), scope must be exactly `https://www.googleapis.com/auth/drive`, or propagation delay (5–30 min). GOOGLE_DRIVE_IMPERSONATE=billing@topfloridaproperties.com is set in Vercel prod; billing@ must have edit access to the INVOICE TO INPUT folder.
- **MAIA draft 48 cleaned up:** was a duplicate 2nd-email intake of Michele $300 mislinked to CINC 16271 (Miriam $160) — set to rejected + cinc_invoice_id nulled via Supabase REST. Pushed count 10→9; Michele shows once (draft 50→16272). NOTE possible separate Miriam dup: 16226 (#invMay29) AND 16271 (#May) both Miriam $160 — unverified.
  (`vercel` project linked locally as pmi-top-flo/maia-platform.)
- **"Duplicate"**: NOT a CINC double-pay (verified: 16271=Miriam $160 w/PDF, 16272=Michele $300 no-PDF). It was a MAIA-side dup: two emails for Michele's $300 comp → two drafts (#48 inv "May", #50 inv "May Compensation") both pushed; guard missed because it keyed on invoice number + PAID ledger only. Also draft #48 is mislinked to CINC 16271 (Miriam's) — a data inconsistency worth a manual look.

**File-compression coverage (PR #270):** unified `normalizeUpload()` (lib/pdf-normalize.ts) runs on every server-side upload. The ONLY gaps were the 4 browser **signed-URL direct-upload** paths (browser PUTs raw to Supabase Storage, server only records metadata): association documents (`upload_complete`), safety reports, insurance COIs, work-order photos. Fixed with `lib/normalize-stored-file.ts` (download → normalizeUpload → overwrite in place if smaller; best-effort) wired into all 4 completion handlers. WO-photo size limit now checks the COMPRESSED size. When adding a NEW signed-URL upload, call `normalizeStoredFile()` in its completion handler.

See [[invoice_gl_dropdown_rules]], [[invoice_payment_source]]. CINC ledger sign conventions + push details in `docs/SESSION-HANDOFF.md`.
