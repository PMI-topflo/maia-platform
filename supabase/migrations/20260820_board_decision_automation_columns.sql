-- =====================================================================
-- 20260820_board_decision_automation_columns.sql
--
-- Two additive columns backing the automatic under_review -> approval_sent
-- transition (PR6 of the fully-automatic application pipeline):
--
-- document_review_rounds.purpose — the OLD manual per-document review round
-- and the NEW automatic signature-reminder round both live in this table but
-- mean different things and must never be confused by "pick the newest round
-- for this application" logic (the reminder cron does exactly that). Existing
-- rows are all the old kind, hence the default.
--
-- esign_documents.application_id — board_decision letters used to be
-- resolved back to an application via association_code + unit_ref + a
-- status-filtered lookup (lib/esign.ts), a real race once a unit can have two
-- in-process applications (e.g. a lease application and a later additional-
-- occupant one). Nullable and only populated going forward — existing rows
-- keep resolving the old way.
--
-- ALTER TABLE ADD COLUMN IF NOT EXISTS is idempotent; both tables already
-- exist, so no GRANT changes are needed (the 2026-10-30 auto-grant cutoff
-- only affects brand-new tables).
-- =====================================================================

ALTER TABLE public.document_review_rounds
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'document_review'
    CHECK (purpose IN ('document_review', 'signature_reminder'));

ALTER TABLE public.esign_documents
  ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES public.listing_applications(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS esign_documents_application_id_idx
  ON public.esign_documents (application_id);

NOTIFY pgrst, 'reload schema';
