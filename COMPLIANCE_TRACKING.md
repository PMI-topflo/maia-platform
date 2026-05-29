# Compliance Tracking — what we track & where the file lives

Canonical inventory of every **expiration-tracked** item in MAIA and the
decision of **where the actual document file lives**. Keep this in sync
when adding a new tracker.

## Storage principle

- **📦 In the system** (Supabase Storage, `association-documents` bucket) —
  association-level compliance/legal documents MAIA must *produce or cite*
  (estoppel certs, closing packages, board-liability proof, "is this
  allowed?" answers). Retrievable in-app via signed URL.
- **🗂 Drive only** — high-volume, per-unit operational documents already
  organized in the per-unit Google Drive folder tree by the indexer. We
  store the **Drive link + metadata + expiry**, not the bytes. Staff
  (Isabela) updates the link from the screen when a new file is placed in
  Drive.
- **🔀 Either** — staff chooses per upload: file into the system *or* a
  Drive link.
- **📝 Metadata only** — the date/fact matters, not a document.

> The association-level managers (Insurance, Safety) accept **both** an
> uploaded file *and* a Google Drive link. Upload when the file should be
> retrievable in-app; paste a Drive link when the file should stay in
> Drive. The "open" button prefers the uploaded file, falling back to the
> Drive link.

## Association-level → 📦 keep the full file in the system (or 🗂 link)

| What | Date field | Table | File location | Status |
|---|---|---|---|---|
| Master insurance policies (Property, GL, D&O, Fidelity, Flood, Windstorm, Workers' Comp, Umbrella, Equipment Breakdown, Ordinance & Law, Cyber) — COI | `expiration_date` | `association_insurance_policies` | 📦 `association-documents/<CODE>/insurance/…` **or** 🗂 `drive_url` | ✅ built (I3) |
| Structural-safety inspections — Milestone, SIRS, Wind Mitigation, Roof (report/study) | `next_due_date` | `association_safety_inspections` | 📦 `association-documents/<CODE>/safety/…` **or** 🗂 `drive_url` | ✅ built (I4) |
| Governing / financial / dated documents (declaration, bylaws, rules, budget, audit, minutes, licenses) | `expiry_date` | `association_documents` | 🔀 `upload` (📦 `storage_path`) **or** `drive_link` (🗂 `drive_url`) | ✅ built |

## Unit-level → 🗂 Drive only (track metadata + expiry; file stays in Drive)

| What | Date field | Table | File location | Status |
|---|---|---|---|---|
| Unit leases | `lease_end_date` | `unit_leases` | 🗂 `source_pdf_url` / `source_drive_file_id` | ✅ built |
| Per-unit insurance (HO-6) + wind-mit + appraisal | `expiration_date` | `unit_insurance` | 🗂 `source_pdf_url`, `wind_mitigation_url`, `appraisal_url` | ✅ built |
| City Certificate of Use / rental permits | `expiration_date` | `unit_certificate_of_use` | 🗂 `source_pdf_url` / `source_drive_file_id` | ✅ built |
| Violations (resolution deadline) | `resolution_due_date` | `unit_violations` | 🗂 `source_pdf_url` | ✅ built |

## Planned (not yet built)

| What | Date | Proposed location | Backlog |
|---|---|---|---|
| Vendor compliance — COI / W-9 / license | expiry per doc | 📦 system (today only `coi_on_file`/`w9_on_file` booleans) | I5 / I11 |
| Sunbiz annual report (due May 1) | filing date | 📝 metadata only — `associations.sunbiz_*` + `date_filed` exist | I8 |
| Reserve study age (lender 3-yr freshness) | `last_reserve_study_date` | 📦 study rides under safety/financial docs | I14 |
| D&O renewal workflow | tied to insurance expiry | 📦 the COI in insurance | I9 |

## How the daily cron + dashboard use this

- `app/api/cron/compliance-alerts/route.ts` scans (in order): leases,
  unit insurance, certificates of use, violations, association insurance,
  safety inspections — writing `compliance_alerts` rows. Association-level
  alerts use `account_number = association_code`.
- The staff dashboard control panel (`app/admin/components/ControlPanel.tsx`)
  surfaces two instruments: **Docs & Permits** (insurance + permits +
  dated documents, 120-day horizon) and **Inspections Due** (safety
  inspections, 180-day horizon). Each row shows a **📦/🗂 source chip** so
  staff can tell at a glance whether the file is retrievable in-app or
  lives only in Drive.

## `compliance_alerts.alert_type` values

`lease_expiring`, `lease_expired`, `insurance_expiring`, `insurance_expired`,
`violation_due`, `violation_overdue`, `cou_expiring`, `cou_expired`,
`assoc_insurance_expiring`, `assoc_insurance_expired`, `inspection_due`,
`inspection_overdue`.
