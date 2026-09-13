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
  getHomeownerStatusDescr,
  type CincPropertyInfo,
  type CincPropertyAddress,
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
  /** CINC side only: which address row this name pair came from. CINC
   *  keeps names on BOTH its owner/mailing row and its property row and
   *  they can differ (ONE 603: owner row "Tross One LLC + Anthony Franco",
   *  property row "Alfredo Fantoni + Tross One LLC"). A pair seen only on
   *  the property row is real but weaker evidence, so it is proposed, not
   *  pre-selected. */
  source_row?:     'owner' | 'property'
  /** Secondary phone column on MAIA's owners table. CINC has no
   *  equivalent so the CINC side of every snapshot leaves this null;
   *  it's surfaced so the edit modal can pre-populate MAIA's current
   *  values without a second round-trip. */
  phone_2:         string | null
  address:         string | null
  /** Preferred language code (en/es/pt/fr/he/ru). MAIA-only — CINC
   *  doesn't track this. Surfaced so the edit modal can show + change
   *  it alongside contact details. */
  language:        string | null
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

export type OwnerStatus = 'insert' | 'update' | 'match' | 'only_in_maia' | 'non_billable'

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
  /** Fields where CINC reported NOTHING to compare against (a blank
   *  Email/phone on CINC's own PropertyInfo), so MAIA's value here has
   *  never actually been verified — it could be correct, stale, or
   *  outright wrong, and this sync has no way to tell. Real incident,
   *  2026-09-08 (MANXI 802 and 4 other units): each of these showed the
   *  same "✓ SYNCED" badge as a row CINC had genuinely confirmed, purely
   *  because CINC had no email on file at all — 'match' only ever meant
   *  "nothing to propose," never "confirmed correct." Distinct from
   *  `changes`, which only exists on status='update'; this can be set
   *  on 'match' too, which is exactly the case that was hiding. */
  unverified?:        string[]
  /** Set (and status forced to 'non_billable') when CINC's own record-level
   *  Status field (GET .../homeowners/homeownerLookup — confirmed live,
   *  2026-09-09, the ONE v1 endpoint that actually populates it) says this
   *  account isn't a real billable owner (e.g. "Developer - NonBillable" —
   *  added to CINC only to enable mass communications, per user direction).
   *  Never proposed as an insert/update, and never auto-selected — staff
   *  said explicitly these shouldn't be treated as MAIA owners at all. */
  nonBillableStatus?: string
  /** Only on status='only_in_maia': a SYNCED row on the same account shares
   *  this row's email or phone, so this is almost certainly a leftover of an
   *  earlier import (the same person under an older spelling) rather than a
   *  co-owner CINC doesn't list. Real case, 2026-09-13 (MANXI 704): the
   *  April import held owner 2 as "Henry Kedisha / Everton Kedisha"; when
   *  CINC renamed him "Henry Kedisha / GRAYSON UNLIMITED, LLC" the sync
   *  inserted a new row and the old one sat as "KEEP" forever. Staff decide;
   *  MAIA never archives on its own. */
  leftoverOf?:        { owners_id: number; name: string; via: 'email' | 'phone' }
  /** status='insert' whose name pair exists only on CINC's property-address
   *  row, not the owner/mailing row — proposed but never pre-selected. */
  from_property_row?: boolean
}

export type BoardStatus = 'insert' | 'update' | 'match' | 'only_in_maia'

