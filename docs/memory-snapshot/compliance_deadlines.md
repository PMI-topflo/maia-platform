---
name: compliance-deadlines
description: How building/unit compliance deadlines are sourced (document-extracted vs rule-based) and the upload→AI-read-deadline feature.
metadata: 
  node_type: memory
  type: project
  originSessionId: c35ddde2-be05-4020-9cf7-5b48340de70b
---

**Feature (requested 2026-06-03):** every building/unit compliance item should have a file upload that AI-reads & stores the deadline ("last date to file without penalty," Sunbiz-style).

**KEY DESIGN — two deadline sources** (user clarified):
1. **Document-sourced** — the deadline is printed on the uploaded doc → AI reads it. (insurance COI → expiration; safety/inspection report → inspection date + next-due.)
2. **Rule-sourced** — the deadline is a statute/online rule, NOT on the doc → defined in code. e.g. **Sunbiz: May 1 deadline · $400 non-waivable late fee after May 2 · administrative dissolution 4th Friday of September.** (Already coded in `lib/sunbiz.ts`: `dueDate`, `dissolutionDate`, `SUNBIZ_LATE_FEE_USD`.)

**Phase 1 — SHIPPED in PR #271:**
- `lib/compliance-extraction.ts` → `extractComplianceDates(buf, kind: 'insurance'|'safety')` — Claude Haiku PDF/vision, mirrors `lib/invoice-extraction.ts`. Returns {effectiveDate, expirationDate, inspectionDate, nextDueDate, issuer, confidence, note}.
- `POST /api/admin/associations/[code]/compliance-extract` {storage_path, kind, mime_type} — downloads from `association-documents` bucket, normalizeUpload, extracts.
- InsuranceManager / SafetyManager: upload-on-file-select (caches the upload meta so onSubmit doesn't re-upload), call extract, **pre-fill** expiration / next-due with a confidence note. Staff ALWAYS confirm (never auto-saved).
- Sunbiz screen: explicit "Last date to file without penalty: <May 1> · $400 after · dissolution <4th Fri Sept>" banner.

**Phase 2 — NOT built (needs migrations + the user applies them by hand):**
- Upload + AI extraction for **unit-level** items (unit_leases, unit_insurance HO-6, unit_certificate_of_use, unit_violations — currently Drive-indexer-only) and **vendor** COI/license expiry (currently just on-file booleans).
- A generalized **deadline-rules** config so rule-based deadlines (municipal CoU/permit renewal cycles, Sunbiz) are defined once + applied; optional `last_date_without_penalty` / `penalty_after` / `final_date` columns.

Compliance model: association-level = `association_insurance_policies` (expiration_date + coi upload), `association_safety_inspections` (next_due_date + report upload, per-building via building_label), `association_annual_reports` (Sunbiz, rule-based May 1). Daily cron `app/api/cron/compliance-alerts` (06:00 ET) alerts 60–90d out. Compliance UIs at `/admin/cinc-sync/[code]/insurance` + `/safety`, `/admin/sunbiz`.
