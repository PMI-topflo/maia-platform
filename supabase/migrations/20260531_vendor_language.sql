-- =====================================================================
-- 20260531_vendor_language.sql
-- Vendors + their crew mostly speak Spanish. Capture a preferred language
-- so MAIA sends links/messages in their language and the upload page is
-- localized — while durable records (ticket reports) are stored in English
-- (canonical-English rule; original is kept alongside).
-- Idempotent.
-- =====================================================================

alter table public.vendor_employees
  add column if not exists preferred_language text not null default 'en';

alter table public.recurring_services
  add column if not exists office_language text not null default 'en';

NOTIFY pgrst, 'reload schema';