export interface BoardComparison {
  status:                 BoardStatus
  cinc_board_member_id:   number | null
  abm_id:                 string | null
  maia:                   BoardSnapshot | null
  cinc:                   BoardSnapshot | null
  /** Only set on status='update'. Keyed by field (role / email), values
   *  are the before / after we'd write into MAIA. Lets the UI show
   *  exactly what changed (e.g. a position change made in CINC). */
  changes?:               Record<string, { current: string | null; proposed: string | null }>
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
/** CINC address-row types that are NOT the owner: a tenant's mailing row
 *  (4) and a management company row (8). Real case, 2026-09-13 (BHB 5664):
 *  the tenant Margaret Adelman sat on a "Tenant Mailings" row and was
 *  proposed as a third owner. Property Address (0), Owner's Offsite
 *  Address (2) and Additional Owners (7) are owner rows. */
function isOwnerAddressRow(a: CincPropertyAddress): boolean {
  const t = Number(a.AddressTypeId ?? 0)
  const d = String(a.AddressTypeDescription ?? '').toLowerCase()
  if (t === 4 || t === 8) return false
  if (/tenant|management|manager|attorney|vendor/.test(d)) return false
  return true
}

function snapshotsFromCincProperty(p: CincPropertyInfo): Array<{ slot: number; snap: OwnerSnapshot }> {
  const addresses = (p.Address ?? []).filter(isOwnerAddressRow)
  const propAddr  = addresses.find(a => !a.OwnerAddress) ?? null  // owner names + contact
  const offsite   = addresses.find(a =>  a.OwnerAddress) ?? null  // billing street
  const fallback  = addresses[0] ?? null

  // Names + email + phone — take the address row that carries the MOST
  // name information; on a tie prefer the owner/mailing row (OwnerAddress
  // = true), which is what CINC's own "Primary Homeowner Information" form
  // shows. Real incident, 2026-09-13 (MANXI 1001, LFA 03): the property
  // row held "" / "Marie Caroupin" and NO second owner, while the owner row
  // held "Marie Line / Caroupin" + "JERRY & LORANG / GERMAIN" and all three
  // emails — reading the property row first made the sync miss owner 2
  // entirely and flag MAIA's correct row as a leftover to archive.
  const nameScore = (a: CincPropertyAddress | null) => a
    ? [a.FirstName, a.LastName, a.FirstName1, a.LastName1].filter(v => String(v ?? '').trim()).length
    : -1
  const nameSrc = [offsite, propAddr, fallback]
    .filter((a): a is CincPropertyAddress => !!a)
    .sort((a, b) => nameScore(b) - nameScore(a))[0] ?? null
  // Street address — prefer offsite (the owner's mailing address, which
  // is what CINC's UI surfaces), fall back to property address.
  const streetSrc = offsite ?? propAddr ?? fallback

  if (!nameSrc && !streetSrc) {
    return [{
      slot: 0,
      snap: {
        account_number: p.PropertyHOID ?? null,
        unit_number:    p.UnitNo ?? null,
        first_name:     null, last_name: null, emails: null, phone: null, phone_2: null, address: null, language: null,
      },
    }]
  }

  const street = streetSrc ? ([streetSrc.StreetNumber, streetSrc.Address].filter(Boolean).join(' ').trim() || null) : null

  // Real incident, 2026-09-09 (MANXI 505/207/708, SP 10B): nameSrc
  // (property address) was the ONLY source ever checked for Email and
  // phone, so a property whose contact info lives only on the
  // offsite/billing address row (as CINC's own Homeowner Information page
  // showed for all four of these accounts) read as "CINC has nothing" —
  // which is what produced the false "⚠ Unverified" badge (#829) instead
  // of a real proposed match/update. Offsite carries its own contact
  // fields (see function doc above); fall back to it, then to the first
  // address row, before giving up.
  const anyPhone = (a: CincPropertyAddress | null) => a ? (a.MobilePhone || a.HomePhone || a.WorkPhone || null) : null
  const rawPhone = anyPhone(nameSrc) || anyPhone(offsite) || anyPhone(fallback)
  // Normalize at the boundary — CINC stores phones in mixed formats
  // (raw digits, parenthesized, etc.) but we always want the E.164 form
  // (+1XXXXXXXXXX) in our DB so WhatsApp / SMS APIs can dial.
  const phone    = normalizePhone(rawPhone)
  // Emails: the union across every address row — each row can carry a
  // different subset (ONE 603: the owner row had only the manager's
  // address, the property row both). CINC stays authoritative: an address
  // on none of the rows is still pruned from MAIA.
  const emailSet = new Set<string>()
  for (const a of addresses) for (const e of String(a.Email ?? '').toLowerCase().split(/[,;]/)) { const t = e.trim(); if (t.includes('@')) emailSet.add(t) }
  const emails   = emailSet.size ? [...emailSet].join(',') : null

  const baseSnap = (first: string | null, last: string | null, sourceRow: 'owner' | 'property'): OwnerSnapshot => ({
    account_number: p.PropertyHOID ?? null,
    unit_number:    p.UnitNo ?? null,
    first_name:     first,
    last_name:      last,
    emails,
    phone,
    // CINC's data model has no concept of a secondary owner phone or
    // language preference, so both stay null on this side. Only MAIA
    // snapshots carry them.
    phone_2:        null,
    address:        street,
    language:       null,
    source_row:     sourceRow,
  })

  // Every distinct name pair across EVERY address row, owner rows first.
  // Real incident, 2026-09-13 (ONE 402/603/702, ONE 502, PVV 2459): the
  // rows disagree — the owner row lists the LLC + its manager, the property
  // row lists the principal + the LLC — and reading only one of them made
  // the sync flag MAIA's correct rows as leftovers. Pairs that are the same
  // person spelled shorter/longer ("Marie Caroupin" vs "Marie Line
  // Caroupin") collapse into one slot.
  const ordered = [...addresses].sort((a, b) => Number(!!b.OwnerAddress) - Number(!!a.OwnerAddress))
  const pairs: { first: string | null; last: string | null; sourceRow: 'owner' | 'property' }[] = []
  for (const a of ordered) {
    const sourceRow: 'owner' | 'property' = a.OwnerAddress ? 'owner' : 'property'
    for (const [f, l] of [[a.FirstName, a.LastName], [a.FirstName1, a.LastName1]] as const) {
      const first = (f ?? '').trim() || null, last = (l ?? '').trim() || null
      if (!first && !last) continue
      const dup = pairs.find(x => namesCompatible(x.first, x.last, first, last))
      if (dup) {
        // Keep the longer spelling, but never demote an owner-row pair.
        if (fullNameTokens(first, last).length > fullNameTokens(dup.first, dup.last).length && dup.sourceRow === sourceRow) { dup.first = first; dup.last = last }
        continue
      }
      pairs.push({ first, last, sourceRow })
    }
  }

  const out: Array<{ slot: number; snap: OwnerSnapshot }> = pairs.map((x, i) => ({ slot: i, snap: baseSnap(x.first, x.last, x.sourceRow) }))
  // Edge case: no names anywhere — still emit one row so the
  // address/email/phone show up in the diff.
  if (out.length === 0) out.push({ slot: 0, snap: baseSnap(null, null, 'owner') })
  return out
}

/** Lower-cased word tokens of a full name, punctuation stripped. */
function fullNameTokens(first: string | null | undefined, last: string | null | undefined): string[] {
  return `${first ?? ''} ${last ?? ''}`.toLowerCase().replace(/[^a-z0-9\u00c0-\u024f&]+/g, ' ').split(' ').filter(t => t && t !== '&')
}

/** Same person under a shorter / longer spelling: exact token set, or one
 *  side's tokens (at least two of them) all contained in the other's.
 *  "Marie Caroupin" ⊂ "Marie Line Caroupin" ✓; "Dino Rocco" ⊂ "Andrea V.
 *  Burzaco Dino Rocco" ✓; "Richard Martin" vs "Suzanne Martin" ✗. */
export function namesCompatible(f1: string | null | undefined, l1: string | null | undefined, f2: string | null | undefined, l2: string | null | undefined): boolean {
  const a = fullNameTokens(f1, l1), b = fullNameTokens(f2, l2)
  if (!a.length || !b.length) return false
  const [small, big] = a.length <= b.length ? [a, b] : [b, a]
  if (small.length === big.length) return small.every(t => big.includes(t)) && big.every(t => small.includes(t))
  if (small.length < 2) return false
  return small.every(t => big.includes(t))
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
  language:         string | null
}

function snapshotFromMaiaOwner(r: MaiaOwnerRow): OwnerSnapshot {
  return {
    account_number: r.account_number ?? null,
    unit_number:    r.unit_number    ?? null,
    first_name:     r.first_name ?? r.entity_name ?? null,
    last_name:      r.last_name  ?? null,
    emails:         r.emails     ?? null,
    // Surface BOTH phones — primary for display, secondary for the
    // edit modal. Don't collapse them here.
    phone:          r.phone      ?? null,
    phone_2:        r.phone_2    ?? null,
    address:        r.address    ?? null,
    language:       r.language   ?? null,
  }
}

function nameKey(first: string | null | undefined, last: string | null | undefined): string {
  return `${(first ?? '').trim().toLowerCase()}|${(last ?? '').trim().toLowerCase()}`
}

/** Split a comma/semicolon-separated email field into a normalized set
 *  of individual addresses. Empty / missing input → empty set. */
function emailsToSet(s: string | null | undefined): Set<string> {
  return new Set(
    (s ?? '').toLowerCase().split(/[,;]/).map(x => x.trim()).filter(Boolean),
  )
}

/** True iff MAIA's and CINC's email sets are identical (order-insensitive,
 *  case-insensitive). CINC is authoritative, so any difference is a change. */
function emailSetsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const A = emailsToSet(a), B = emailsToSet(b)
  if (A.size !== B.size) return false
  for (const e of A) if (!B.has(e)) return false
  return true
}

