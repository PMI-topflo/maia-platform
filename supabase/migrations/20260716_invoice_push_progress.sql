-- =====================================================================
-- 20260716_invoice_push_progress.sql
--
-- Makes the invoice → CINC push crash-resumable (Path B durability, no
-- external workflow framework). Adds one column:
--
--   push_progress jsonb — records which post-createInvoice sub-steps
--   (expense_item, blank_line, pdf_attach, provenance_note,
--   board_approval, nonop_audit_note, drive_mirror) have completed, so a
--   retry of a half-finished push skips the ones already done instead of
--   re-creating a duplicate GL line / PDF / note.
--
-- No new status value is introduced: resume is detected purely by a
-- non-terminal draft already carrying a cinc_invoice_id (set the instant
-- createInvoice succeeds), so the draft stays in its existing "Ready to
-- push" tab and Karen just re-clicks Push to finish it.
--
-- See app/api/admin/invoices/intake/[id]/push/route.ts for the resume
-- logic. Idempotent.
-- =====================================================================

ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS push_progress jsonb;

NOTIFY pgrst, 'reload schema';
