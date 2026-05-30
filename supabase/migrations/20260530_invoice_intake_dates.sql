-- =====================================================================
-- 20260530_invoice_intake_dates.sql
--
-- Two cash-flow dates on the invoice intake draft:
--   due_date            — when the vendor expects payment (their terms).
--                         Maps to CINC's DueDate on push.
--   scheduled_pay_date  — when PMI PLANS to actually pay it. Lets staff
--                         defer a payment past its due date to a month
--                         with funds, and drives the reconciliation
--                         "Upcoming Payments" + EOM cash-flow timing.
--
-- Additive, nullable, idempotent.
-- =====================================================================

alter table public.invoice_intake_drafts
  add column if not exists due_date           date,
  add column if not exists scheduled_pay_date date;

NOTIFY pgrst, 'reload schema';
