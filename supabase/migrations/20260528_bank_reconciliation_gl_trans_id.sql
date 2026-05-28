-- =====================================================================
-- 20260528_bank_reconciliation_gl_trans_id.sql
--
-- Adds cinc_gl_trans_id to bank_reconciliation_entries. CINC's
-- /accounting/glTransactionsByDateAndAssocCode returns a stable
-- GLTransID per transaction — we use it as the primary dedupe key
-- when syncing all bank activity (not just MAIA-pushed invoice
-- payments). Replaces the (cinc_invoice_id, amount, effective_date)
-- fallback dedupe for the glTransactions sync path.
--
-- ALTER TABLE ADD COLUMN IF NOT EXISTS is idempotent.
-- =====================================================================

ALTER TABLE public.bank_reconciliation_entries
  ADD COLUMN IF NOT EXISTS cinc_gl_trans_id bigint;

-- One row per GLTransID — repeated cron runs upsert in place.
CREATE UNIQUE INDEX IF NOT EXISTS bank_rec_cinc_gl_trans_uniq
  ON public.bank_reconciliation_entries (cinc_gl_trans_id)
  WHERE cinc_gl_trans_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
