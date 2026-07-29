-- =====================================================================
-- 20260729_board_member_certifications.sql
--
-- Florida DBPR board-education / certification tracking, per board member.
--
-- Two document types are tracked (either satisfies "on file"):
--   * education_certificate  — the DBPR Certificate of Completion for the
--     state board-education course (§718.112(2)(d)4.b Fla. Stat. condos /
--     §720.3033 HOAs). This is the one that carries a validity window.
--   * certification_form     — the signed "I have read the declaration /
--     bylaws" Board Member Certification Form.
--   * continuing_education   — an annual continuing-ed course certificate.
--
-- Initial-certificate validity is derived from the association type at read
-- time (NOT stored): condo/coop 7 years, HOA 4 years, from certificate_date,
-- provided board service is uninterrupted (service_interrupted resets it).
--
-- One row per uploaded document; a member accumulates rows over the years
-- (initial + annual continuing ed). CREATE TABLE is instant; idempotent.
-- =====================================================================

-- ── Table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.board_member_certifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code   text NOT NULL,
  board_member_id    uuid,                       -- association_board_members.id (nullable: a self-upload is matched by email if the row is gone)
  board_member_name  text,
  board_member_email text,
  doc_type           text NOT NULL DEFAULT 'education_certificate'
                       CHECK (doc_type IN ('education_certificate','certification_form','continuing_education')),
  certificate_date   date,                        -- issuance / completion date on the certificate
  storage_key        text,                        -- path within the association-documents bucket
  filename           text,
  mime_type          text,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected')),
  uploaded_via       text NOT NULL DEFAULT 'staff' CHECK (uploaded_via IN ('staff','self')),
  uploaded_by        text,
  ai_summary         text,
  reviewed_by        text,
  reviewed_at        timestamptz,
  review_note        text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS board_member_certifications_assoc_idx
  ON public.board_member_certifications (association_code);
CREATE INDEX IF NOT EXISTS board_member_certifications_member_idx
  ON public.board_member_certifications (board_member_id);

-- ── Per-member service tracking (drives the validity window) ─────────
ALTER TABLE public.association_board_members
  ADD COLUMN IF NOT EXISTS service_start_date  date,
  ADD COLUMN IF NOT EXISTS service_interrupted boolean NOT NULL DEFAULT false;

-- ── Data-API exposure (REQUIRED — new table) ─────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_member_certifications
  TO anon, authenticated, service_role;

-- All access goes through supabaseAdmin (service role, bypasses RLS); the
-- table must never be exposed to anon/authenticated data reads.
ALTER TABLE public.board_member_certifications ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
