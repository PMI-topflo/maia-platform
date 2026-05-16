// =====================================================================
// lib/cinc-sync.ts
// Diff + apply for the /admin/cinc-sync importer.
//
// Builds a unit-by-unit and board-member-by-board-member comparison
// between CINC and MAIA so staff can verify alignment before clicking
// Apply. Owner inserts also write an `ownership_history` row with
// source='import' so the audit trail captures who imported what.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  listAssociationProperties,
  listAssociationBoardMembers,
  getAssociationMeta,
  type CincPropertyInfo,
  type CincBoardMember,
} from '@/lib/integrations/cinc'

// ─────────────────────────────────────────────────────────────────────
// Shared snapshots — used on both sides of the diff so the UI can render
// the comparison as a single row "what MAIA has" → "what CINC has".
// ─────────────────────────────────────────────────────────────────────

export interface OwnerSnapshot {
  account_number:  string | null
  unit_number:     string | null
  first_name:      string | null
  last_name:       string | null
  emails:          string | null
  phone:           string | null
  address:         string | null
}

export interface BoardSnapshot {
  name:        string | null
  email:       string | null
  role:        string | null
  phone:       string | null
}

// ─────────────────────────────────────────────────────────────────────
// Per-unit / per-board-member comparison rows
// ─────────────────────────────────────────────────────────────────────

export type OwnerStatus = 'insert' | 'update' | 'match' | 'only_in_maia'

export interface OwnerComparison {
  status:             OwnerStatus
  /** Stable identifier for selection / apply. Encodes both which side
   *  the row came from AND (for CINC rows) the name slot, since a
   *  single CINC PropertyInfo can carry two distinct name pairs in
   *  FirstName/LastName and FirstName1/LastName1 (entity + person, two
   *  spouses, etc.).
   *    "cinc:<PropertyID>:<slot>"  — CINC-sourced row (slot 0|1)
   *    "maia:<owners.id>"          — MAIA-sourced row (update / only_in_maia)
   */
  selection_key:      string
  /** Sort key for the UI — prefers CINC's PropertyHOID (e.g. "ABBOTT1"),
   *  falls back to MAIA's account_number, finally to unit_number. */
  account_number:     string | null
  unit_number:        string | null
  owner_number:       number | null
  /** stable upstream id if CINC carries the row */
  cinc_property_id:   number | null
  /** Which name slot inside the CINC PropertyInfo this snapshot
   *  represents (0 = FirstName/LastName, 1 = FirstName1/LastName1).
   *  Null for MAIA-only rows. */
  cinc_name_slot:     number | null
  /** local row id if MAIA carries the row */
  owners_id:          number | null
  maia:               OwnerSnapshot | null
  cinc:               OwnerSnapshot | null
  /** Only set on status='update'. Keyed by field, values are the
   *  before / after we'd write. Lets the UI highlight exactly which
   *  fields differ. */
  changes?:           Record<string, { current: string | null; proposed: string | null }>
}

export type BoardStatus = 'insert' | 'match' | 'only_in_maia'

export interface BoardComparison {
  status:                 BoardStatus
  cinc_board_member_id:   number | null
  abm_id:                 string | null
  maia:                   BoardSnapshot | null
  cinc:                   BoardSnapshot | null
}

// ─────────────────────────────────────────────────────────────────────
// Top-level preview
// ─────────────────────────────────────────────────────────────────────

export interface SyncPreview {
  assocCode:                string
  associationName:          string | null
  /** Authoritative unit count from /management/1/associations.
   *  associationWithProperty can return multiple rows per unit when
   *  CINC stores joint or historical owners, so this is the better
   *  number to surface. */
  cincNumberOfUnits:        number | null
  /** Raw count of PropertyInfo rows we got back — useful debug signal
   *  if it disagrees with cincNumberOfUnits. */
  cincPropertyRowsReturned: number
  /** After filtering to isCurrentOwner=true; no dedup so joint owners
   *  show up as separate rows. */
  cincOwnerRowsConsidered:  number
  cincBoardCount:           number
  maiaActiveOwners:         number
  maiaActiveBoard:          number

