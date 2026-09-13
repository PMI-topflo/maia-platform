-- Karen ticks each "CHECKR TENANT CHECKR.COM" bank debit against the oldest
-- receipt not yet ticked (the bank line carries no order id). 2026-09-13.
ALTER TABLE public.checkr_receipts ADD COLUMN IF NOT EXISTS bank_debited_at timestamptz;
ALTER TABLE public.checkr_receipts ADD COLUMN IF NOT EXISTS bank_debited_by text;
NOTIFY pgrst, 'reload schema';
