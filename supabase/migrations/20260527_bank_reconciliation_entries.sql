-- =====================================================================
-- 20260527_bank_reconciliation_entries.sql
--
-- Per-(assoc, bank_account, transaction-date) ledger that powers the
-- /admin/reconciliation page. Replaces Isabela's manual Google-Sheet
-- bank reconciliation workflow.
--
-- Two source kinds:
--   - source='cinc'      → auto-synced from CINC /invoicePayments by a
--                          cron job. Updated in place when CINC changes
--                          (status changes, voids, etc.).
--   - source='manual'    → entered by Isabela for bank activity CINC
--                          doesn't track (assessment income, auto-debits,
--                          interest, transfers, etc.).
--
-- Reconciled state, notes, and the "invoice attached" link are editable
-- regardless of source. Only the structural columns (amount, vendor,
-- bank, dates) are locked on CINC-sourced rows so the cron's source of
-- truth isn't accidentally overwritten by a UI edit.
--
-- ALTER TABLE / CREATE TABLE statements are idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.bank_reconciliation_entries (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope: every row lives in exactly one (assoc, bank account) bucket.
  association_code            text        NOT NULL,
  bank_account_id             bigint      NOT NULL,                       -- CINC BankAccountID
  bank_account_description    text,                                       -- denormalised for CSV export so deleted bank accounts still render

  -- Source — drives whether the cron can update structural fields.
  source                      text        NOT NULL CHECK (source IN ('cinc', 'manual')),

  -- Provenance (cinc rows only).
  cinc_invoice_id             bigint,                                     -- CINC InvoiceID
  cinc_payment_id             text,                                       -- CINC payment id if exposed (some endpoints return numeric, some string)

  -- Spreadsheet columns (matches Isabela's format).
  effective_date              date        NOT NULL,                       -- when the transaction hit the bank
  customer                    text,                                       -- association display name; defaults to assoc code if not set
  vendor_payee                text,
  description                 text,                                       -- "Description of invoice"
  invoice_number              text,
  amount                      numeric(14,2) NOT NULL,                     -- signed: positive = inflow, negative = outflow
  paid_type                   text,                                       -- ACH / Check / Online / Auto-debit / etc.
  additional_notes            text,
  invoice_attached_url        text,                                       -- link to the PDF in Drive or Supabase storage
  running_balance             numeric(14,2),                              -- "South State Bank _acc1956" column — computed at view time, but cached here for CSV export consistency
  pmi_coordinator_notes       text,

  -- Reconciliation state.
  reconciled_at               timestamptz,                                -- NULL = not yet reconciled
  reconciled_by               text,                                       -- email of staff who checked it

  -- Audit.
  entered_by                  text        NOT NULL,                       -- email; 'maia-cron' for CINC-sourced rows
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- Idempotency on CINC source: one row per (cinc_payment_id) so cron
-- re-runs don't duplicate. Partial index because cinc_payment_id is
-- NULL for manual entries.
CREATE UNIQUE INDEX IF NOT EXISTS bank_rec_cinc_payment_uniq
  ON public.bank_reconciliation_entries (cinc_payment_id)
  WHERE cinc_payment_id IS NOT NULL;

-- Fallback dedupe for CINC-sourced rows when payment_id isn't exposed:
-- (cinc_invoice_id, amount, effective_date) shouldn't collide for the
-- same invoice's payments (CINC doesn't split a single payment across
-- the same day twice for the same amount in practice).
CREATE UNIQUE INDEX IF NOT EXISTS bank_rec_cinc_invoice_dedupe
  ON public.bank_reconciliation_entries (cinc_invoice_id, amount, effective_date)
  WHERE source = 'cinc' AND cinc_payment_id IS NULL;

-- Page-load index: the reconciliation page always queries by
-- (assoc, bank_account, date range).
CREATE INDEX IF NOT EXISTS bank_rec_assoc_account_date_idx
  ON public.bank_reconciliation_entries (association_code, bank_account_id, effective_date DESC);

-- Quick filter for "not yet reconciled".
CREATE INDEX IF NOT EXISTS bank_rec_unreconciled_idx
  ON public.bank_reconciliation_entries (association_code, bank_account_id)
  WHERE reconciled_at IS NULL;

-- ── Data-API exposure (REQUIRED — Supabase removes auto-grants on
-- new public.* tables effective 2026-10-30; see supabase/migrations/
-- _TEMPLATE_new_table.sql for the canonical pattern). ───────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_reconciliation_entries
  TO anon, authenticated, service_role;

-- ── Row-level security ──────────────────────────────────────────────
ALTER TABLE public.bank_reconciliation_entries ENABLE ROW LEVEL SECURITY;

-- Staff persona handles everything via supabase-admin (service_role
-- bypasses RLS), but the explicit policy keeps the intent reviewable.
DROP POLICY IF EXISTS "service_role_all_bank_reconciliation_entries" ON public.bank_reconciliation_entries;
CREATE POLICY "service_role_all_bank_reconciliation_entries"
  ON public.bank_reconciliation_entries FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
