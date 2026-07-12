-- service_visits.links_sent_at / links_sent_results — persist the result of
-- "Send crew links" (previously thrown away in a one-time browser alert())
-- so /admin/recurring-services can show whether/when the vendor's crew was
-- actually notified, instead of losing that the moment the page reloads.
ALTER TABLE public.service_visits ADD COLUMN IF NOT EXISTS links_sent_at timestamptz;
ALTER TABLE public.service_visits ADD COLUMN IF NOT EXISTS links_sent_results jsonb;
NOTIFY pgrst, 'reload schema';
