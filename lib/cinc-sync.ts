// =====================================================================
// lib/cinc-sync.ts
// Diff + apply for the /admin/cinc-sync importer.
//
// Pulls owners + board members from CINC for one association, compares
// to our DB, and returns four buckets:
//   - ownerInserts        — units present in CINC, missing in MAIA
//   - ownerUpdates        — same unit on both sides, MAIA has stale data
//   - boardInserts        — board members in CINC missing from MAIA
//   - boardDeactivations  — active board members in MAIA that CINC no
//                           longer lists (resignations / term ends)
//
// Apply selectively writes the IDs the staff member ticks. Owner
// inserts also write an `ownership_history` row with source='import'
// so the audit trail captures who imported what and when.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  listAssociationProperties,
  listAssociationBoardMembers,
  type CincPropertyInfo,
  type CincBoardMember,
} from '@/lib/integrations/cinc'

// ─────────────────────────────────────────────────────────────────────
// Shapes
// ─────────────────────────────────────────────────────────────────────

export interface OwnerInsertProposal {
  kind:               'owner_insert'
  /** stable CINC ref */
  cinc_property_id:   number
  unit_number:        string | null
  first_name:         string | null
  last_name:          string | null
  emails:             string | null
  phone:              string | null
  address:            string | null
}

export interface OwnerUpdateProposal {
  kind:               'owner_update'
  owners_id:          number
  cinc_property_id:   number
  unit_number:        string | null
  /** Map of field → {current, proposed} so the UI can highlight the diff. */
  changes:            Record<string, { current: string | null; proposed: string | null }>
}

export interface BoardInsertProposal {
  kind:                 'board_insert'
  cinc_board_member_id: number
  name:                 string | null
  email:                string | null
  role:                 string | null
  phone:                string | null
}

export interface BoardDeactivationProposal {
  kind:        'board_deactivate'
  abm_id:      string   // uuid in our table
  name:        string | null
  email:       string | null
  role:        string | null
  reason:      'not_in_cinc'
}

export type SyncProposal =
  | OwnerInsertProposal
  | OwnerUpdateProposal
  | BoardInsertProposal
  | BoardDeactivationProposal

