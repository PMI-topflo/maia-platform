// =====================================================================
// lib/ticket-categories.ts
//
// Canonical list of ticket categories used for plain tickets (type=
// 'ticket'). Work orders (type='work_order') use work_order_type_name
// from CINC, not these — these cover everything else staff needs to
// route.
//
// The label is stored verbatim in tickets.ticket_category so the DB is
// self-describing for ad-hoc reporting. Re-ordering / adding entries
// is safe; renaming an existing one would leave old rows holding the
// old label (handle with a migration if/when that happens).
// =====================================================================

export interface TicketCategory {
  label: string         // stored in tickets.ticket_category as-is
  hint:  string         // shown next to the option to disambiguate
}

export const TICKET_CATEGORIES: TicketCategory[] = [
  { label: 'Resident Support',                    hint: 'Resident assistance' },
  { label: 'Violations & Compliance',             hint: 'Rule enforcement' },
  { label: 'Architectural Review (ARC/ACC)',      hint: 'Modification approvals' },
  { label: 'Financial & Billing',                 hint: 'Accounting matters' },
  { label: 'Security & Safety',                   hint: 'Security incidents' },
  { label: 'Vendor Management',                   hint: 'Vendor coordination' },
  { label: 'Insurance & Claims',                  hint: 'Claims/issues' },
  { label: 'Legal & Collections',                 hint: 'Attorney/legal matters' },
  { label: 'Communications',                      hint: 'Notices & announcements' },
  { label: 'Amenity Reservations',                hint: 'Clubhouse/pool/etc' },
  { label: 'Move-In / Move-Out',                  hint: 'Tenant/owner logistics' },
  { label: 'Parking & Towing',                    hint: 'Vehicle issues' },
  { label: 'Access Control',                      hint: 'Gate/cards/fobs' },
  { label: 'Utilities',                           hint: 'Utility-related concerns' },
  { label: 'Emergency Incidents',                 hint: 'Critical escalations' },
  { label: 'Technology / Systems',                hint: 'Software, internet, cameras' },
  { label: 'Concierge / Front Desk',              hint: 'Hospitality-type requests' },
]

/** Set of valid category labels — for server-side validation on PATCH/POST. */
export const TICKET_CATEGORY_SET: ReadonlySet<string> = new Set(
  TICKET_CATEGORIES.map(c => c.label),
)

export function isValidTicketCategory(value: unknown): value is string {
  return typeof value === 'string' && TICKET_CATEGORY_SET.has(value)
}
