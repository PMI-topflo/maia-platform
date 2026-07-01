-- =====================================================================
-- 20260701_pre_registrations.sql
--
-- Pre-registration requests from callers/contacts NOT yet in the system.
-- When an unknown caller reaches MAIA (no registered phone), MAIA texts a
-- tokenized link to /pre-register/<token>; the person picks their role,
-- gives their name + request, and staff (PMI + Jonathan) are emailed so a
-- team member can follow up and add them to the system if needed.
--
-- All access is via the service-role admin client (public form posts to a
-- server route; staff read in admin). CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.pre_registrations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text,                               -- from the token (the number that called)
  persona      text,                               -- owner|tenant|buyer|board|vendor|agent|other
  full_name    text,
  email        text,
  association   text,                              -- free text (property / association, they may not know the code)
  unit         text,
  request      text,                               -- free-text: how MAIA/staff can help
  source       text NOT NULL DEFAULT 'voice',      -- voice|sms|whatsapp|web
  language     text,                               -- caller's language at request time
  status       text NOT NULL DEFAULT 'new',        -- new|contacted|added|dismissed
  handled_by   text,
  handled_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pre_registrations_status_idx
  ON public.pre_registrations (status, created_at DESC);
CREATE INDEX IF NOT EXISTS pre_registrations_phone_idx
  ON public.pre_registrations (phone);

-- ── Data-API exposure (REQUIRED for new tables, effective 2026-10-30) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pre_registrations
  TO anon, authenticated, service_role;
