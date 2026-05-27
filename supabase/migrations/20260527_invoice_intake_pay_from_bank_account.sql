-- =====================================================================
-- 20260527_invoice_intake_pay_from_bank_account.sql
--
-- Adds pay_from_bank_account_id to invoice_intake_drafts. Stores the
-- CINC BankAccountID Karen picked in the intake card so the push flow
-- can pass it through as PayFromBankAccountID on createInvoice (and
-- CINC routes the invoice to the right bank: Operating / Reserve /
-- Special Assessment).
--
-- NULL = no selection → CINC defaults to operating (BankAccountID 0).
-- See lib/integrations/cinc.ts listAssociationBankAccounts for how the
-- options are sourced (GET /banking/bankBalances).
--
-- ALTER TABLE ADD COLUMN IF NOT EXISTS is idempotent.
-- =====================================================================

ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS pay_from_bank_account_id bigint;

NOTIFY pgrst, 'reload schema';
