-- Phone number on pmi_staff so the Twilio webhook can identify which
-- inbound SMS/WhatsApp/voice calls originated from a staff member.
-- Used by the explicit ticket-create intent in app/api/webhook to gate
-- "open a ticket to <Name>" requests to staff only.
--
-- Stored as digits-only (last 10 digits) so we match consistently
-- against Twilio's E.164 input regardless of formatting on entry.

ALTER TABLE public.pmi_staff
  ADD COLUMN IF NOT EXISTS phone_digits text;

CREATE INDEX IF NOT EXISTS pmi_staff_phone_digits_idx
  ON public.pmi_staff (phone_digits)
  WHERE phone_digits IS NOT NULL;

COMMENT ON COLUMN public.pmi_staff.phone_digits IS
  'Last 10 digits of the staff member''s phone number (no formatting). Used by the Twilio webhook to identify staff senders.';
