-- Work-order payment lifecycle. When Paola adds an invoice to a work order it
-- becomes "ready_for_payment"; when that invoice is pushed to CINC (paid) the
-- WO is closed and marked "paid". Orthogonal to the work `status` so a WO can
-- be e.g. resolved AND ready_for_payment. Idempotent.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS payment_state text,   -- null | 'ready_for_payment' | 'paid'
  ADD COLUMN IF NOT EXISTS paid_at      timestamptz;

NOTIFY pgrst, 'reload schema';
