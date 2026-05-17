-- =====================================================================
-- association_documents
--
-- Catalogue of all documents MAIA tracks for an association: governing
-- docs, financials, board minutes, insurance policies (with the full
-- Florida-specific taxonomy), structural integrity reports, vendor COIs,
-- etc. Each row is either a file uploaded to Supabase storage OR a
-- Google Drive link (so staff don't have to re-upload everything that
-- already lives in Drive).
--
-- PDF uploads get text-extracted on insert and the result is cached in
-- extracted_text so the MAIA chat handler can include relevant content
-- in Claude's system prompt when an owner asks a question. Drive links
-- are tracked but not auto-scanned today — that requires Drive API
-- read access which is a separate piece of work.
--
-- The companion Supabase storage bucket is named `association-documents`
-- (NOT public). Staff routes write to it via the service-role client;
-- nobody reads it directly from the browser, downloads go through a
-- signed-URL API endpoint.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.association_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code   text NOT NULL,

  -- Free-form category key matching the taxonomy in
  -- lib/association-documents.ts (CATEGORY_KEYS). Kept as text rather
  -- than an enum so we can add new categories without a migration.
  category           text NOT NULL,
  -- Optional finer label, e.g. for vendor COIs the vendor name, or for
  -- insurance the carrier / policy number. Free-form.
  subcategory        text,

  -- One of 'upload' (file lives in storage_path) / 'drive_link' (URL in
  -- drive_url) / 'note' (text-only knowledge nugget in notes).
  source             text NOT NULL CHECK (source IN ('upload', 'drive_link', 'note')),

  storage_path       text,   -- supabase storage object key (uploads)
  drive_url          text,   -- google drive URL (drive_link rows)
  filename           text NOT NULL,
  mime_type          text,
  file_size_bytes    bigint,

  -- Plain-text extracted from the file (PDFs only today). Used by the
  -- chat handler for RAG-style answers. Drive links and unsupported
  -- types leave this NULL; staff can still add a notes field that we
  -- surface to MAIA the same way.
  extracted_text     text,
  extraction_status  text NOT NULL DEFAULT 'pending'
                     CHECK (extraction_status IN
                       ('pending', 'extracting', 'done', 'failed', 'skipped', 'unsupported')),
  extraction_error   text,

  -- Insurance + dated docs: lets the UI flag policies about to expire
  -- and lets the chat handler tell owners "your wind policy was active
  -- as of <effective_date>". Both nullable for non-dated docs.
  effective_date     date,
  expiry_date        date,

  -- Free-form: lets staff jot a one-liner ("Renews Aug 2026, contact
  -- agent X") that MAIA can also pull into context.
  notes              text,
  uploaded_by_email  text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Per-association lookups dominate every query in the UI + chat path.
CREATE INDEX IF NOT EXISTS adocs_assoc_cat_idx
  ON public.association_documents (association_code, category);

-- For the future "renewing this month" dashboard. Predicate keeps the
-- index small since most documents have no expiry.
CREATE INDEX IF NOT EXISTS adocs_expiry_idx
  ON public.association_documents (expiry_date)
  WHERE expiry_date IS NOT NULL;

-- Keep updated_at fresh on every mutation. Trigger function matches the
-- pattern used elsewhere in this codebase.
CREATE OR REPLACE FUNCTION public.adocs_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS adocs_set_updated_at_trg ON public.association_documents;
CREATE TRIGGER adocs_set_updated_at_trg
  BEFORE UPDATE ON public.association_documents
  FOR EACH ROW EXECUTE FUNCTION public.adocs_set_updated_at();

-- =====================================================================
-- Storage bucket
--
-- Supabase doesn't let pure SQL migrations create storage buckets
-- (those live in a separate API). The API route that handles the first
-- upload calls supabase.storage.createBucket() defensively if the
-- bucket doesn't already exist — same pattern as the buyer-notification
-- route. No manual setup required.
-- =====================================================================