export interface SyncPreview {
  assocCode:           string
  cincUnitCount:       number
  cincBoardCount:      number
  ownerInserts:        OwnerInsertProposal[]
  ownerUpdates:        OwnerUpdateProposal[]
  boardInserts:        BoardInsertProposal[]
  boardDeactivations:  BoardDeactivationProposal[]
  ownerMatches:        number   // already in sync — useful sanity number
  boardMatches:        number
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — extract a clean tuple from CINC's nested PropertyInfo
// ─────────────────────────────────────────────────────────────────────

interface ExtractedOwner {
  cinc_property_id: number
  unit_number:      string | null
  first_name:       string | null
  last_name:        string | null
  email:            string | null
  phone:            string | null
  address:          string | null
}

function extractOwner(p: CincPropertyInfo): ExtractedOwner | null {
  if (!p.isCurrentOwner) return null
  const a = (p.Address ?? []).find(x => x.OwnerAddress) ?? p.Address?.[0]
  if (!a) return {
    cinc_property_id: p.PropertyID,
    unit_number:      p.UnitNo ?? null,
    first_name:       null,
    last_name:        null,
    email:            null,
    phone:            null,
    address:          null,
  }
  const street = [a.StreetNumber, a.Address].filter(Boolean).join(' ').trim() || null
  const phone  = a.MobilePhone || a.HomePhone || a.WorkPhone || null
  return {
    cinc_property_id: p.PropertyID,
    unit_number:      p.UnitNo ?? null,
    first_name:       (a.FirstName ?? '').trim() || null,
    last_name:        (a.LastName  ?? '').trim() || null,
    email:            (a.Email     ?? '').trim().toLowerCase() || null,
    phone:            phone ? phone.toString() : null,
    address:          street,
  }
}

function normalizeEmail(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

function emailsMatch(stored: string | null | undefined, proposed: string | null | undefined): boolean {
  const p = normalizeEmail(proposed)
  if (!p) return !normalizeEmail(stored)
  // stored may be comma-separated. Match if `p` is one of the entries.
  return (stored ?? '').toLowerCase().split(/[,;]/).map(s => s.trim()).includes(p)
}

// ─────────────────────────────────────────────────────────────────────
// Preview
// ─────────────────────────────────────────────────────────────────────

export async function buildSyncPreview(assocCode: string): Promise<SyncPreview> {
  const code = assocCode.toUpperCase()

  const [cincProperties, cincBoard] = await Promise.all([
    listAssociationProperties(code),
    listAssociationBoardMembers(code),
  ])

  // ── Owner side ────────────────────────────────────────────────────
  const { data: maiaOwners } = await supabaseAdmin
    .from('owners')
    .select('id, cinc_property_id, unit_number, first_name, last_name, emails, phone, phone_2, address')
    .eq('association_code', code)
    .or('status.neq.previous,status.is.null')

  // Index our owners by stable CINC id (preferred) and by unit_number (fallback)
  const byCincId  = new Map<number, NonNullable<typeof maiaOwners>[number]>()
  const byUnit    = new Map<string, NonNullable<typeof maiaOwners>[number]>()
  for (const row of (maiaOwners ?? [])) {
    if (row.cinc_property_id != null) byCincId.set(row.cinc_property_id, row)
    if (row.unit_number)              byUnit.set(String(row.unit_number).trim(), row)
  }

  const ownerInserts: OwnerInsertProposal[] = []
  const ownerUpdates: OwnerUpdateProposal[] = []
  let   ownerMatches = 0

  for (const prop of cincProperties) {
    const ext = extractOwner(prop)
    if (!ext) continue

    // Find our row: stable id first, then unit fallback.
    const existing = byCincId.get(ext.cinc_property_id)
                   ?? (ext.unit_number ? byUnit.get(String(ext.unit_number).trim()) : undefined)

    if (!existing) {
      const fullEmail = ext.email
      ownerInserts.push({
        kind:             'owner_insert',
        cinc_property_id: ext.cinc_property_id,
        unit_number:      ext.unit_number,
        first_name:       ext.first_name,
        last_name:        ext.last_name,
        emails:           fullEmail,
        phone:            ext.phone,
        address:          ext.address,
      })
      continue
    }

    // Compare every field; only flag a change if CINC has new info we don't.
    const changes: OwnerUpdateProposal['changes'] = {}
    if (ext.first_name && ext.first_name !== (existing.first_name ?? null)) {
      changes.first_name = { current: existing.first_name ?? null, proposed: ext.first_name }
    }
    if (ext.last_name && ext.last_name !== (existing.last_name ?? null)) {
      changes.last_name = { current: existing.last_name ?? null, proposed: ext.last_name }
    }
    if (ext.email && !emailsMatch(existing.emails, ext.email)) {
      changes.emails = { current: existing.emails ?? null, proposed: ext.email }
    }
    if (ext.phone && existing.phone !== ext.phone && existing.phone_2 !== ext.phone) {
      changes.phone = { current: existing.phone ?? null, proposed: ext.phone }
    }
    if (ext.address && ext.address !== (existing.address ?? null)) {
      changes.address = { current: existing.address ?? null, proposed: ext.address }
    }
    // Always propose linking the stable ref if it's missing locally.
    if (existing.cinc_property_id == null) {
      changes.cinc_property_id = { current: null, proposed: String(ext.cinc_property_id) }
    }

    if (Object.keys(changes).length === 0) {
      ownerMatches++
    } else {
      ownerUpdates.push({
        kind:             'owner_update',
        owners_id:        existing.id,
        cinc_property_id: ext.cinc_property_id,
        unit_number:      ext.unit_number,
        changes,
      })
    }
  }

  // ── Board side ────────────────────────────────────────────────────
  const { data: maiaBoard } = await supabaseAdmin
    .from('association_board_members')
    .select('id, cinc_board_member_id, name, email, role, active')
    .eq('association_code', code)

  const boardByCincId = new Map<number, NonNullable<typeof maiaBoard>[number]>()
  const boardByName   = new Map<string, NonNullable<typeof maiaBoard>[number]>()
  for (const row of (maiaBoard ?? [])) {
    if (row.cinc_board_member_id != null) boardByCincId.set(row.cinc_board_member_id, row)
    if (row.name) boardByName.set(row.name.toLowerCase().trim(), row)
  }
  const seenCincBoardIds = new Set<number>()

  const boardInserts:       BoardInsertProposal[]      = []
  const boardDeactivations: BoardDeactivationProposal[] = []
  let   boardMatches = 0

  for (const bm of cincBoard) {
    seenCincBoardIds.add(bm.BoardMemberId)
    const existing = boardByCincId.get(bm.BoardMemberId)
                   ?? (bm.BoardMemberName ? boardByName.get(bm.BoardMemberName.toLowerCase().trim()) : undefined)

    if (!existing) {
      boardInserts.push({
        kind:                 'board_insert',
        cinc_board_member_id: bm.BoardMemberId,
        name:                 bm.BoardMemberName ?? null,
        email:                (bm.Email ?? '').trim().toLowerCase() || null,
        role:                 bm.BoardMemberType ?? null,
        phone:                bm.MobilePhone || bm.HomePhone || bm.WorkPhone || null,
      })
    } else {
      boardMatches++
      // (Board updates kept out of V1 — only inserts + deactivations.
      // Edits to board members are rare and the existing /admin/board-setup
      // already covers them.)
    }
  }

  // Active MAIA rows that CINC no longer carries — propose deactivation.
  for (const row of (maiaBoard ?? [])) {
    if (!row.active) continue
    if (row.cinc_board_member_id != null && !seenCincBoardIds.has(row.cinc_board_member_id)) {
      boardDeactivations.push({
        kind:   'board_deactivate',
        abm_id: row.id,
        name:   row.name ?? null,
        email:  row.email ?? null,
        role:   row.role  ?? null,
        reason: 'not_in_cinc',
      })
    }
  }

  return {
    assocCode:          code,
    cincUnitCount:      cincProperties.length,
    cincBoardCount:     cincBoard.length,
    ownerInserts,
    ownerUpdates,
    boardInserts,
    boardDeactivations,
    ownerMatches,
    boardMatches,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Apply
// ─────────────────────────────────────────────────────────────────────

export interface ApplySelection {
  insertOwnerCincIds:        number[]   // cinc_property_id whitelist
  updateOwnerIds:            number[]   // owners.id whitelist
  insertBoardCincIds:        number[]   // cinc_board_member_id whitelist
  deactivateBoardIds:        string[]   // association_board_members.id whitelist
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

  // Association name (used on owner inserts so the column is denormalized
  // consistently with the rest of the codebase).
  const { data: assocRow } = await supabaseAdmin
    .from('associations')
    .select('association_name')
    .eq('association_code', code)
    .maybeSingle()
  const assocName = assocRow?.association_name ?? code

  // ── Owner inserts ─────────────────────────────────────────────────
  const insertSet = new Set(selection.insertOwnerCincIds)
  for (const p of preview.ownerInserts) {
    if (!insertSet.has(p.cinc_property_id)) continue
    const today = new Date().toISOString().slice(0, 10)
    const { data: inserted, error } = await supabaseAdmin
      .from('owners')
      .insert({
        association_code:     code,
        association_name:     assocName,
        unit_number:          p.unit_number,
        first_name:           p.first_name,
        last_name:            p.last_name,
        emails:               p.emails,
        phone:                p.phone,
        address:              p.address,
        status:               'active',
        ownership_start_date: today,
        cinc_property_id:     p.cinc_property_id,
      })
      .select('id')
      .single()
    if (error || !inserted) {
      errors.push(`owner insert (cinc_property_id=${p.cinc_property_id}): ${error?.message}`)
      continue
    }
    ownersInserted++

    // Audit trail
    await supabaseAdmin.from('ownership_history').insert({
      association_code:      code,
      unit_number:           p.unit_number,
      new_owner_id:          inserted.id,
      new_owner_name:        [p.first_name, p.last_name].filter(Boolean).join(' '),
      new_owner_emails:      p.emails,
      transfer_date:         today,
      source:                'import',
      actor_email:           actorEmail,
      notes:                 `Imported from CINC via /admin/cinc-sync (PropertyID=${p.cinc_property_id})`,
    })
  }

  // ── Owner updates ─────────────────────────────────────────────────
  const updateSet = new Set(selection.updateOwnerIds)
  for (const u of preview.ownerUpdates) {
    if (!updateSet.has(u.owners_id)) continue
    const patch: Record<string, unknown> = {}
    for (const [field, diff] of Object.entries(u.changes)) {
      // cinc_property_id was serialized as string in the diff; coerce.
      if (field === 'cinc_property_id') {
        patch.cinc_property_id = diff.proposed != null ? Number(diff.proposed) : null
      } else {
        patch[field] = diff.proposed
      }
    }
    if (Object.keys(patch).length === 0) continue
    const { error } = await supabaseAdmin.from('owners').update(patch).eq('id', u.owners_id)
    if (error) errors.push(`owner update (id=${u.owners_id}): ${error.message}`)
    else      ownersUpdated++
  }

  // ── Board inserts ─────────────────────────────────────────────────
  const boardInsertSet = new Set(selection.insertBoardCincIds)
  for (const b of preview.boardInserts) {
    if (!boardInsertSet.has(b.cinc_board_member_id)) continue
    const { error } = await supabaseAdmin.from('association_board_members').insert({
      association_code:     code,
      name:                 b.name ?? 'Board Member',
      email:                b.email,
      role:                 b.role,
      active:               true,
      cinc_board_member_id: b.cinc_board_member_id,
    })
    if (error) errors.push(`board insert (cinc_board_member_id=${b.cinc_board_member_id}): ${error.message}`)
    else      boardInserted++
  }

  // ── Board deactivations ───────────────────────────────────────────
  const boardDeactSet = new Set(selection.deactivateBoardIds)
  for (const d of preview.boardDeactivations) {
    if (!boardDeactSet.has(d.abm_id)) continue
    const { error } = await supabaseAdmin.from('association_board_members').update({ active: false }).eq('id', d.abm_id)
    if (error) errors.push(`board deactivate (id=${d.abm_id}): ${error.message}`)
    else      boardDeactivated++
  }

  return { ownersInserted, ownersUpdated, boardInserted, boardDeactivated, errors }
}
