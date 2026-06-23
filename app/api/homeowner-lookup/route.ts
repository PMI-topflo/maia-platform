import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveStaffByLoginEmail } from '@/lib/staff-lookup'

export type MatchedRole =
  | { type: 'staff' }
  | { type: 'owner';            owner_id: number;           association_code: string; association_name: string; firstName?: string; lastName?: string; unit_number?: string | null }
  | { type: 'board';            board_member_id: string;    association_code: string; association_name: string; position: string | null; firstName?: string; lastName?: string }
  | { type: 'tenant';           association_code: string;   association_name: string }
  | { type: 'unit_manager';     unit_manager_id: string;    association_code: string; association_name: string; managed_units: string[]; firstName?: string; lastName?: string }
  | { type: 'building_manager'; building_manager_id: string; association_code: string; association_name: string; firstName?: string; lastName?: string }

export async function POST(req: NextRequest) {
  const { firstName, lastName, email, phone } = await req.json()

  if (!email && !phone) {
    return NextResponse.json({ found: false, reason: 'missing_fields' })
  }

  const digits  = (phone ?? '').replace(/\D/g, '').slice(-10)
  const inFirst = (firstName ?? '').toLowerCase().trim()
  const inLast  = (lastName  ?? '').toLowerCase().trim()

  // Returns false only when a provided name (≥3 chars) has zero overlap with the DB record
  function nameMatches(row: { first_name?: string | null; last_name?: string | null }): boolean {
    if (!inFirst && !inLast) return true
    const dbFull = `${row.first_name ?? ''} ${row.last_name ?? ''}`.toLowerCase().trim()
    if (inFirst.length >= 3 && !dbFull.includes(inFirst) && !inFirst.startsWith(dbFull.split(' ')[0])) return false
    if (inLast.length >= 3  && !dbFull.includes(inLast)) return false
    return true
  }

  // ── Build staff OR clause ──────────────────────────────────────────────────
  const staffOr = [
    email          ? `email.ilike.%${email}%,personal_email.ilike.%${email}%` : null,
    digits.length >= 7 ? `phone.ilike.%${digits}%,personal_phone.ilike.%${digits}%` : null,
  ].filter(Boolean).join(',')

  // ── Fan out — all tables in parallel ──────────────────────────────────────
  const [
    staffRes,
    ownerEmailRes,
    ownerPhoneRes,
    prevOwnerEmailRes,
    prevOwnerPhoneRes,
    boardEmailRes,
    boardPhoneRes,
    unitMgrEmailRes,
    unitMgrPhoneRes,
    bldgMgrEmailRes,
    bldgMgrPhoneRes,
  ] = await Promise.all([
    // Staff — go through the canonical resolver so name-derived aliases
    // (jane@pmitop.com → "Jane Doe" row) and alt_emails entries also
    // count, not just literal email / personal_email matches. Phone-only
    // lookups still fall back to the OR filter via staffOr.
    email
      ? resolveStaffByLoginEmail(email).then(row => ({ data: row ? { id: row.id } : null }))
      : (staffOr
          ? supabaseAdmin.from('pmi_staff').select('id').eq('active', true).or(staffOr).limit(1).maybeSingle()
          : Promise.resolve({ data: null })
        ),

    // Active owners only
    email
      ? supabaseAdmin.from('owners')
          .select('id, association_code, association_name, first_name, last_name, unit_number')
          .ilike('emails', `%${email}%`)
          .neq('status', 'previous')
          .limit(5)
      : Promise.resolve({ data: [] }),

    digits.length >= 7
      ? supabaseAdmin.from('owners')
          .select('id, association_code, association_name, first_name, last_name, unit_number')
          .or(`phone.ilike.%${digits}%,phone_e164.ilike.%${digits}%,phone_2.ilike.%${digits}%,phone_3.ilike.%${digits}%`)
          .neq('status', 'previous')
          .limit(5)
      : Promise.resolve({ data: [] }),

    // Previous owners — separate check to show blocked message
    email
      ? supabaseAdmin.from('owners')
          .select('id, first_name, last_name, association_code, association_name, unit_number, ownership_end_date')
          .ilike('emails', `%${email}%`)
          .eq('status', 'previous')
          .order('ownership_end_date', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [] }),

    digits.length >= 7
      ? supabaseAdmin.from('owners')
          .select('id, first_name, last_name, association_code, association_name, unit_number, ownership_end_date')
          .or(`phone.ilike.%${digits}%,phone_e164.ilike.%${digits}%,phone_2.ilike.%${digits}%,phone_3.ilike.%${digits}%`)
          .eq('status', 'previous')
          .order('ownership_end_date', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [] }),

    // Board members live in `association_board_members` and store a
    // single `name` column + a `role` column (not first/last/position).
    // The original lookup queried a non-existent `board_members` table
    // and never matched anyone.
    email
      ? supabaseAdmin.from('association_board_members')
          .select('id, association_code, name, role')
          .eq('active', true)
          .ilike('email', `%${email}%`)
          .limit(5)
      : Promise.resolve({ data: [] }),

    digits.length >= 7
      ? Promise.resolve({ data: [] })  // schema has no phone column on this table
      : Promise.resolve({ data: [] }),

    // Unit managers
    email
      ? supabaseAdmin.from('unit_managers')
          .select('id, association_code, first_name, last_name, managed_units')
          .eq('active', true)
          .ilike('email', `%${email}%`)
          .limit(5)
      : Promise.resolve({ data: [] }),

    digits.length >= 7
      ? supabaseAdmin.from('unit_managers')
          .select('id, association_code, first_name, last_name, managed_units')
          .eq('active', true)
          .ilike('phone', `%${digits}%`)
          .limit(5)
      : Promise.resolve({ data: [] }),

    // Building managers
    email
      ? supabaseAdmin.from('building_managers')
          .select('id, association_code, first_name, last_name')
          .eq('active', true)
          .ilike('email', `%${email}%`)
          .limit(5)
      : Promise.resolve({ data: [] }),

    digits.length >= 7
      ? supabaseAdmin.from('building_managers')
          .select('id, association_code, first_name, last_name')
          .eq('active', true)
          .ilike('phone', `%${digits}%`)
          .limit(5)
      : Promise.resolve({ data: [] }),
  ])

  const roles: MatchedRole[] = []

  // ── Staff ─────────────────────────────────────────────────────────────────
  if ((staffRes as { data: { id: string } | null }).data?.id) {
    roles.push({ type: 'staff' })
  }

  // ── Owners — merge + deduplicate (active only) ────────────────────────────
  // A confirmed email or phone match IS the identifier here (the OTP sent to
  // the on-file contact is the real access gate). So the typed name must only
  // DISAMBIGUATE among matches — never veto one outright. A one-letter name
  // typo ("Subhaschandra" vs "Subhasschandra") used to drop a perfect
  // email+phone match and escalate the resident as "unidentified".
  type OwnerRow = { id: number; association_code: string; association_name: string; first_name?: string | null; last_name?: string | null; unit_number?: string | null }
  const emailOwners = (ownerEmailRes as { data: OwnerRow[] }).data ?? []
  const phoneOwners = (ownerPhoneRes as { data: OwnerRow[] }).data ?? []
  const phoneOwnerIds = new Set(phoneOwners.map(r => r.id))
  const ownerById = new Map<number, OwnerRow & { _phone: boolean }>()
  for (const row of [...emailOwners, ...phoneOwners]) {
    if (!row.association_code || ownerById.has(row.id)) continue
    ownerById.set(row.id, { ...row, _phone: phoneOwnerIds.has(row.id) })
  }
  let ownerCands = [...ownerById.values()]
  const ownerNameHits = ownerCands.filter(r => nameMatches(r))
  if (ownerNameHits.length) {
    // The name agrees with one or more matches — trust it to narrow.
    ownerCands = ownerNameHits
  } else if (email && digits.length >= 7) {
    // No name agreement (typo / nickname / maiden name). When BOTH email and
    // phone were given, prefer records corroborated by the phone too — this
    // drops a stray record that merely shares the email (a data-entry error).
    const corroborated = ownerCands.filter(r => r._phone)
    if (corroborated.length) ownerCands = corroborated
  }
  for (const row of ownerCands) {
    roles.push({
      type: 'owner',
      owner_id: row.id,
      association_code: row.association_code,
      association_name: row.association_name ?? '',
      firstName: row.first_name ?? undefined,
      lastName:  row.last_name  ?? undefined,
      unit_number: row.unit_number ?? null,
    })
  }

  // ── Board members — single `name` column in association_board_members
  //     gets split into first + last for the MatchedRole shape; `role`
  //     populates `position`.
  type BoardRow = { id: string; association_code: string; name?: string | null; role?: string | null }
  const boardRows: BoardRow[] = [
    ...((boardEmailRes as { data: BoardRow[] }).data ?? []),
    ...((boardPhoneRes  as { data: BoardRow[] }).data ?? []),
  ]
  const seenBoard = new Set<string>()
  const boardAll: BoardRow[] = []
  for (const row of boardRows) {
    if (seenBoard.has(row.id) || !row.association_code) continue
    seenBoard.add(row.id)
    boardAll.push(row)
  }
  // Name only narrows — an email match alone identifies a board member.
  const boardNamed = boardAll.filter(row => {
    const parts = (row.name ?? '').trim().split(/\s+/)
    return nameMatches({ first_name: parts[0] ?? null, last_name: parts.length > 1 ? parts.slice(1).join(' ') : null })
  })
  const boardMatches: BoardRow[] = boardNamed.length ? boardNamed : boardAll

  if (boardMatches.length > 0) {
    const codes = [...new Set(boardMatches.map(r => r.association_code))]
    const { data: assocs } = await supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .in('association_code', codes)
    const nameMap: Record<string, string> = {}
    assocs?.forEach(a => { nameMap[a.association_code] = a.association_name })

    for (const row of boardMatches) {
      const parts = (row.name ?? '').trim().split(/\s+/)
      roles.push({
        type: 'board',
        board_member_id: row.id,
        association_code: row.association_code,
        association_name: nameMap[row.association_code] ?? row.association_code,
        position: row.role ?? null,
        firstName: parts[0] ?? undefined,
        lastName:  parts.length > 1 ? parts.slice(1).join(' ') : undefined,
      })
    }
  }

  // ── Unit managers — merge + deduplicate ───────────────────────────────────
  type UnitMgrRow = { id: string; association_code: string; first_name?: string | null; last_name?: string | null; managed_units?: string[] | null }
  const unitMgrRows: UnitMgrRow[] = [
    ...((unitMgrEmailRes as { data: UnitMgrRow[] }).data ?? []),
    ...((unitMgrPhoneRes  as { data: UnitMgrRow[] }).data ?? []),
  ]
  const seenUnitMgr = new Set<string>()
  const unitMgrAll: UnitMgrRow[] = []
  for (const row of unitMgrRows) {
    if (seenUnitMgr.has(row.id) || !row.association_code) continue
    seenUnitMgr.add(row.id)
    unitMgrAll.push(row)
  }
  const unitMgrNamed = unitMgrAll.filter(r => nameMatches(r))
  const unitMgrMatches: UnitMgrRow[] = unitMgrNamed.length ? unitMgrNamed : unitMgrAll

  if (unitMgrMatches.length > 0) {
    const codes = [...new Set(unitMgrMatches.map(r => r.association_code))]
    const { data: assocs } = await supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .in('association_code', codes)
    const nameMap: Record<string, string> = {}
    assocs?.forEach(a => { nameMap[a.association_code] = a.association_name })

    for (const row of unitMgrMatches) {
      roles.push({
        type: 'unit_manager',
        unit_manager_id: row.id,
        association_code: row.association_code,
        association_name: nameMap[row.association_code] ?? row.association_code,
        managed_units: row.managed_units ?? [],
        firstName: row.first_name ?? undefined,
        lastName:  row.last_name  ?? undefined,
      })
    }
  }

  // ── Building managers — merge + deduplicate ────────────────────────────────
  type BldgMgrRow = { id: string; association_code: string; first_name?: string | null; last_name?: string | null }
  const bldgMgrRows: BldgMgrRow[] = [
    ...((bldgMgrEmailRes as { data: BldgMgrRow[] }).data ?? []),
    ...((bldgMgrPhoneRes  as { data: BldgMgrRow[] }).data ?? []),
  ]
  const seenBldgMgr = new Set<string>()
  const bldgMgrAll: BldgMgrRow[] = []
  for (const row of bldgMgrRows) {
    if (seenBldgMgr.has(row.id) || !row.association_code) continue
    seenBldgMgr.add(row.id)
    bldgMgrAll.push(row)
  }
  const bldgMgrNamed = bldgMgrAll.filter(r => nameMatches(r))
  const bldgMgrMatches: BldgMgrRow[] = bldgMgrNamed.length ? bldgMgrNamed : bldgMgrAll

  if (bldgMgrMatches.length > 0) {
    const codes = [...new Set(bldgMgrMatches.map(r => r.association_code))]
    const { data: assocs } = await supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .in('association_code', codes)
    const nameMap: Record<string, string> = {}
    assocs?.forEach(a => { nameMap[a.association_code] = a.association_name })

    for (const row of bldgMgrMatches) {
      roles.push({
        type: 'building_manager',
        building_manager_id: row.id,
        association_code: row.association_code,
        association_name: nameMap[row.association_code] ?? row.association_code,
        firstName: row.first_name ?? undefined,
        lastName:  row.last_name  ?? undefined,
      })
    }
  }

  // ── Previous owner check — block access, return specific reason ───────────
  if (roles.length === 0) {
    type PrevRow = { id: number; first_name?: string | null; last_name?: string | null; association_code: string; association_name?: string | null; unit_number?: string | null; ownership_end_date?: string | null }
    const prevRows: PrevRow[] = [
      ...((prevOwnerEmailRes as { data: PrevRow[] }).data ?? []),
      ...((prevOwnerPhoneRes as { data: PrevRow[] }).data ?? []),
    ]
    const prevMatch = prevRows.find(r => nameMatches(r))
    if (prevMatch) {
      void supabaseAdmin.from('login_history').insert({
        event:          'previous_owner_blocked',
        identifier:     email ?? phone ?? '',
        persona:        'owner',
        association_code: prevMatch.association_code ?? null,
        ip_address:     'unknown',
        success:        false,
        failure_reason: 'previous_owner',
        role_data:      prevMatch,
      })
      return NextResponse.json({
        found:  false,
        reason: 'previous_owner',
        details: {
          name:      [prevMatch.first_name, prevMatch.last_name].filter(Boolean).join(' ') || 'Owner',
          assocName: prevMatch.association_name ?? prevMatch.association_code,
          unit:      prevMatch.unit_number ?? null,
          endDate:   prevMatch.ownership_end_date ?? null,
        },
      })
    }

    return NextResponse.json({ found: false })
  }

  return NextResponse.json({ found: true, roles })
}