  owners:                   OwnerComparison[]
  board:                    BoardComparison[]
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function lower(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/** Returns one snapshot per distinct owner name pair on the property.
 *
 *  Confirmed by probe (scripts/probe-cinc-homeowners.ts ABBOTT): a CINC
 *  PropertyInfo has TWO Address rows that play different roles:
 *
 *  - PROPERTY ADDRESS  (OwnerAddress=false, AddressTypeDescription
 *                       "Property Address"):
 *      Carries the actual OWNER NAMES, both slots —
 *      FirstName/LastName  = primary owner (typically the person)
 *      FirstName1/LastName1= secondary owner (typically the entity,
 *                            often only the LastName1 is populated for
 *                            an LLC). Also carries the multi-email
 *                            field (comma-joined) and the contact phone.
 *
 *  - OFFSITE ADDRESS   (OwnerAddress=true, AddressTypeDescription
 *                       "Owner's Offsite Address"):
 *      Carries the BILLING/MAILING info — the street where to send
 *      paper notices, plus a single billing name + a single billing
 *      email. It does NOT carry the dual name pair, so reading names
 *      from here loses the person+entity pairing.
 *
 *  Previously this function picked OwnerAddress=true for everything,
 *  which meant CINC's "Owner 1 + Owner 2" data was invisible to MAIA
 *  and the diff would propose to overwrite the full multi-email field
 *  with the single billing email.
 *
 *  Now: names + email + phone come from PROPERTY ADDRESS, street comes
 *  from OFFSITE ADDRESS. Each returned snapshot carries its slot index
 *  (0 or 1) so the matcher can build a stable selection key. */
function snapshotsFromCincProperty(p: CincPropertyInfo): Array<{ slot: number; snap: OwnerSnapshot }> {
  const addresses = p.Address ?? []
  const propAddr  = addresses.find(a => !a.OwnerAddress) ?? null  // owner names + contact
  const offsite   = addresses.find(a =>  a.OwnerAddress) ?? null  // billing street
  const fallback  = addresses[0] ?? null

  // Names + email + phone — prefer property-address (dual-slot + multi-
  // email), fall back to offsite or the first row if CINC stores data
  // in a non-standard shape for this property.
  const nameSrc = propAddr ?? offsite ?? fallback
  // Street address — prefer offsite (the owner's mailing address, which
  // is what CINC's UI surfaces), fall back to property address.
  const streetSrc = offsite ?? propAddr ?? fallback

  if (!nameSrc && !streetSrc) {
    return [{
      slot: 0,
      snap: {
        account_number: p.PropertyHOID ?? null,
        unit_number:    p.UnitNo ?? null,
        first_name:     null, last_name: null, emails: null, phone: null, address: null,
      },
    }]
  }

  const street   = streetSrc ? ([streetSrc.StreetNumber, streetSrc.Address].filter(Boolean).join(' ').trim() || null) : null
  const rawPhone = nameSrc ? (nameSrc.MobilePhone || nameSrc.HomePhone || nameSrc.WorkPhone || null) : null
  // Normalize at the boundary — CINC stores phones in mixed formats
  // (raw digits, parenthesized, etc.) but we always want the E.164 form
  // (+1XXXXXXXXXX) in our DB so WhatsApp / SMS APIs can dial.
  const phone    = normalizePhone(rawPhone)
  const emails   = (nameSrc?.Email ?? '').trim().toLowerCase() || null

  const first1 = (nameSrc?.FirstName  ?? '').trim() || null
  const last1  = (nameSrc?.LastName   ?? '').trim() || null
  const first2 = (nameSrc?.FirstName1 ?? '').trim() || null
  const last2  = (nameSrc?.LastName1  ?? '').trim() || null

  const baseSnap = (first: string | null, last: string | null): OwnerSnapshot => ({
    account_number: p.PropertyHOID ?? null,
    unit_number:    p.UnitNo ?? null,
    first_name:     first,
    last_name:      last,
    emails,
    phone,
    address:        street,
  })

  const out: Array<{ slot: number; snap: OwnerSnapshot }> = []
  if (first1 || last1) out.push({ slot: 0, snap: baseSnap(first1, last1) })
  // Only emit secondary slot when it carries a name distinct from the
  // primary — CINC sometimes leaves the slot blank, sometimes duplicates
  // the primary; both should collapse to a single row.
  if ((first2 || last2) && nameKey(first1, last1) !== nameKey(first2, last2)) {
    out.push({ slot: 1, snap: baseSnap(first2, last2) })
  }
  // Edge case: both name pairs are empty — still emit one row so the
  // address/email/phone show up in the diff.
  if (out.length === 0) out.push({ slot: 0, snap: baseSnap(null, null) })
  return out
}

interface MaiaOwnerRow {
  id:               number
  cinc_property_id: number | null
  account_number:   string | null
  unit_number:      string | null
  first_name:       string | null
  last_name:        string | null
  entity_name:      string | null
  emails:           string | null
  phone:            string | null
  phone_2:          string | null
  address:          string | null
}

function snapshotFromMaiaOwner(r: MaiaOwnerRow): OwnerSnapshot {
  return {
    account_number: r.account_number ?? null,
    unit_number:    r.unit_number    ?? null,
    first_name:     r.first_name ?? r.entity_name ?? null,
    last_name:      r.last_name  ?? null,
    emails:         r.emails     ?? null,
    phone:          r.phone      ?? r.phone_2 ?? null,
    address:        r.address    ?? null,
  }
}

function nameKey(first: string | null | undefined, last: string | null | undefined): string {
  return `${(first ?? '').trim().toLowerCase()}|${(last ?? '').trim().toLowerCase()}`
}

function emailsContain(stored: string | null | undefined, candidate: string | null | undefined): boolean {
  const c = lower(candidate)
  if (!c) return true
  return (stored ?? '').toLowerCase().split(/[,;]/).map(s => s.trim()).includes(c)
}

/** Strip everything but digits — the only part that uniquely identifies
 *  a phone number across format variants. */
function phoneDigits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

/** Normalize a phone string to E.164 so the database stores a format
 *  WhatsApp / SMS APIs can dial. Defaults to +1 (US) for 10-digit
 *  inputs, the most common CINC representation. Anything else gets a
 *  leading "+" prepended if it doesn't already have one — preserves
 *  international numbers without guessing their country.
 *
 *  Never call this on user-facing snapshots without also keeping the
 *  digits-equal comparison; otherwise reformatting alone would look
 *  like a real change in the diff. */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = phoneDigits(raw)
  if (!digits) return null
  if (digits.length === 10)                                  return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1'))        return `+${digits}`
  return String(raw).trim().startsWith('+') ? String(raw).trim() : `+${digits}`
}

function phonesEqualByDigits(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = phoneDigits(a)
  const db = phoneDigits(b)
  if (!da || !db) return false
  return da === db
}

// ─────────────────────────────────────────────────────────────────────
// Preview
// ─────────────────────────────────────────────────────────────────────

export async function buildSyncPreview(assocCode: string): Promise<SyncPreview> {
  const code = assocCode.toUpperCase()

  const [meta, cincProperties, cincBoard] = await Promise.all([
    getAssociationMeta(code),
    listAssociationProperties(code),
    listAssociationBoardMembers(code),
  ])

  // CINC: keep ALL current-owner rows (joint owners come as separate
  // PropertyInfo rows with different OwnerNumber values). The UI lets
  // staff see every line per account number.
  const consideredProperties = cincProperties.filter(p => p.isCurrentOwner)

  // ── Load MAIA owner side ──────────────────────────────────────────
  const { data: maiaOwnersRaw } = await supabaseAdmin
    .from('owners')
    .select('id, cinc_property_id, account_number, unit_number, first_name, last_name, entity_name, emails, phone, phone_2, address')
    .eq('association_code', code)
    .or('status.neq.previous,status.is.null')

  const maiaOwners = (maiaOwnersRaw ?? []) as MaiaOwnerRow[]

  // Many-to-many maps. cinc_property_id / account_number can repeat
  // across joint-owner rows on our side too, so values are arrays.
  const maiaByCincId  = new Map<number, MaiaOwnerRow[]>()
  const maiaByAcct    = new Map<string, MaiaOwnerRow[]>()
  const maiaByUnit    = new Map<string, MaiaOwnerRow[]>()
  const maiaByNameKey = new Map<string, MaiaOwnerRow[]>()
  function push<K>(m: Map<K, MaiaOwnerRow[]>, k: K | null | undefined, v: MaiaOwnerRow) {
    if (k == null) return
    const arr = m.get(k as K) ?? []
    arr.push(v)
    m.set(k as K, arr)
  }
  for (const row of maiaOwners) {
    if (row.cinc_property_id != null) push(maiaByCincId, row.cinc_property_id, row)
    if (row.account_number)           push(maiaByAcct,   row.account_number.toUpperCase(), row)
    if (row.unit_number)              push(maiaByUnit,   String(row.unit_number).trim(), row)
    const nk = nameKey(row.first_name ?? row.entity_name, row.last_name)
    if (nk !== '|') push(maiaByNameKey, nk, row)
  }

  const maiaIdsMatched = new Set<number>()
  const owners: OwnerComparison[] = []

  // Helper: best STRICT (name-aware) match for one CINC snapshot.
  // Precedence: same cinc_property_id → same account_number → same unit
  // → any same-name row in the association. Doesn't claim — caller does.
  function findStrictMatch(prop: CincPropertyInfo, snap: OwnerSnapshot): MaiaOwnerRow | null {
    const nk = nameKey(snap.first_name, snap.last_name)
    if (nk === '|') return null
    const tryMatch = (rows: MaiaOwnerRow[]) =>
      rows.find(r => !maiaIdsMatched.has(r.id) && nameKey(r.first_name ?? r.entity_name, r.last_name) === nk) ?? null
    let m = tryMatch(maiaByCincId.get(prop.PropertyID) ?? [])
    if (!m && snap.account_number) m = tryMatch(maiaByAcct.get(snap.account_number.toUpperCase()) ?? [])
    if (!m && prop.UnitNo)         m = tryMatch(maiaByUnit.get(String(prop.UnitNo).trim()) ?? [])
    if (!m)                        m = tryMatch(maiaByNameKey.get(nk) ?? [])
    return m
  }

  // Helper: LOOSE fallback (any unclaimed MAIA row at this PID/account/unit,
  // regardless of name). Only safe for the primary slot — the secondary
  // slot's name must line up exactly or it becomes an INSERT.
  function findLooseMatch(prop: CincPropertyInfo, snap: OwnerSnapshot): MaiaOwnerRow | null {
    const tryAny = (rows: MaiaOwnerRow[]) =>
      rows.find(r => !maiaIdsMatched.has(r.id)) ?? null
    let m = tryAny(maiaByCincId.get(prop.PropertyID) ?? [])
    if (!m && snap.account_number) m = tryAny(maiaByAcct.get(snap.account_number.toUpperCase()) ?? [])
    if (!m && prop.UnitNo)         m = tryAny(maiaByUnit.get(String(prop.UnitNo).trim()) ?? [])
    return m
  }

  for (const prop of consideredProperties) {
    const snaps = snapshotsFromCincProperty(prop)

    // Two-pass matching, per property:
    //   PASS 1 — strict name match for EVERY slot. This way if CINC
    //            shuffles Owner 1 ↔ Owner 2 (e.g. person becomes primary,
    //            entity becomes secondary), the entity row in MAIA gets
    //            paired with whichever CINC slot still carries the
    //            entity name — instead of slot 0 hoovering it up first.
    //   PASS 2 — loose fallback (any unclaimed row at this PID), applied
    //            ONLY to slot 0. The secondary slot must match by name
    //            or become an INSERT, otherwise we'd silently rename
    //            arbitrary MAIA rows.
    const slotMatches = new Map<number, MaiaOwnerRow>()
    for (const { slot, snap } of snaps) {
      const m = findStrictMatch(prop, snap)
      if (m) { slotMatches.set(slot, m); maiaIdsMatched.add(m.id) }
    }
    for (const { slot, snap } of snaps) {
      if (slotMatches.has(slot)) continue
      if (slot !== 0)            continue
      const m = findLooseMatch(prop, snap)
      if (m) { slotMatches.set(slot, m); maiaIdsMatched.add(m.id) }
    }

    for (const { slot, snap: cincSnap } of snaps) {
      const existing     = slotMatches.get(slot) ?? null
      const selectionKey = `cinc:${prop.PropertyID}:${slot}`

      if (!existing) {
        owners.push({
          status:           'insert',
          selection_key:    selectionKey,
          account_number:   cincSnap.account_number,
          unit_number:      prop.UnitNo ?? null,
          owner_number:     prop.OwnerNumber ?? null,
          cinc_property_id: prop.PropertyID,
          cinc_name_slot:   slot,
          owners_id:        null,
          maia:             null,
          cinc:             cincSnap,
        })
        continue
      }

      const maiaSnap = snapshotFromMaiaOwner(existing)
      const changes: NonNullable<OwnerComparison['changes']> = {}
      if (cincSnap.first_name && cincSnap.first_name !== maiaSnap.first_name) changes.first_name = { current: maiaSnap.first_name, proposed: cincSnap.first_name }
      if (cincSnap.last_name  && cincSnap.last_name  !== maiaSnap.last_name)  changes.last_name  = { current: maiaSnap.last_name,  proposed: cincSnap.last_name  }
      if (cincSnap.emails     && !emailsContain(maiaSnap.emails, cincSnap.emails)) changes.emails = { current: maiaSnap.emails, proposed: cincSnap.emails }
      // Phone: compare on digits only so MAIA's E.164 (+17865551212)
      // matches CINC's raw 7865551212. Skip the change when they share
      // digits — otherwise the diff would propose to overwrite the
      // already-formatted WhatsApp-ready number with the raw CINC value.
      // When MAIA genuinely has nothing, we still write the normalized
      // form (cincSnap.phone is already normalized at extraction).
      if (cincSnap.phone
          && !phonesEqualByDigits(maiaSnap.phone, cincSnap.phone)
          && !phonesEqualByDigits(existing.phone_2, cincSnap.phone)) {
        changes.phone = { current: maiaSnap.phone, proposed: cincSnap.phone }
      }
      if (cincSnap.address    && cincSnap.address !== maiaSnap.address) changes.address = { current: maiaSnap.address, proposed: cincSnap.address }
      if (cincSnap.account_number && cincSnap.account_number !== maiaSnap.account_number) changes.account_number = { current: maiaSnap.account_number, proposed: cincSnap.account_number }
      if (existing.cinc_property_id == null) {
        changes.cinc_property_id = { current: null, proposed: String(prop.PropertyID) }
      }

      owners.push({
        status:           Object.keys(changes).length === 0 ? 'match' : 'update',
        selection_key:    selectionKey,
        account_number:   cincSnap.account_number ?? maiaSnap.account_number,
        unit_number:      prop.UnitNo ?? existing.unit_number ?? null,
        owner_number:     prop.OwnerNumber ?? null,
        cinc_property_id: prop.PropertyID,
        cinc_name_slot:   slot,
        owners_id:        existing.id,
        maia:             maiaSnap,
        cinc:             cincSnap,
        changes:          Object.keys(changes).length === 0 ? undefined : changes,
      })
    }
  }

  // MAIA-only rows
  for (const row of maiaOwners) {
    if (maiaIdsMatched.has(row.id)) continue
    const maiaSnap = snapshotFromMaiaOwner(row)
    owners.push({
      status:           'only_in_maia',
      selection_key:    `maia:${row.id}`,
      account_number:   maiaSnap.account_number,
      unit_number:      row.unit_number,
      owner_number:     null,
      cinc_property_id: row.cinc_property_id,
      cinc_name_slot:   null,
      owners_id:        row.id,
      maia:             maiaSnap,
      cinc:             null,
    })
  }

  // Sort: by account_number first (so joint-owner rows for the same
  // unit group together), then owner_number, then unit_number.
  function acctSortKey(s: string | null): string {
    if (!s) return '￿'  // empties last
    // Split into prefix + numeric suffix for natural sort ("ABBOTT2"
    // before "ABBOTT10").
    const m = s.match(/^(.*?)(\d+)?$/)
    const prefix = (m?.[1] ?? '').toUpperCase()
    const num    = m?.[2] ? Number(m[2]) : 0
    return `${prefix}|${String(num).padStart(8, '0')}`
  }
  owners.sort((a, b) => {
    const ka = acctSortKey(a.account_number)
    const kb = acctSortKey(b.account_number)
    if (ka !== kb) return ka < kb ? -1 : 1
    // Same account number → put insert/update before match/only_in_maia
    const order: Record<OwnerStatus, number> = { insert: 0, update: 1, only_in_maia: 2, match: 3 }
    const so = order[a.status] - order[b.status]
    if (so !== 0) return so
    return (a.owner_number ?? 99) - (b.owner_number ?? 99)
  })

  // ── Board side ────────────────────────────────────────────────────
  const { data: maiaBoardRaw } = await supabaseAdmin
    .from('association_board_members')
    .select('id, cinc_board_member_id, name, email, role, active')
    .eq('association_code', code)
  const maiaBoardRows = (maiaBoardRaw ?? []) as Array<{ id: string; cinc_board_member_id: number | null; name: string | null; email: string | null; role: string | null; active: boolean | null }>

  const boardByCincId = new Map<number, typeof maiaBoardRows[number]>()
  const boardByName   = new Map<string, typeof maiaBoardRows[number]>()
  for (const row of maiaBoardRows) {
    if (row.cinc_board_member_id != null) boardByCincId.set(row.cinc_board_member_id, row)
    if (row.name) boardByName.set(row.name.toLowerCase().trim(), row)
  }
  const boardIdsMatched = new Set<string>()

  const board: BoardComparison[] = []
  for (const bm of cincBoard) {
    const cincSnap: BoardSnapshot = {
      name:  bm.BoardMemberName ?? null,
      email: (bm.Email ?? '').trim().toLowerCase() || null,
      role:  bm.BoardMemberType ?? null,
      phone: bm.MobilePhone || bm.HomePhone || bm.WorkPhone || null,
    }
    const existing = boardByCincId.get(bm.BoardMemberId)
                   ?? (bm.BoardMemberName ? boardByName.get(bm.BoardMemberName.toLowerCase().trim()) : undefined)
    if (existing) boardIdsMatched.add(existing.id)

    if (!existing) {
      board.push({
        status:               'insert',
        cinc_board_member_id: bm.BoardMemberId,
        abm_id:               null,
        maia:                 null,
        cinc:                 cincSnap,
      })
    } else {
      const maiaSnap: BoardSnapshot = {
        name:  existing.name,
        email: existing.email,
        role:  existing.role,
        phone: null,
      }
      board.push({
        status:               'match',
        cinc_board_member_id: bm.BoardMemberId,
        abm_id:               existing.id,
        maia:                 maiaSnap,
        cinc:                 cincSnap,
      })
    }
  }

  // Active MAIA rows CINC doesn't carry → propose deactivation.
  for (const row of maiaBoardRows) {
    if (!row.active) continue
    if (boardIdsMatched.has(row.id)) continue
    board.push({
      status:               'only_in_maia',
      cinc_board_member_id: row.cinc_board_member_id,
      abm_id:               row.id,
      maia:                 { name: row.name, email: row.email, role: row.role, phone: null },
      cinc:                 null,
    })
  }

  // Sort: insert → only_in_maia → match
  const boardStatusOrder: Record<BoardStatus, number> = { insert: 0, only_in_maia: 1, match: 2 }
  board.sort((a, b) => boardStatusOrder[a.status] - boardStatusOrder[b.status])

  return {
    assocCode:                code,
    associationName:          meta?.AssociationName ?? null,
    cincNumberOfUnits:        meta?.Numberofunits ?? null,
    cincPropertyRowsReturned: cincProperties.length,
    cincOwnerRowsConsidered:  consideredProperties.length,
    cincBoardCount:           cincBoard.length,
    maiaActiveOwners:         maiaOwners.length,
    maiaActiveBoard:          maiaBoardRows.filter(r => r.active).length,
    owners,
    board,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Apply
// ─────────────────────────────────────────────────────────────────────

export interface ApplySelection {
  /** Owner comparison selection_keys to apply.
   *  "cinc:<PropertyID>:<slot>" rows of status='insert' or 'update' are
   *  honored; everything else (only_in_maia, match) is ignored even if
   *  the key is present. The two key formats coexist for the same
   *  PropertyID so a property with both a primary AND a secondary name
   *  pair can be inserted as two distinct owner rows. */
  ownerKeys:           string[]
  insertBoardCincIds:  number[]
  deactivateBoardIds:  string[]
}

export interface ApplyResult {
  ownersInserted:   number
  ownersUpdated:    number
  boardInserted:    number
  boardDeactivated: number
  errors:           string[]
}

export async function applySync(
  assocCode: string,
  selection: ApplySelection,
  actorEmail: string | null,
): Promise<ApplyResult> {
  const code = assocCode.toUpperCase()
  const preview = await buildSyncPreview(code)

  const errors: string[] = []
  let ownersInserted   = 0
  let ownersUpdated    = 0
  let boardInserted    = 0
  let boardDeactivated = 0

  const { data: assocRow } = await supabaseAdmin
    .from('associations')
    .select('association_name')
    .eq('association_code', code)
    .maybeSingle()
  const assocName = assocRow?.association_name ?? preview.associationName ?? code

  // ── Owners (insert + update share one selection set) ───────────────
  const ownerKeySet = new Set(selection.ownerKeys)
  for (const cmp of preview.owners) {
    if (!ownerKeySet.has(cmp.selection_key)) continue

    if (cmp.status === 'insert' && cmp.cinc_property_id != null) {
      const today = new Date().toISOString().slice(0, 10)
      const { data: inserted, error } = await supabaseAdmin
        .from('owners')
        .insert({
          association_code:     code,
          association_name:     assocName,
          unit_number:          cmp.unit_number,
          first_name:           cmp.cinc?.first_name ?? null,
          last_name:            cmp.cinc?.last_name  ?? null,
          emails:               cmp.cinc?.emails     ?? null,
          phone:                cmp.cinc?.phone      ?? null,
          address:              cmp.cinc?.address    ?? null,
          status:               'active',
          ownership_start_date: today,
          cinc_property_id:     cmp.cinc_property_id,
        })
        .select('id')
        .single()
      if (error || !inserted) {
        errors.push(`owner insert (${cmp.selection_key}): ${error?.message}`)
        continue
      }
      ownersInserted++
      await supabaseAdmin.from('ownership_history').insert({
        association_code:  code,
        unit_number:       cmp.unit_number,
        new_owner_id:      inserted.id,
        new_owner_name:    [cmp.cinc?.first_name, cmp.cinc?.last_name].filter(Boolean).join(' '),
        new_owner_emails:  cmp.cinc?.emails ?? null,
        transfer_date:     today,
        source:            'import',
        actor_email:       actorEmail,
        notes:             `Imported from CINC via /admin/cinc-sync (PropertyID=${cmp.cinc_property_id}, name-slot=${cmp.cinc_name_slot ?? 0})`,
      })
      continue
    }

    if (cmp.status === 'update' && cmp.owners_id != null && cmp.changes) {
      const patch: Record<string, unknown> = {}
      for (const [field, diff] of Object.entries(cmp.changes)) {
        if (field === 'cinc_property_id') {
          patch.cinc_property_id = diff.proposed != null ? Number(diff.proposed) : null
        } else {
          patch[field] = diff.proposed
        }
      }
      if (Object.keys(patch).length === 0) continue
      const { error } = await supabaseAdmin.from('owners').update(patch).eq('id', cmp.owners_id)
      if (error) errors.push(`owner update (id=${cmp.owners_id}): ${error.message}`)
      else      ownersUpdated++
    }
  }

  // ── Board inserts ─────────────────────────────────────────────────
  const boardInsertSet = new Set(selection.insertBoardCincIds)
  for (const cmp of preview.board) {
    if (cmp.status !== 'insert' || cmp.cinc_board_member_id == null) continue
    if (!boardInsertSet.has(cmp.cinc_board_member_id)) continue
    const { error } = await supabaseAdmin.from('association_board_members').insert({
      association_code:     code,
      name:                 cmp.cinc?.name ?? 'Board Member',
      email:                cmp.cinc?.email ?? null,
      role:                 cmp.cinc?.role  ?? null,
      active:               true,
      cinc_board_member_id: cmp.cinc_board_member_id,
    })
    if (error) errors.push(`board insert (cinc_board_member_id=${cmp.cinc_board_member_id}): ${error.message}`)
    else      boardInserted++
  }

  // ── Board deactivations ───────────────────────────────────────────
  const boardDeactSet = new Set(selection.deactivateBoardIds)
  for (const cmp of preview.board) {
    if (cmp.status !== 'only_in_maia' || cmp.abm_id == null) continue
    if (!boardDeactSet.has(cmp.abm_id)) continue
    const { error } = await supabaseAdmin.from('association_board_members').update({ active: false }).eq('id', cmp.abm_id)
    if (error) errors.push(`board deactivate (id=${cmp.abm_id}): ${error.message}`)
    else      boardDeactivated++
  }

  return { ownersInserted, ownersUpdated, boardInserted, boardDeactivated, errors }
}
