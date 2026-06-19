---
name: funds_check_income_model
description: "Cash-flow forecast must model assessment income cadence (monthly vs quarterly), not just bank balance minus bills"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8d7a3329-593a-40ca-9d6d-b7eb81f4120a
---

MAIA's invoice funds-check / cash-flow forecast must account for **assessment receivables (income)**, not only the current bank balance minus upcoming bills. Key domain facts:

- Associations collect owner assessments on different cadences: **some MONTHLY, some QUARTERLY**. The forecast must detect and project each association's cadence.
- There's a recurring **cash-flow crunch at end-of-month / beginning-of-next** (and **end-of-quarter** for quarterly associations) because bills come due *before* the assessment deposit lands. The forecast must surface this **low point**, not just an end-of-month balance.
- Approach shipped in **PR #361** (`lib/cash-flow-forecast.ts`): `detectIncomeProfile()` learns cadence + typical amount + landing day from 6 months of cash-GL deposits (deposits post as NEGATIVE DebitAmount in CINC); a dated timeline walks bills (by due date) + income (by cadence) + a typical-recurring-spend top-up, and reports `lowPoint`. **Supersedes PR #360** (flat due-date distribution).
- ⚠ Behaviour-driven — must be validated against real monthly + quarterly associations; detection keys off cash-GL deposit posting.