/** Normalized, deduped, comma-joined email list (lowercased). CINC's set is
 *  written verbatim (pruned to CINC) — the sync no longer keeps stale MAIA
 *  extras, which is what made the field accumulate wrong addresses over time. */
function normalizeEmailList(s: string | null | undefined): string {
  return [...emailsToSet(s)].join(',')
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
export function normalizePhone(raw: string | null | undefined): string | null {
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
    .select('id, cinc_property_id, account_number, unit_number, first_name, last_name, entity_name, emails, phone, phone_2, address, language')
    .eq('association_code', code)
    .or('status.neq.previous,status.is.null')

  const maiaOwners = (maiaOwnersRaw ?? []) as MaiaOwnerRow[]

  // Many-to-many maps. cinc_property_id / account_number can repeat
  // across joint-owner rows on our side too, so values are arrays.
  //
  // Real incident, 2026-09-09 (MACO): there used to be a `maiaByUnit` map
  // here, keyed by the bare `unit_number` column, used as a matching
  // fallback below `account_number`. For an association whose account
  // numbers embed a building/section prefix (MCCA1, MCCB1, MCCC1, MCCD1,
  // MCCE1, MCCF1...) but whose `unit_number` column is just the bare
  // trailing digit ("1" for every one of those), that fallback grouped
  // SIX UNRELATED ACCOUNTS across different sections under the same key —
  // findLooseMatch's "any unclaimed row in this bucket" then paired
  // Hispania Entertainment LLC's CINC property records onto whichever
  // unrelated MACO owner happened to be unclaimed first (Carlos Fleites,
  // Daniel Fernandez, Richard Garcia...), proposing to overwrite their
  // real data. User direction: `account_number` is the only identity key
  // safe to match on here — `unit_number` is not guaranteed unique across
  // an association and must never be used for matching, insert/update
  // targeting, or any other identity decision in this file.
  const maiaByCincId  = new Map<number, MaiaOwnerRow[]>()
  const maiaByAcct    = new Map<string, MaiaOwnerRow[]>()
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
    const nk = nameKey(row.first_name ?? row.entity_name, row.last_name)
    if (nk !== '|') push(maiaByNameKey, nk, row)
  }

  const maiaIdsMatched = new Set<number>()
  const owners: OwnerComparison[] = []

  // Helper: best STRICT (name-aware) match for one CINC snapshot.
  // Precedence: same cinc_property_id → same account_number → any
  // same-name row in the association. Doesn't claim — caller does.
  function findStrictMatch(prop: CincPropertyInfo, snap: OwnerSnapshot): MaiaOwnerRow | null {
    const nk = nameKey(snap.first_name, snap.last_name)
    if (nk === '|') return null
    const tryMatch = (rows: MaiaOwnerRow[]) =>
      rows.find(r => !maiaIdsMatched.has(r.id) && nameKey(r.first_name ?? r.entity_name, r.last_name) === nk) ?? null
    let m = tryMatch(maiaByCincId.get(prop.PropertyID) ?? [])
    if (!m && snap.account_number) m = tryMatch(maiaByAcct.get(snap.account_number.toUpperCase()) ?? [])
    if (!m)                        m = tryMatch(maiaByNameKey.get(nk) ?? [])
    return m
  }

  // Helper: LOOSE fallback (any unclaimed MAIA row at this PID/account,
  // regardless of name). Only safe for the primary slot — the secondary
  // slot's name must line up exactly or it becomes an INSERT.
  function findLooseMatch(prop: CincPropertyInfo, snap: OwnerSnapshot): MaiaOwnerRow | null {
    const tryAny = (rows: MaiaOwnerRow[]) =>
      rows.find(r => !maiaIdsMatched.has(r.id)) ?? null
    let m = tryAny(maiaByCincId.get(prop.PropertyID) ?? [])
    if (!m && snap.account_number) m = tryAny(maiaByAcct.get(snap.account_number.toUpperCase()) ?? [])
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
    // PASS 1b — same person, shorter/longer spelling, within this
    // property's / account's own rows only (never association-wide).
    for (const { slot, snap } of snaps) {
      if (slotMatches.has(slot)) continue
      const bucket = [...(maiaByCincId.get(prop.PropertyID) ?? []), ...(snap.account_number ? (maiaByAcct.get(snap.account_number.toUpperCase()) ?? []) : [])]
      const m = bucket.find(r => !maiaIdsMatched.has(r.id) && namesCompatible(r.first_name ?? r.entity_name, r.last_name, snap.first_name, snap.last_name)) ?? null
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
          from_property_row: cincSnap.source_row === 'property' ? true : undefined,
        })
        continue
      }

      const maiaSnap = snapshotFromMaiaOwner(existing)
      const changes: NonNullable<OwnerComparison['changes']> = {}
      if (cincSnap.first_name && cincSnap.first_name !== maiaSnap.first_name) changes.first_name = { current: maiaSnap.first_name, proposed: cincSnap.first_name }
      if (cincSnap.last_name  && cincSnap.last_name  !== maiaSnap.last_name)  changes.last_name  = { current: maiaSnap.last_name,  proposed: cincSnap.last_name  }
      // Emails: CINC is authoritative. Propose CINC's set whenever it differs
      // from MAIA's — this PRUNES stale addresses CINC no longer carries (the
      // old union logic never dropped, so the field kept accumulating) and adds
      // any new ones. Skip only when the sets already match.
      if (cincSnap.emails && !emailSetsEqual(cincSnap.emails, maiaSnap.emails)) {
        changes.emails = { current: maiaSnap.emails, proposed: normalizeEmailList(cincSnap.emails) }
      }
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

      // Every change above is gated on `cincSnap.<field>` being truthy — CINC
      // has nothing there, so there is nothing to compare, let alone propose.
      // That's correct for deciding whether to WRITE a change, but it means
      // 'match' conflates two very different situations: "CINC confirmed
      // this is correct" and "CINC has no opinion, so this was never
      // actually checked." Track the second case explicitly so the UI can
      // tell them apart instead of showing the same green badge for both.
      const unverified: string[] = []
      if (!cincSnap.emails && maiaSnap.emails) unverified.push('emails')
      if (!cincSnap.phone  && maiaSnap.phone)  unverified.push('phone')

      owners.push({
        status:           Object.keys(changes).length === 0 ? 'match' : 'update',
        unverified:       unverified.length > 0 ? unverified : undefined,
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

  // Real incident, 2026-09-09 (Elena Mosiyash, VPREC): a CINC account added
  // ONLY to enable mass communications ("Status: Developer - NonBillable"
  // on the Homeowner Information page) still showed up as a normal owner
  // insert/update candidate here -- user direction: don't propose treating
  // these as real MAIA owners at all. getHomeownerStatusDescr is a
  // per-account lookup (the one v1 endpoint confirmed to actually populate
  // this field -- associationWithProperty's HomeownerStatus is always
  // null), so this only fires for rows that would otherwise become an
  // insert/update -- bounded to the actual diff, not every property in the
  // association. Best-effort: a lookup failure leaves the row as-is rather
  // than blocking the sync.
  await Promise.all(owners.map(async cmp => {
    if (cmp.status !== 'insert' && cmp.status !== 'update') return
    if (!cmp.account_number) return
    const cincStatus = await getHomeownerStatusDescr(cmp.account_number).catch(() => null)
    if (cincStatus && /non.?billable/i.test(cincStatus)) {
      cmp.status = 'non_billable'
      cmp.nonBillableStatus = cincStatus
    }
  }))

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
    // Flag MAIA-only rows that look like leftovers of a synced row on the
  // same account (see OwnerComparison.leftoverOf).
  const syncedByAcct = new Map<string, OwnerComparison[]>()
  for (const o of owners) {
    if ((o.status === 'match' || o.status === 'update') && o.owners_id != null && o.account_number) {
      const k = o.account_number.toUpperCase(); syncedByAcct.set(k, [...(syncedByAcct.get(k) ?? []), o])
    }
  }
  for (const o of owners) {
    if (o.status !== 'only_in_maia' || !o.account_number || !o.maia) continue
    const mine = normalizeEmailList(o.maia.emails).split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    for (const s of syncedByAcct.get(o.account_number.toUpperCase()) ?? []) {
      const theirs = normalizeEmailList(s.maia?.emails).split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
      const name = [s.maia?.first_name, s.maia?.last_name].filter(Boolean).join(' ')
      if (mine.some(e => theirs.includes(e))) { o.leftoverOf = { owners_id: s.owners_id as number, name, via: 'email' }; break }
      if (o.maia.phone && phonesEqualByDigits(o.maia.phone, s.maia?.phone)) { o.leftoverOf = { owners_id: s.owners_id as number, name, via: 'phone' }; break }
    }
  }

  const order: Record<OwnerStatus, number> = { insert: 0, update: 1, only_in_maia: 2, match: 3, non_billable: 4 }
    const so = order[a.status] - order[b.status]
    if (so !== 0) return so
    return (a.owner_number ?? 99) - (b.owner_number ?? 99)
  })

  // ── Board side ────────────────────────────────────────────────────
  const { data: maiaBoardRaw } = await supabaseAdmin
    .from('association_board_members')
    .select('id, cinc_board_member_id, name, email, role, active, email_locked')
    .eq('association_code', code)
  const maiaBoardRows = (maiaBoardRaw ?? []) as Array<{ id: string; cinc_board_member_id: number | null; name: string | null; email: string | null; role: string | null; active: boolean | null; email_locked: boolean | null }>

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
      // Detect drift on fields MAIA pulls from CINC (position/role and
      // email). CINC is the source of truth, but we only ever propose
      // pulling a value CINC actually HAS — we never blank-out a MAIA
      // field just because CINC's is empty. So a position change made in
      // CINC surfaces as an UPDATE the staff can push; an empty CINC
      // field is ignored.
      const norm = (s: string | null | undefined) => (s ?? '').trim()
      const changes: Record<string, { current: string | null; proposed: string | null }> = {}
      if (norm(cincSnap.role) && norm(cincSnap.role).toLowerCase() !== norm(existing.role).toLowerCase()) {
        changes.role = { current: existing.role ?? null, proposed: cincSnap.role ?? null }
      }
      // Real incident, 2026-08-24 (MANXI #1093): CINC's board record held
      // a stale email that would have broken the board member's ability
      // to receive/e-sign approval letters had it been applied. CINC's
      // board-members endpoint exposes exactly one Email field — there's
      // no secondary value to prefer instead — so once staff marks a
      // board member's email as locked, stop proposing to overwrite it.
      if (!existing.email_locked && norm(cincSnap.email) && norm(cincSnap.email).toLowerCase() !== norm(existing.email).toLowerCase()) {
        changes.email = { current: existing.email ?? null, proposed: cincSnap.email ?? null }
      }
      const hasChanges = Object.keys(changes).length > 0
      board.push({
        status:               hasChanges ? 'update' : 'match',
        cinc_board_member_id: bm.BoardMemberId,
        abm_id:               existing.id,
        maia:                 maiaSnap,
        cinc:                 cincSnap,
        ...(hasChanges ? { changes } : {}),
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

  // Sort: insert → update → only_in_maia → match
  const boardStatusOrder: Record<BoardStatus, number> = { insert: 0, update: 1, only_in_maia: 2, match: 3 }
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
  /** abm_id (association_board_members.id) of status='update' rows whose
   *  drifted fields (role / email) should be pulled from CINC into MAIA. */
  updateBoardIds:      string[]
  deactivateBoardIds:  string[]
  /** owners.id of status='only_in_maia' rows to ARCHIVE — status 'previous',
   *  active false, ownership_end_date today. The row is kept for history and
   *  drops out of the sync, the owner emails and the counts. Only rows the
   *  preview itself reports as only_in_maia are honored. */
  archiveOwnerIds?:    number[]
}

export interface ApplyResult {
  ownersInserted:   number
  ownersUpdated:    number
  ownersArchived:   number
  boardInserted:    number
  boardUpdated:     number
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
  let ownersArchived   = 0
  let boardInserted    = 0
  let boardUpdated     = 0
  let boardDeactivated = 0

  const { data: assocRow } = await supabaseAdmin
    .from('associations')
    .select('association_name')
    .eq('association_code', code)
    .maybeSingle()
  const assocName = assocRow?.association_name ?? preview.associationName ?? code

  // ── Owners: archive MAIA-only rows staff ticked ───────────────────
  const archivable = new Map(preview.owners.filter(o => o.status === 'only_in_maia' && o.owners_id != null).map(o => [o.owners_id as number, o]))
  for (const id of selection.archiveOwnerIds ?? []) {
    const cmp = archivable.get(id)
    if (!cmp) { errors.push(`owner archive (id=${id}): not a MAIA-only row on this association`); continue }
    const today = new Date().toISOString().slice(0, 10)
    const { error } = await supabaseAdmin.from('owners')
      .update({ status: 'previous', active: false, ownership_end_date: today, updated_at: new Date().toISOString() })
      .eq('id', id).eq('association_code', code)
    if (error) { errors.push(`owner archive (id=${id}): ${error.message}`); continue }
    ownersArchived++
    try {
      await supabaseAdmin.from('owner_contact_history').insert({
        owner_id: id, association_code: code, unit_number: cmp.unit_number,
        field: 'status', old_value: 'active',
        new_value: `previous — archived from /admin/cinc-sync, not in CINC${cmp.leftoverOf ? `; same ${cmp.leftoverOf.via} as synced owner ${cmp.leftoverOf.name} (id ${cmp.leftoverOf.owners_id})` : ''}`,
        changed_by: actorEmail ?? 'cinc_sync',
      })
    } catch { /* history is best-effort */ }
  }

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
      if (error) {
        errors.push(`owner update (id=${cmp.owners_id}): ${error.message}`)
      } else {
        ownersUpdated++
        // Real incident, 2026-09-08 (MANXI 802): a wrong owners.emails value
        // was only ever discoverable by someone noticing the wrong
        // recipient -- no change history existed at all. Log every
        // emails/phone change this sync actually applies (see
        // owner_contact_history, 20260908_owner_contact_history.sql).
        for (const field of ['emails', 'phone'] as const) {
          const diff = cmp.changes[field]
          if (!diff) continue
          try {
            await supabaseAdmin.from('owner_contact_history').insert({
              owner_id: cmp.owners_id, association_code: code, unit_number: cmp.unit_number,
              field, old_value: diff.current, new_value: diff.proposed, changed_by: actorEmail ?? 'cinc_sync',
            })
          } catch { /* history logging must never fail the sync */ }
        }
      }
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

  // ── Board updates (pull CINC's role / email into MAIA) ────────────
  const boardUpdateSet = new Set(selection.updateBoardIds)
  for (const cmp of preview.board) {
    if (cmp.status !== 'update' || cmp.abm_id == null) continue
    if (!boardUpdateSet.has(cmp.abm_id)) continue
    const patch: Record<string, unknown> = {}
    if (cmp.changes?.role)  patch.role  = cmp.changes.role.proposed
    if (cmp.changes?.email) patch.email = cmp.changes.email.proposed
    if (Object.keys(patch).length === 0) continue
    const { error } = await supabaseAdmin.from('association_board_members').update(patch).eq('id', cmp.abm_id)
    if (error) errors.push(`board update (id=${cmp.abm_id}): ${error.message}`)
    else      boardUpdated++
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

  return { ownersInserted, ownersUpdated, ownersArchived, boardInserted, boardUpdated, boardDeactivated, errors }
}
