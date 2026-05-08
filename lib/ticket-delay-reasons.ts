// =====================================================================
// lib/ticket-delay-reasons.ts
// Canonical list of reasons a ticket's due date might be pushed.
// Each entry has a code (used for storage + reporting), a human label
// (shown in the dropdown), a category (UI grouping), and a bucket
// ('external' = non-controllable, 'internal' = controllable). The
// bucket distinction matters for KPI reporting: internal-bucket
// delays are the ones the team actually has agency over; external
// ones (vendors, owners, banks) shouldn't penalize them.
// =====================================================================

export type DelayBucket = 'external' | 'internal'

export interface DelayReason {
  code:     string
  label:    string
  category: 'Maintenance' | 'Financial' | 'Operations' | 'Internal'
  bucket:   DelayBucket
}

export const DELAY_REASONS: DelayReason[] = [
  // ── Maintenance (external) ──────────────────────────────────────────
  { code: 'vendor_availability',         label: 'Vendor availability / scheduling',         category: 'Maintenance', bucket: 'external' },
  { code: 'parts_pending',               label: 'Parts or materials pending',                category: 'Maintenance', bucket: 'external' },
  { code: 'owner_approval',              label: 'Owner approval required',                   category: 'Maintenance', bucket: 'external' },
  { code: 'board_approval',              label: 'Board approval required',                   category: 'Maintenance', bucket: 'external' },
  { code: 'tenant_access',               label: 'Tenant access not available',               category: 'Maintenance', bucket: 'external' },
  { code: 'permit_hoa_approval',         label: 'Permit / HOA approval required',            category: 'Maintenance', bucket: 'external' },

  // ── Financial (external) ────────────────────────────────────────────
  { code: 'owner_board_decision',        label: 'Owner / board decision pending',            category: 'Financial',   bucket: 'external' },
  { code: 'missing_documentation',       label: 'Missing invoice / documentation',           category: 'Financial',   bucket: 'external' },
  { code: 'banking_delay',               label: 'Banking / payment processing delay',        category: 'Financial',   bucket: 'external' },
  { code: 'charge_dispute',              label: 'Charge dispute / clarification needed',     category: 'Financial',   bucket: 'external' },
  { code: 'month_end_reconciliation',    label: 'Month-end / reconciliation process',        category: 'Financial',   bucket: 'external' },

  // ── Operations (external) ───────────────────────────────────────────
  { code: 'priority_reassigned',         label: 'Higher-priority emergency reassigned',      category: 'Operations',  bucket: 'external' },
  { code: 'waiting_internal_team',       label: 'Waiting on another internal team',          category: 'Operations',  bucket: 'external' },
  { code: 'multi_party_coordination',    label: 'Multiple parties coordination delay',       category: 'Operations',  bucket: 'external' },

  // ── Internal (controllable — these are the KPI signals) ─────────────
  { code: 'staff_capacity',              label: 'Staff workload / capacity delay',           category: 'Internal',    bucket: 'internal' },
  { code: 'followup_missed',             label: 'Follow-up missed / delayed response',       category: 'Internal',    bucket: 'internal' },
  { code: 'incorrect_initial_assessment', label: 'Incorrect initial assessment / rework',    category: 'Internal',    bucket: 'internal' },
]

const BY_CODE = new Map(DELAY_REASONS.map(r => [r.code, r]))

export function getDelayReason(code: string): DelayReason | undefined {
  return BY_CODE.get(code)
}

export function isValidDelayReasonCode(code: string): boolean {
  return BY_CODE.has(code)
}
