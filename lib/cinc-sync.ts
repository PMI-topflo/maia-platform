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
  /** Sort key for the UI — prefers CINC's PropertyHOID (e.g. "ABBOTT1"),
   *  falls back to MAIA's account_number, finally to unit_number. */
  account_number:     string | null
  unit_number:        string | null
  owner_number:       number | null
  /** stable upstream id if CINC carries the row */
  cinc_property_id:   number | null
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

function snapshotFromCincProperty(p: CincPropertyInfo): OwnerSnapshot {
  const a = (p.Address ?? []).find(x => x.OwnerAddress) ?? p.Address?.[0]
  if (!a) return {
    account_number: p.PropertyHOID ?? null,
    unit_number:    p.UnitNo ?? null,
    first_name:     null, last_name: null, emails: null, phone: null, address: null,
  }
  const street = [a.StreetNumber, a.Address].filter(Boolean).join(' ').trim() || null
  const phone  = a.MobilePhone || a.HomePhone || a.WorkPhone || null
  return {
    account_number: p.PropertyHOID ?? null,
    unit_number:    p.UnitNo ?? null,
    first_name:     (a.FirstName ?? '').trim() || null,
    last_name:      (a.LastName  ?? '').trim() || null,
    emails:         (a.Email     ?? '').trim().toLowerCase() || null,
    phone:          phone ? String(phone) : null,
    address:        street,
  }
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

  for (const prop of consideredProperties) {
    const cincSnap = snapshotFromCincProperty(prop)
    const nk = nameKey(cincSnap.first_name, cincSnap.last_name)

    // Match precedence — strict matches first, then loose unit/account
    // matches so a freshly-imported MAIA row gets paired with its CINC
    // counterpart even if the names diverge between systems:
    //   1. Same cinc_property_id AND same name
    //   2. Same cinc_property_id (any unclaimed owner)
    //   3. Same account_number AND same name
    //   4. Same account_number (any unclaimed)
    //   5. Same unit_number AND same name
    //   6. Same unit_number (any unclaimed) ← the new loose fallback
    //   7. Any same-name row (assoc-wide)
    let existing: MaiaOwnerRow | null = null
    const samePid = maiaByCincId.get(prop.PropertyID) ?? []
    existing = samePid.find(r => !maiaIdsMatched.has(r.id) && nameKey(r.first_name ?? r.entity_name, r.last_name) === nk) ?? null
    if (!existing) existing = samePid.find(r => !maiaIdsMatched.has(r.id)) ?? null
    if (!existing && cincSnap.account_number) {
      const sameAcct = maiaByAcct.get(cincSnap.account_number.toUpperCase()) ?? []
      existing = sameAcct.find(r => !maiaIdsMatched.has(r.id) && nameKey(r.first_name ?? r.entity_name, r.last_name) === nk) ?? null
      if (!existing) existing = sameAcct.find(r => !maiaIdsMatched.has(r.id)) ?? null
    }
    if (!existing && prop.UnitNo) {
      const sameUnit = maiaByUnit.get(String(prop.UnitNo).trim()) ?? []
      existing = sameUnit.find(r => !maiaIdsMatched.has(r.id) && nameKey(r.first_name ?? r.entity_name, r.last_name) === nk) ?? null
      if (!existing) existing = sameUnit.find(r => !maiaIdsMatched.has(r.id)) ?? null
    }
    if (!existing && nk !== '|') {
      const sameName = maiaByNameKey.get(nk) ?? []
      existing = sameName.find(r => !maiaIdsMatched.has(r.id)) ?? null
    }
    if (existing) maiaIdsMatched.add(existing.id)

    if (!existing) {
      owners.push({
        status:           'insert',
        account_number:   cincSnap.account_number,
        unit_number:      prop.UnitNo ?? null,
        owner_number:     prop.OwnerNumber ?? null,
        cinc_property_id: prop.PropertyID,
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
    if (cincSnap.phone      && maiaSnap.phone !== cincSnap.phone && existing.phone_2 !== cincSnap.phone) changes.phone = { current: maiaSnap.phone, proposed: cincSnap.phone }
    if (cincSnap.address    && cincSnap.address !== maiaSnap.address) changes.address = { current: maiaSnap.address, proposed: cincSnap.address }
    if (cincSnap.account_number && cincSnap.account_number !== maiaSnap.account_number) changes.account_number = { current: maiaSnap.account_number, proposed: cincSnap.account_number }
    if (existing.cinc_property_id == null) {
      changes.cinc_property_id = { current: null, proposed: String(prop.PropertyID) }
    }

    owners.push({
      status:           Object.keys(changes).length === 0 ? 'match' : 'update',
      account_number:   cincSnap.account_number ?? maiaSnap.account_number,
      unit_number:      prop.UnitNo ?? existing.unit_number ?? null,
      owner_number:     prop.OwnerNumber ?? null,
      cinc_property_id: prop.PropertyID,
      owners_id:        existing.id,
      maia:             maiaSnap,
      cinc:             cincSnap,
      changes:          Object.keys(changes).length === 0 ? undefined : changes,
    })
  }

  // MAIA-only rows
  for (const row of maiaOwners) {
    if (maiaIdsMatched.has(row.id)) continue
    const maiaSnap = snapshotFromMaiaOwner(row)
    owners.push({
      status:           'only_in_maia',
      account_number:   maiaSnap.account_number,
      unit_number:      row.unit_number,
      owner_number:     null,
      cinc_property_id: row.cinc_property_id,
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
  insertOwnerCincIds:  number[]
  updateOwnerIds:      number[]
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

  // ── Owner inserts ──────────────────────────────────────────────────
  const insertSet = new Set(selection.insertOwnerCincIds)
  for (const cmp of preview.owners) {
    if (cmp.status !== 'insert') continue
    if (cmp.cinc_property_id == null || !insertSet.has(cmp.cinc_property_id)) continue
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
      errors.push(`owner insert (cinc_property_id=${cmp.cinc_property_id}): ${error?.message}`)
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
      notes:             `Imported from CINC via /admin/cinc-sync (PropertyID=${cmp.cinc_property_id})`,
    })
  }

  // ── Owner updates ─────────────────────────────────────────────────
  const updateSet = new Set(selection.updateOwnerIds)
  for (const cmp of preview.owners) {
    if (cmp.status !== 'update' || cmp.owners_id == null) continue
    if (!updateSet.has(cmp.owners_id)) continue
    if (!cmp.changes) continue
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
