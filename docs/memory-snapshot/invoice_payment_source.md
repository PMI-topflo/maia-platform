---
name: invoice-payment-source
description: How MAIA tells CINC which bank account (Operating / Reserve / Special Assessment) to pay an invoice from.
metadata: 
  node_type: memory
  type: project
  originSessionId: 2de989d8-bf0b-45df-b06b-54975bad691c
---

# Invoice payment source (bank account)

**Fact**: CINC's `POST /management/1/accounting/invoice` accepts a native `PayFromBankAccountID` field. Helper `createInvoice()` in [lib/integrations/cinc.ts:1077](lib/integrations/cinc.ts:1077) already takes it as `payFromBankAccountId`. Today nothing in MAIA sets it — every invoice goes with `0` and CINC defaults to operating.

**Why:** Some invoices must be paid from Reserve or Special Assessment bank accounts (board decision, capital projects, etc.), not Operating. Currently impossible to specify from MAIA — Karen would have to edit it in CINC after push.

**How to apply:**
- Bank-account catalog endpoint is `GET /management/1/banking/bankBalances?assocCode=...` (NOT `/associationBankAccounts` which 404s in our tenant — CINC_API.md was updated 2026-05-26).
- The response includes `BankAccountID`, `AccountDescription`, `CashAccountNumber`, `BankBalance`. The `Reserve` boolean is **broken** — returns `false` even for reserve accounts. Detect kind from `AccountDescription` text ("Operating" / "Reserve" / "Special Assessment") or from Cash GL prefix (10- = operating, 12- = reserve, 13- = likely SA per fund-accounting convention).
- Implementation task #6 (blocked on the 25-association GL verification). When shipping: also call `createInvoiceNote()` whenever Karen picks non-operating, with text like "Payment source: Reserve (selected by Karen via MAIA)" for board audit trail.

Related: [[invoice-gl-dropdown-rules]] — explains why reserve GL lines are filtered OUT of the expense dropdown (they're funding source, not expense category).
