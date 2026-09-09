// =====================================================================
// lib/owner-lookup.ts
//
// Shared, co-owner-safe replacement for the many places that used to
// `.maybeSingle()` an `owners` query by unit/account. Real bug, confirmed
// 2026-09-09 (lib/lease-packet.ts, MANXI 706 "1125 Digital LLC & Rodrigo
// Campos"): a co-owned unit has one `owners` row PER OWNER, and BOTH
// `account_number` and `unit_number` identify the ACCOUNT/UNIT, not the
// individual owner -- `.maybeSingle()` throws PGRST116 on the common case
// of more than one owner, and most callers swallowed that into a silent
// `null`, so a co-owned unit's email/ledger/ACH/compliance flow quietly
// found nobody. See CLAUDE.md's "Never .maybeSingle() a query against
// owners" convention.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

export interface OwnerRow {
  id: string
  firstName: string | null
  lastName: string | null
  entityName: string | null
  emails: string | null
  phone: string | null
  phone2: string | null
  unitNumber: string | null
  address: string | null
  associationName: string | null
  accountNumber: string | null
}

const COLS = 'id, first_name, last_name, entity_name, emails, phone, phone_2, unit_number, address, association_name, account_number'

function toOwnerRow(r: Record<string, unknown>): OwnerRow {
  return {
    id: String(r.id),
    firstName: (r.first_name as string | null) ?? null,
    lastName: (r.last_name as string | null) ?? null,
    entityName: (r.entity_name as string | null) ?? null,
    emails: (r.emails as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    phone2: (r.phone_2 as string | null) ?? null,
    unitNumber: (r.unit_number as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    associationName: (r.association_name as string | null) ?? null,
    accountNumber: (r.account_number as string | null) ?? null,
  }
}

/** Every `owners` row matching an account/unit — NOT maybeSingle(). Matches
 *  `unit_number`, `account_number`, or `account_number` against the
 *  association-prefixed guess (`${associationCode}${account}`) — the same
 *  three-way match convention already established in
 *  lib/lease-packet.ts/lib/cinc-sync.ts, since callers hold the unit
 *  identifier in whichever of these forms it came from, and a VPCI-style
 *  account carries a building-letter prefix a bare unit_label alone can't
 *  reproduce. `excludePrevious` defaults to true (the `status.neq.previous,
 *  status.is.null` convention most existing callers already used) — pass
 *  `false` only where a caller genuinely needs to include a previous/
 *  archived owner too. */
export async function findOwnerRows(
  associationCode: string,
  account: string,
  opts?: { excludePrevious?: boolean },
): Promise<OwnerRow[]> {
  const accountGuess = `${associationCode}${account}`.toUpperCase()
  let q = supabaseAdmin.from('owners').select(COLS)
    .eq('association_code', associationCode)
    .or(`unit_number.eq.${account},account_number.eq.${account},account_number.eq.${accountGuess}`)
  if (opts?.excludePrevious !== false) q = q.or('status.neq.previous,status.is.null')
  const { data } = await q
  return (data ?? []).map(toOwnerRow)
}

export interface MergedOwner {
  /** Every co-owner's name joined with " & " (entity name where set, else
   *  first + last), e.g. "1125 Digital LLC & Rodrigo Campos". */
  name: string | null
  firstEmail: string | null
  /** Every valid email across every co-owner, deduped — for a recipient
   *  list where every owner should be notified, not just the first. */
  allEmails: string[]
  phone: string | null
  phone2: string | null
  /** Unit-level fields — identical across co-owner rows for the same
   *  account in practice, so just the first non-empty value found. */
  unitNumber: string | null
  address: string | null
  associationName: string | null
  accountNumber: string | null
}

/** Merges multiple co-owner rows into the single-owner shape most callers
 *  of the old `.maybeSingle()` pattern actually consumed. Null only when
 *  there are no matching rows at all (same as the old "not found" case). */
export function mergeOwnerRows(rows: OwnerRow[]): MergedOwner | null {
  if (!rows.length) return null
  const name = rows
    .map(o => o.entityName?.trim() || [o.firstName, o.lastName].filter(Boolean).join(' ').trim())
    .filter(Boolean).join(' & ') || null
  const allEmails = [...new Set(
    rows.flatMap(o => (o.emails ?? '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(e => e.includes('@'))),
  )]
  const firstOf = (pick: (o: OwnerRow) => string | null) => rows.map(pick).find(Boolean) ?? null
  return {
    name,
    firstEmail: allEmails[0] ?? null,
    allEmails,
    phone: firstOf(o => o.phone),
    phone2: firstOf(o => o.phone2),
    unitNumber: firstOf(o => o.unitNumber),
    address: firstOf(o => o.address),
    associationName: firstOf(o => o.associationName),
    accountNumber: firstOf(o => o.accountNumber),
  }
}

/** Convenience: findOwnerRows() + mergeOwnerRows() in one call, for the
 *  common case of "give me one merged owner view for this account." */
export async function findMergedOwner(
  associationCode: string,
  account: string,
  opts?: { excludePrevious?: boolean },
): Promise<MergedOwner | null> {
  return mergeOwnerRows(await findOwnerRows(associationCode, account, opts))
}
