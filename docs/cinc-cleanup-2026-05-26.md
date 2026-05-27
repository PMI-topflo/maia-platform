# CINC Chart-of-Accounts Cleanup Report

**Prepared:** 2026-05-26
**Audience:** Jonathan (CINC accounting)
**Scope:** 24 associations verified against board-approved budget screenshots (PVV pending — budget not yet allocated in CINC)
**Source:** Live CINC budget endpoint per association, compared line-by-line against the budget structure provided by Fabio

> **For Claude sessions:** when the user says "revise all chart of accounts, they are fixed," re-run [scripts/dump-association-gl.ts](../scripts/dump-association-gl.ts) `--filtered` for each association below and verify the items in the per-association action lists have been resolved. Items resolved → strike them in this file (or move to a "Resolved" section). Items still present → report back. See [memory: cinc-cleanup-revisit](~/.claude/projects/-Users-fabio/memory/cinc_cleanup_revisit.md) for the full revision workflow.

---

## Verified associations (25 total — 24 verified, 1 pending)

ABBOTT, KGA, BHB, CHV, ESSI, FIFTH, GVH, GK7, LFA, LCLUB, MACO, MANXI, ONE, **PVV (pending)**, SP, SHORE, VPCI, VPCII, VPC5, VPREC, WBP, WBPA, KANE, ISLAND, DELA

---

## 🔥 Top priority — six-figure reclassifications

These accounts have substantial real spending posted with no budget allocation. They need investigation and likely reclassification into proper expense categories:

| Assoc | GL# | Description | Actual spend | Notes |
|---|---|---|---|---|
| **VPREC** | 54-5141-00 | Project Work | **$532,097.02** | Largest single uncategorized number. Likely capital improvements posted without allocation. |
| **DELA** | 50-5100-00 | **Prior Mgmt - Unknown Items** | **$131,995.55** | Catch-all from prior-management transition. Reclassify into actual expense lines. |
| **VPCI** | 54-5141-00 | Project Work | $135,116.89 | Same VP-pattern as VPREC. |
| **VPCII** | 54-5141-00 | Project Work | $63,022.72 | Same VP-pattern. |
| **VPC5** | 54-5141-00 | Project Work | $54,046.76 | Same VP-pattern. |
| **LCLUB** | 90-9100-00 | Contingency | $21,791.65 | Separate from budgeted 80-8030 Contingency Expenses. Consolidate. |
| **DELA** | 50-5099-00 | Loan Interest | $24,645.82 | No budget. |
| **ONE** | 50-5060-00 | Administrative Fees | $5,790.70 | No budget — recurring? |

**VP-family pattern**: All four VP-prefix associations (VPCI, VPCII, VPC5, VPREC) post heavy Project Work activity with $0 budget. WBPA does NOT — so it's not a platform-wide issue, it's a VP-specific convention. Recommend a board conversation on whether this is intentional (capital reserves draw) or needs budget allocation.

---

## 🔥 High priority — semantic mismatches (account means different things in screenshot vs CINC)

These are the **most dangerous** because Karen would pick the wrong account thinking it means something else:

| Assoc | GL# | Screenshot says | CINC says |
|---|---|---|---|
| **GK7** | 63-5455-00 | BackFlow Test | **"Irrigation Water"** |
| **MANXI** | 58-5813-00 | Utilities - Internet | **"Utilities - Cable TV"** |
| **MACO** | 50-5200-00 | Annual SUNBIZ renewal | Generic "Misc Expenses Reimbursement" |

**Recommendation:** Rename in CINC to match the screenshot's specific meaning. ChartIDs stay the same — just update the display name.

---

## 🔥 High priority — duplicate accounts in CINC

Accounts with the same or nearly-identical purpose, both in the dropdown — risk of inconsistent categorization:

| Assoc | GL# A | GL# B | Issue |
|---|---|---|---|
| **SP** | 58-5812-00 Trash/Recycling Contract ($5,000 budget) | 64-5300-00 Trash/Recycling Contract ($500 budget) | Same description, different IDs. **Consolidate to one.** |
| **GK7** | 64-5810-00 Fire Safety Inspection ($300 budget, $0 actual) | 64-5830-00 Fire & Safety Inspections ($0 budget, **$604.86 actual**) | Activity going to unbudgeted variant. Consolidate. |
| **SHORE** | 64-5810-00 Fire Safety Inspection ($1,000 budget, $0 actual) | 64-5830-00 Fire & Safety Inspections ($0 budget, **$419.88 actual**) | Same pattern as GK7. Consolidate. |

---

## ⚠️ Medium priority — description typos in CINC

