-- =====================================================================
-- 20260815_board_document_review.sql
--
-- The per-document board review pass, and the 30-day decision window it
-- opens.
--
-- Until now an application went from "documents uploaded" straight to the
-- approval letter, and "saved" was the only state a document had — nobody
-- could tell a file that had merely arrived from one somebody had actually
-- read. The board also had no way to say "this one is wrong, and here is
-- why" short of an email nobody could find later.
--
-- THE RULE THIS ENCODES (user direction, 2026-08-15, standard for every
-- association): the Board may decide up to 30 DAYS AFTER THE LAST REQUESTED
-- DOCUMENT IS RECEIVED. So the window cannot open while anything is still
-- outstanding — an unreceived document is not something the board can review.
-- =====================================================================

-- ── One decision per document, per application ───────────────────────
CREATE TABLE IF NOT EXISTS public.application_document_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid        NOT NULL,
  doc_key          text        NOT NULL,
  -- Per-applicant items are keyed doc_key#stakeholderId, exactly as na_items
  -- does, so one person's affidavit can be refused without touching another's.
  scope_key        text        NOT NULL,
  decision         text        NOT NULL,   -- approved | refused
  reason           text,                   -- required by the API when refused
  decided_by       text        NOT NULL,   -- the human, e.g. 'Walter Giles (Board President)'
  decided_by_role  text        NOT NULL,   -- board | onsite_manager | staff
  decided_at       timestamptz NOT NULL DEFAULT now(),
  round_id         uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_adr_decision CHECK (decision IN ('approved','refused')),
  CONSTRAINT chk_adr_role     CHECK (decided_by_role IN ('board','onsite_manager','staff'))
);
-- ANY ONE approver settles a document (user direction), so there is exactly
-- one live decision per scope_key — a later decision replaces the earlier one.
CREATE UNIQUE INDEX IF NOT EXISTS application_document_reviews_uniq
  ON public.application_document_reviews (application_id, scope_key);
CREATE INDEX IF NOT EXISTS application_document_reviews_app
  ON public.application_document_reviews (application_id, decided_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_document_reviews TO anon, authenticated, service_role;
ALTER TABLE public.application_document_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_application_document_reviews" ON public.application_document_reviews;
CREATE POLICY "service_role_all_application_document_reviews" ON public.application_document_reviews FOR ALL TO service_role USING (true);

-- ── One row per time staff send the review out ───────────────────────
CREATE TABLE IF NOT EXISTS public.document_review_rounds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid        NOT NULL,
  association_code text        NOT NULL,
  unit_label       text,
  token            text        NOT NULL,   -- one link, shared by every reviewer
  recipients       jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- [{name,email,role}]
  note             text,
  started_by       text,
  -- The 5-day nudge to sign the approval letter. Null until the window opens.
  last_reminder_at timestamptz,
  reminder_count   integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS document_review_rounds_token ON public.document_review_rounds (token);
CREATE INDEX IF NOT EXISTS document_review_rounds_app ON public.document_review_rounds (application_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_review_rounds TO anon, authenticated, service_role;
ALTER TABLE public.document_review_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_document_review_rounds" ON public.document_review_rounds;
CREATE POLICY "service_role_all_document_review_rounds" ON public.document_review_rounds FOR ALL TO service_role USING (true);

-- ── The window itself, on the application ────────────────────────────
-- Stamped the moment the last requested document is both received AND
-- decided. Kept as a column rather than recomputed on read so the date the
-- board was actually given cannot drift when a checklist is edited later.
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS board_window_opened_at timestamptz;
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS board_window_days integer NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.listing_applications.board_window_opened_at IS
  'When the last requested document was received and reviewed. The board decision deadline is this + board_window_days. Null while anything is still outstanding.';

NOTIFY pgrst, 'reload schema';
