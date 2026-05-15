-- =====================================================================
-- pmi_staff.alt_emails
-- Free-form list of additional login emails for a staff member, on top
-- of email + personal_email. Used so a staffer can log in via name-
-- derived aliases (jane@pmitop.com, jane.doe@topfloridaproperties.com,
-- etc.) without juggling two columns.
--
-- The verify-otp + session hydration + Control Panel "my tasks"
-- filter all consult this list, so any value here is treated as a
-- legitimate login identifier for that staff row.
-- =====================================================================
ALTER TABLE public.pmi_staff
  ADD COLUMN IF NOT EXISTS alt_emails text[] NOT NULL DEFAULT '{}'::text[];

-- Generic GIN index for fast `<value> = ANY(alt_emails)` lookups via
-- the array operators. Used by the login resolver on every OTP send.
CREATE INDEX IF NOT EXISTS idx_pmi_staff_alt_emails
  ON public.pmi_staff USING gin (alt_emails);