These will be visible to Karen exactly as typed:

| GL# | Affected associations | Current label | Should be |
|---|---|---|---|
| 64-5800-00 | ABBOTT, KGA, BHB, CHV, GVH, GK7, LFA, MACO, MANXI, SHORE, VPREC, WBP, WBPA | "Janitorial  Service" *(double space)* | "Janitorial Service" |
| 50-5007-00 | CHV | "Annual Corporate **Filling**" | "Annual Corporate Filing" |
| 50-5015-00 | ESSI | "**Cirtificate**" | "Certificate" |
| 64-5753-00 | GK7, SHORE | "Electric Repairs/Lights/**ect**" | "Electric Repairs/Lights/etc" |
| 61-6135-00 | ONE | "Gate/Door **Acess** R&M" | "Gate/Door Access R&M" |
| 58-5520-00 | PVV | "**sewer**" *(lowercase)* | "Sewer" |
| 50-5035-00 | ONE | "Licenses**. **Taxes & Permits" *(period instead of comma)* | "Licenses, Taxes & Permits" |
| 54-5120-00 | PVV | "Annual Corporate **Filling**" | "Annual Corporate Filing" |

**The Janitorial double-space appears in 13 of 24 associations** — looks like one global CINC template error that propagated. Possibly fixable in one place.

---

## ⚠️ Medium priority — chronic label mismatches

These don't change account meaning but cause confusion:

| GL# | Issue |
|---|---|
| **50-5001-00** | CINC labels this "Portal/Software" universally. Many association screenshots call it "Mgmt Misc" or "Mgmt Misc - Portal Fee" (GVH, GK7, LFA, MACO, SP, SHORE, VPC5, VPREC, WBP). The screenshots seem to reflect a more accurate description of what's actually billed. |
| **MACO 50-5081-00** | CINC: "Meeting Expense" / Screenshot: "Annual Election Meeting" |
| **MACO 58-5530-00** | CINC: "Backflow" / Screenshot: "Annual Backflow Inspection" |
| **ONE 60-6005-00** | CINC: "Management Misc" / Screenshot: "Software /Portal Fee" |

---

## ⚠️ Missing accounts (screenshot expects, CINC doesn't have)

| Assoc | GL# | Description | Action |
|---|---|---|---|
| **KANE** | 50-5055-00 | Janitorial | Either **add the account**, or document that 63-5420 "Cleaning" is the canonical janitorial bucket for KANE. Karen needs clarity. |
| **VPCII** | 63-5403-00 | Tree Removal and Planting | Account exists in CINC but $0/$0. User highlighted this in screenshot — needs **budget allocation**. |
| **VPCI** | 64-5770-00 | Roof Repair | Screenshot allocates $2,000 budget; CINC shows $0/$0. **Enter budget in CINC**. |

---

## ⚠️ Significant over-budget lines (visibility — Jonathan may know about these already)

| Assoc | GL# | Description | Budget | Actual | Over by |
|---|---|---|---|---|---|
| **MANXI** | 54-5100-00 | Legal General | $20,000 | $34,990 | $14,990 |
| **MANXI** | 64-5820-00 | Fire Panel Maint/Repairs | $21,500 | $28,226 | $6,726 |
| **MANXI** | 63-5410-00 | HVAC Repairs | $10,500 | $17,695 | $7,195 |
| **VPREC** | 52-5085-00 | Misc Admin Expense | $7,000 | $26,201 | **$19,201** |
| **VPREC** | 64-5790-00 | Building Maint/Repair | $3,000 | $25,500 | **$22,500** |
| **WBPA** | 52-5045-00 | Insurance Expense | $135,000 | $146,797 | $11,797 |
| **WBPA** | 50-5152-00 | Acct/Audit/Tax | $500 | $2,825 | $2,325 (5.6×) |
| **DELA** | 52-5225-00 | Insurance Umbrella | $3,000 | $13,626 | $10,626 (4.5×) |
| **DELA** | 52-5230-00 | Insurance Financing | $5,000 | $20,331 | $15,331 (4×) |
| **ONE** | 61-6145-00 | HVAC R&M | $5,000 | $7,910 | $2,910 |
| **ONE** | 61-6135-00 | Gate/Door Acess R&M | $1,000 | $2,878 | $1,878 |

**DELA's insurance lines** especially — three insurance categories materially under-estimated. May indicate premium increases since budget was set.

---

## ⚠️ Budget value discrepancies — VPCI

VPCI is the one association where the screenshot included dollar amounts. Several lines have **different budget values in CINC vs the screenshot** — looks like screenshot is from a proposed/older budget that wasn't entered in CINC:

