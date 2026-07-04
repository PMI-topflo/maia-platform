// =====================================================================
// lib/tenant-verification.ts
// Shared readiness logic for pre-registration triage Phase 2: a self-
// identified tenant needs a lease + board-approval-letter on file, plus
// either owner confirmation or staff-sourced documents, before they can be
// approved into association_tenants. Used by the staff/owner/tenant API
// routes so the status computation can't drift between them.
// =====================================================================

export type DocSource = 'tenant' | 'owner' | 'staff'
export type VerificationStatus = 'pending' | 'awaiting_owner' | 'ready' | 'approved' | 'rejected'

export interface TenantVerificationRow {
  lease_path: string | null
  lease_source: DocSource | null
  board_letter_path: string | null
  board_letter_source: DocSource | null
  owner_confirmed: boolean
  status: VerificationStatus
}

/** Recomputes the derived status from the row's current doc/confirm state.
 *  Never downgrades a terminal 'approved'/'rejected' status — those only
 *  change via an explicit staff/owner action, not this recomputation. */
export function computeStatus(row: TenantVerificationRow): VerificationStatus {
  if (row.status === 'approved' || row.status === 'rejected') return row.status
  const hasLease = !!row.lease_path
  const hasLetter = !!row.board_letter_path
  if (!hasLease || !hasLetter) return 'pending'
  const staffSourcedBoth = row.lease_source === 'staff' && row.board_letter_source === 'staff'
  if (staffSourcedBoth || row.owner_confirmed) return 'ready'
  return 'awaiting_owner'
}

export function isReadyToApprove(row: TenantVerificationRow): boolean {
  return computeStatus(row) === 'ready'
}
