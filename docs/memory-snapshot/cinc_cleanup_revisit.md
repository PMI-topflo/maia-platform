---
name: cinc-cleanup-revisit
description: "How to handle the user's \"revise all chart of accounts, they are fixed\" trigger — re-verify all 25 associations against the audit report after Jonathan applies fixes."
metadata: 
  node_type: memory
  type: project
  originSessionId: 2de989d8-bf0b-45df-b06b-54975bad691c
---

# CINC chart-of-accounts re-verification workflow

**Trigger phrase:** "revise all chart of accounts, they are fixed" (or close variants like "the chart of accounts is fixed", "Jonathan finished the cleanup").

**Source of truth report:** [docs/cinc-cleanup-2026-05-26.md](../../../Documents/GitHub/maia-platform/docs/cinc-cleanup-2026-05-26.md) — full list of items Jonathan was asked to fix, organized per-association.

**Why:** On 2026-05-26 Fabio audited all 25 association budgets in CINC vs. board-approved budget screenshots. Found typos, duplicate accounts, semantic mismatches, missing accounts, and large unbudgeted activity. The cleanup report went to Jonathan. After Jonathan applies the fixes, this workflow re-verifies that they landed.

**How to apply:**

1. **Read the cleanup report** at `docs/cinc-cleanup-2026-05-26.md`. It has a per-association action list. That's your checklist.

2. **For each association in the list (25 total):**
   ```bash
   npx tsx scripts/dump-association-gl.ts <CODE> --filtered
   ```
   Compare the live output to the action items in the report.

   Association codes (in audit order):
   ABBOTT, KGA, BHB, CHV, ESSI, FIFTH, GVH, GK7, LFA, LCLUB, MACO, MANXI, ONE, **PVV**, SP, SHORE, VPCI, VPCII, VPC5, VPREC, WBP, WBPA, KANE, ISLAND, DELA.

3. **PVV is special**: had NO budget allocated on 2026-05-26 (only 1 line returned, just Mgmt Contract). On revisit, expect PVV to now have a full budget. Run the full diff against the screenshot Fabio sent (extract from session transcript or re-ask) the first time PVV passes.

4. **Specific things to confirm fixed**:
   - **Description typos**: re-grep for "Janitorial  Service" (double space), "Cirtificate", "Filling" (in Corp Filing context), "Acess", "ect" suffix, lowercase "sewer". None should appear anywhere across all 25 dumps.
   - **Semantic renames**: GK7 63-5455 should say "BackFlow Test" (not Irrigation Water); MANXI 58-5813 should say "Utilities - Internet" (not Cable TV); MACO 50-5200 should say "Annual SUNBIZ renewal" (not Misc Expenses Reimbursement).
   - **Duplicate consolidations**: SP should have one Trash/Recycling line (not two); GK7 + SHORE should have one Fire Safety line each (not two).
   - **Large unbudgeted reclassifications**: VPREC 54-5141 Project Work, DELA 50-5100 Prior Mgmt - Unknown Items, the LCLUB 90-9100 Contingency $21K, etc. should now show $0 actual (reclassified into proper expense lines) OR have explicit budget allocation.
   - **Missing accounts**: KANE should now have a Janitorial account, OR Cleaning (63-5420) should be confirmed canonical.

5. **Report back to user** with one of:
   - **"All clear"** if everything resolved. Then the next step is unblocking [[invoice-payment-source]] (task #6, bank-account picker) and A1 (GL expense item push).
   - **"Per-assoc residuals"** table if anything remains. Format: `ASSOC | Item | Status` where status = Fixed / Still present / Partially fixed.

6. **Update the report file** after the re-verification — strike (or move to a "Resolved 2026-XX-XX" section) the items confirmed fixed. Keep the file as a living audit trail.

7. **Do NOT** modify any code, migrations, or filter logic during this revisit unless the report finds the filter itself needs adjustment (unlikely — the filter is in [[invoice-gl-dropdown-rules]] and is stable). Code work resumes only after the cleanup is verified.

**Filter recap** (so re-verification expectations match):
- Visible in dropdown = `firstDigit >= 5 AND firstDigit <= 9` AND `(budget > 0 OR |actual| > 0)` AND NOT `/\breserve|special\s*assess/i`
- See [[invoice-gl-dropdown-rules]] for the full rule.

Related: [[invoice-payment-source]], [[invoice-gl-dropdown-rules]], [[next-session-priorities]].