| GL# | Description | Screenshot | CINC |
|---|---|---|---|
| 50-5000-00 | Mgmt Contract | $9,000 | $9,360 |
| **52-5045-00** | Insurance Expense | **$175,000** | **$100,000** |
| 52-5410-00 | Venetian Rec Assoc Dues | $232,304.15 | $229,844.15 |
| 58-5810-00 | Termite/Pest Control | $11,000 | $8,500 |
| 58-5817-00 | Cable TV & Internet | $75,400 | $82,000 |
| 64-5790-00 | Building Maint/Repair | $15,000 | $5,000 |
| 64-5830-00 | Fire & Safety Inspections | $600 | $2,100 |

**Reconcile which budget is current** — board and Karen are likely operating from different numbers.

---

## ⚠️ Under-budgeted associations (broad pattern)

These associations have so many unbudgeted-but-active lines that the budget allocation looks incomplete:

| Assoc | Visible lines after filter | Lines with actual but $0 budget |
|---|---|---|
| **PVV** | **1 line** (only Mgmt Contract has activity) | Entire budget needs allocation |
| **ISLAND** | 17 | 6 (including Mgmt Contract at $0 budget!) |
| **KANE** | 14 | 6 |
| **DELA** | 29 | 5 (plus the $131K Prior Mgmt bucket) |

PVV is the worst — chart of accounts has no allocations at all. ISLAND and KANE have their most-used lines (Mgmt Contract!) unbudgeted.

---

## ⚠️ Payroll budgeted but not posted — VPREC

| GL# | Description | Budget | Actual |
|---|---|---|---|
| 53-5300-00 | Payroll Office | $64,896 | $0 |
| 53-5310-00 | Payroll Maintenance & Janitorial | $56,100 | $0 |

$120K of payroll allocated but no posted spending. Either VPREC payroll runs through a different system/account, or payroll hasn't been posted yet. Worth confirming.

ONE also has `51-5100-00 Payroll Expense` at $0/$0 — if ONE has employees, this needs attention.

---

## 🔎 Other notable extras (real activity, no budget — likely needing reclassification or budget)

| Assoc | GL# | Description | Actual |
|---|---|---|---|
| ABBOTT | 64-5752-00 | General Maintenance / Repair | $1,796.16 |
| BHB | 64-5795-00 | Plumbing | $3,287.50 |
| BHB | 54-5471-00 | Locksmith Expenses | $548.91 |
| MACO | 50-5010-00 | Postage - Mailings | $30.00 |
| ONE | 60-6065-00 | Chute Cleaning Contract | $1,794.00 |
| WBPA | 64-5455-00 | Irrigation Water | $9,014.02 |
| VPCII | 63-5400-00 | Landscape/Grounds Contract | $1,400.00 (with $0 budget!) |
| SHORE | 50-5200-00 | Misc Expenses Reimbursement | **-$3,462.83** ← negative actual (credit/reversal worth verifying) |

---

## Per-association action lists (concise)

### ABBOTT
- Fix double-space "Janitorial  Service" (64-5800-00)
- Decide: reclassify $1,796 on 64-5752, or budget it

### BHB
- Fix double-space "Janitorial  Service"
- Reclassify or budget unbudgeted Plumbing ($3,288) and Locksmith ($549)

### CHV
- Fix "Annual Corporate **Filling**" typo (50-5007-00 → "Filing")
- Fix double-space "Janitorial  Service"

### DELA
- **🚨 Reclassify $131,995 from `50-5100 Prior Mgmt - Unknown Items` into proper expense lines** (priority)
- Adjust insurance budgets — Umbrella & Financing under-estimated 4–5×
- Budget the $24K Loan Interest and $6.6K Mgmt Contract that are posting unbudgeted

### ESSI
- Fix "**Cirtificate**" typo (50-5015-00 → "Certificate")
- Allocate budget for Video/Data, Quickbooks Payments Fee, Taxes, Elevator Repairs, Equipment Rental, Roof Paint (6 lines at $0/$0)

### FIFTH
- No action needed — cleanest association in the audit

### GVH
- Fix double-space "Janitorial  Service"
- Address 50-5001 label drift if "Mgmt Misc" is more accurate than "Portal/Software"

### GK7
- **🚨 Critical: 63-5455 says "Irrigation Water" but is used as "BackFlow Test" — rename**
- **🚨 Consolidate Fire Safety: 64-5810 vs 64-5830 — pick one, retire the other**
- Fix "ect" typo (64-5753) → "etc"

### LFA
- Fix double-space "Janitorial  Service"
- Allocate budget for Property Taxes, Meeting Expense, Parking Lot Rent if needed

