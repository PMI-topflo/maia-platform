# Reconciliation screen — recurring estimates + Jonathan/Isabela workflow (2026-06-05)

Repo: ~/maia-platform. Screen: /admin/reconciliation (per association + month).
Components: app/admin/reconciliation/components/ReconciliationView.tsx;
routes under app/api/admin/reconciliation/*; engine lib/cash-flow-forecast.ts
(detectRecurring); upcoming feed app/api/admin/reconciliation/upcoming/route.ts.

## Stacked PR chain (merge IN ORDER; squash-merge, so push before merging)
- **#283** skip inter-account transfers in recurring estimates (INTERNAL_MOVEMENT_RE).
- **#284** key recurring estimates off the EXPENSE-side debit, not the cash-credit
  line (CINC mislabels a cash credit with the counterpart bank account name).
- **#285** Item 1: project recurring EFT payments into their real month (typicalDay +
  seenMonths on RecurringVendor) + dedup an estimate once a real EFT/scheduled
  payment of ±15% lands that month.
- **#286** Item 2: "To Pay in CINC" box + Mark Paid + daily reconciliation tickets.
  ⚠️ NEEDS MIGRATION applied by hand: 20260605_reconciliation_paid_and_daily_tickets.sql
  (bank_reconciliation_entries.paid_at/paid_by + tickets.recon_date + partial unique idx).

## Key finding — Crystal Hills "1950" mystery (RESOLVED, it's a CINC label bug)
GK7's operating ledger showed credits described "CSB - Cash Operating - 1950".
Account 1950 = **CHV (Crystal Hills V)**. These are GK7's OWN utility/insurance
payments (offset debit = GK7 Water/Sewer, Gas, Electricity 58-55xx, Insurance
52-5045) whose CASH-CREDIT line is mislabeled with CHV's bank account name.
CHV's ledger shows none of these → no money moved between associations; it's a
CINC description/funding-account label issue. ACTION FOR ISABELA/CINC: verify the
"Pay From Bank Account" on those GK7 payments is 6648 (GK7), not 1950 (CHV).

## CINC invoice lifecycle (VERIFIED) — no "mark Paid" API
PENDING APPROVAL → READY FOR PAYMENT → PAID. Writes: PUT approveInvoice,
POST approvedInvoices (→ Ready for Payment; helper postApprovedInvoice added to
cinc.ts), PUT voidInvoice. **There is NO API to set PAID** — Paid flips only when
CINC runs the actual check/EFT payment batch; the hourly bank-sync then reflects it.
So Jonathan's "Mark Paid" reconciles in MAIA + posts unsent MAIA drafts to
Ready-for-Payment; it never writes CINC Paid status.

## Workflow people
Isabela Lopez = ap@topfloridaproperties.com (Accounts Payable) — ticks Rec boxes.
Jonathan Mendez = ar@topfloridaproperties.com (Accounts Receivable) — pays EFT in CINC.
Daily recon ticket: one per staffer per day (tickets.recon_date), 6 AM ET cron
opens it, "✓ Done for today" rolls up per-association reconciled+paid counts +
resolves. Counts recomputed from ledger (reconciled_by/paid_by + ET date) = idempotent.

## NOT yet built / possible follow-ups
- Isabela's per-line "Rec" already exists; no per-association "Done" granularity
  (Done rolls up ALL associations she touched today — by design).
- Mark-Paid matches ledger rows by invoice_number+assoc; if CINC approved-unpaid
  isn't yet a ledger row it creates a manual one on the operating account.
