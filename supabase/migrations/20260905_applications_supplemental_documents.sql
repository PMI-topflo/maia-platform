ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS supplemental_documents jsonb NOT NULL DEFAULT '[]'::jsonb;
NOTIFY pgrst, 'reload schema';