### LCLUB
- **🚨 Reclassify $21,792 from `90-9100 Contingency` into either `80-8030 Contingency Expenses` (which has $48,940 budget) or specific expense lines**
- Otherwise clean

### MACO
- **🚨 Rename 50-5200 from "Misc Expenses Reimbursement" → "Annual SUNBIZ renewal"** (or similar)
- Rename 50-5081 "Meeting Expense" → "Annual Election Meeting"
- Rename 58-5530 "Backflow" → "Annual Backflow Inspection"
- Fix double-space "Janitorial  Service"

### MANXI
- **🚨 Critical: 58-5813 says "Utilities - Cable TV" but is used as "Utilities - Internet" — rename**
- Address major budget overruns (Legal, Fire Panel Maint, HVAC Repairs)
- Fix double-space "Janitorial  Service Contract"
- Reclassify $1,356 on Security/Courtesy Patrol (unbudgeted extra)

### ONE
- **Rename 60-6005 from "Management Misc" → "Software /Portal Fee"**
- Fix "Acess" typo (61-6135) → "Access"
- Fix "Licenses**.** Taxes & Permits" punctuation (50-5035)
- **🚨 Reclassify $5,790 from 50-5060 Administrative Fees** (or allocate budget)
- Reclassify $1,794 from 60-6065 Chute Cleaning
- Decide on 51-5100 Payroll Expense — if ONE has employees, allocate

### PVV
- **🚨 Entire budget needs allocation in CINC** (currently no budget data at all)
- Fix lowercase "sewer" (58-5520-00) → "Sewer"
- Annual Corporate "Filling" typo also present here (54-5120)

### SP
- **🚨 Consolidate duplicate Trash/Recycling Contract (58-5812 vs 64-5300)**
- 50-5001 label drift ("Portal/Software" vs "Mgmt Misc")

### SHORE
- **🚨 Consolidate Fire Safety: 64-5810 vs 64-5830 (same pattern as GK7)**
- **Verify negative actual on 50-5200 (-$3,462.83) — credit or reversal**

### VPCI
- **🚨 Reconcile budget values with screenshot — Insurance, Mgmt Contract, Venetian Rec, etc. don't match**
- **🚨 Reclassify $135K Project Work**
- Budget the $2,025 Loan Interest, $611 Legal Collections

### VPCII
- **🚨 Reclassify $63K Project Work**
- **Allocate budget for 63-5403 Tree Removal and Planting** (highlighted by user)
- Budget the $6,077 Loan Interest, $171 Meeting Expense, $1,400 Landscape activity

### VPC5
- **🚨 Reclassify $54K Project Work**
- 50-5020 Postage & Printing slightly over budget ($150 → $203)

### VPREC
- **🚨 Reclassify $532K Project Work** — biggest single number in the audit
- Address $19K and $22K overruns on Misc Admin and Building Maintenance
- Reclassify $10K unbudgeted Plumbing
- Confirm $120K Payroll allocation status — budgeted but no posting
- Fix double-space "Janitorial  Service"

### WBP
- Fix double-space "Janitorial  Service"
- Decide on $462 Misc Reimbursement and $700 Janitorial (unbudgeted)

### WBPA
- **🚨 Reclassify $9,014 from 64-5455 Irrigation Water** (or allocate budget)
- Adjust Insurance budget (over by $11.8K)
- Acct/Audit/Tax massively over ($500 → $2,825) — was an audit larger than expected?
- Fix double-space "Janitorial  Service"

### KANE
- **🚨 Add `5055-00 Janitorial` account or document that 63-5420 Cleaning is canonical**
- Budget Mgmt Contract (posting $2,850 unbudgeted), Office Expense, Misc Admin Expense, Termite, Telephone, Security (6 unbudgeted lines)

### ISLAND
- **🚨 Budget Mgmt Contract** ($0 budget, $2,850 actual is unusual)
- Allocate budgets for Portal/Software, Setup Fee, Licenses, Pool Management, Plants/Sod (5 more unbudgeted lines)

---

## What's NOT in this report (deliberately)

- **Reserve / Special Assessment accounts** — filtered out of the dropdown by design. Funded via the upcoming bank-account picker, not via GL selection.
- **Lines with $0 budget AND $0 actual** — chart-of-accounts entries that aren't being used. If you ever need one in the dropdown, allocate $1 in CINC and it appears.
- **PVV detailed audit** — pending budget allocation in CINC.

---

**Once Jonathan completes the renames and reclassifications, no code change is needed on the MAIA side** — the dropdown updates automatically (live from CINC, cached 30 min). Just refresh.
