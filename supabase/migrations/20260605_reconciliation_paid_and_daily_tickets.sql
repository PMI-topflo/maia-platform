-- =====================================================================
-- 20260605_reconciliation_paid_and_daily_tickets.sql
--
-- Reconciliation workflow (Item 2):
--   • bank_reconciliation_entries.paid_at / paid_by — Jonathan's "marked
--     paid in MAIA" stamp (distinct from reconciled_at/by). Marking an EFT
--     invoice paid also ticks the Rec box, but we keep a separate paid
--     stamp so the daily rollup can report "X reconciled · Y paid".
--   • tickets.recon_date — the day a daily reconciliation ticket belongs
--     to, so the 6 AM cron + the "Done" rollup can find/dedupe exactly one
--     ticket per staffer per day (partial unique index).
--
-- Idempotent: add-column-if-not-exists + create-index-if-not-exists.
-- =====================================================================

ALTER TABLE public.bank_reconciliation_entries
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by text;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS recon_date date;

-- One daily reconciliation ticket per (staffer, day). Partial so it only
-- constrains reconciliation tickets, never the rest of the tickets table.
CREATE UNIQUE INDEX IF NOT EXISTS tickets_recon_daily_uniq
  ON public.tickets (assignee_email, recon_date)
  WHERE recon_date IS NOT NULL;

NOTIFY pgrst, 'reload schema';
