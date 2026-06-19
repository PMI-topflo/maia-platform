---
name: invoice-gl-dropdown-rules
description: "Filter rules and product semantics for the GL account dropdown in MAIA's invoice intake card."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2de989d8-bf0b-45df-b06b-54975bad691c
---

# GL dropdown filter rules (invoice intake)

CINC's `/accounting/budget/association/{code}` returns the full chart of accounts (~120 lines per assoc). The dropdown Karen picks from filters down to expense GLs only via these rules:

1. **Expense-range GL number prefix (5–9)** — first digit of the GL number. Anything 1–4 is balance-sheet, revenue, or equity and must not appear.
2. **Has activity OR is on the always-include list** — `budget > 0` OR `|actual| > 0` OR description matches `/\bproject\s*work\b/i`. Drops dormant chart-of-accounts entries with no allocation, EXCEPT for Project Work (kept always).
3. **NOT a reserve / special-assessment line** — description must not match `/\breserve|special\s*assess/i`.

**Project Work exception (added 2026-05-27)**: VP-family associations (and possibly others) intentionally run `54-5141 Project Work` at $0 budget by board design. Activity is paid from the reserve bank account via the bank-account picker. Without the always-include exception, the GL line would be hidden until activity accumulates — too late to categorize the first invoice. ABBOTT uses the variant `50-5141 Project Work` (different department prefix); the description-based regex catches both.

**Orphan-account exclusions (added 2026-05-27)**: Accounts that hold real actual but aren't in any association's board-approved budget. Karen should never pick these — they're cleanup targets for Jonathan/Shemaiah. Filter pattern: `/\bprior\s*m(gm)?t\b|\bprior\s*management\b|\badministrative\s*fees?\b/i`.
- **`Prior Mgmt - Unknown Items`** — DELA only, ~$131K historical actual from a management-company transition.
- **`Administrative Fees`** — ONE only as of 2026-05-27, $5,790 orphan; description not in ONE's 2026 approved budget. If another association legitimately uses this name later, the pattern needs narrowing.

Filter applied in [app/api/admin/cinc/budget/route.ts](app/api/admin/cinc/budget/route.ts) and mirrored in [scripts/dump-association-gl.ts](scripts/dump-association-gl.ts).

**Why rule 3 (no reserves):** Reserves and Special Assessments are a *funding-source* decision, not an expense category. Karen picks the expense GL (e.g. "Roof Repair") and chooses the bank account to pay from (Operating / Reserve / SA) — these are separate fields. See [[invoice-payment-source]].

**How to apply:** If a user budget screenshot includes a reserve line (e.g. ABBOTT's `90-9000-00 Reserve Transfer` was in the first screenshot), do NOT add it back to the dropdown. The bank-account picker handles funding source.

## Same GL number means different things per association

The chart of accounts is association-scoped. Example: `50-5060-00` is "Licenses/Permits/Fees" in ABBOTT but "Annual Corporate Filing" in KGA. The dropdown is already association-scoped — but be careful when reasoning across associations.
