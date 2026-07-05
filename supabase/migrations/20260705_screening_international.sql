-- Adds international-package tracking to screening_subjects. Previously only
-- residential vs. commercial was distinguished; app_type === 'international'
-- applicants (the form already has a distinct "International" option) now
-- route to Checkr's International Basic package instead of the domestic
-- Essential one — see CHECKR_PACKAGE_INTERNATIONAL in .env.example.

ALTER TABLE public.screening_subjects ADD COLUMN IF NOT EXISTS is_international boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
