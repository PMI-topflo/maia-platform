-- Personal phone number on pmi_staff so the Twilio webhook can identify
-- which inbound SMS/WhatsApp/voice calls originated from a staff member.
-- Used by the explicit ticket / work-order create intent in
-- app/api/webhook to gate "open a ticket to <Name>" requests to staff.
--
-- This is the staff member's PERSONAL mobile (the number they actually
-- text Maia from), not an office line. Stored as digits-only (last 10
-- digits) so we match consistently against Twilio's E.164 input
-- regardless of formatting on entry.

ALTER TABLE public.pmi_staff
  ADD COLUMN IF NOT EXISTS personal_phone_digits text;

CREATE INDEX IF NOT EXISTS pmi_staff_personal_phone_digits_idx
  ON public.pmi_staff (personal_phone_digits)
  WHERE personal_phone_digits IS NOT NULL;

COMMENT ON COLUMN public.pmi_staff.personal_phone_digits IS
  'Last 10 digits of the staff member''s PERSONAL mobile number (no formatting). Used by the Twilio webhook to identify staff senders for explicit ticket / work-order creation. Not an office line.';
