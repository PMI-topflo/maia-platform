import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type MatchedRole =
  | { type: 'staff' }
  | { type: 'owner';  owner_id: number;       association_code: string; association_name: string; firstName?: string; lastName?: string }
  | { type: 'board';  board_member_id: string; association_code: string; association_name: string; position: string | null; firstName?: string; lastName?: string }
  | { type: 'tenant'; association_code: string; association_name: string }

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
  ] = await Promise.all([
    staffOr
      ? supabaseAdmin.from('pmi_staff').select('id').eq('active', true).or(staffOr).limit(1).single()
      : Promise.resolve({ data: null }),

    // Active owners only
    email
      ? supabaseAdmin.from('owners')
          .select('id, association_code, association_name, first_name, last_name')
          .ilike('emails', `%${email}%`)
          .neq('status', 'previous')
          .limit(5)
      : Promise.resolve({ data: [] }),

    digits.length >= 7
      ? supabaseAdmin.from('owners')
          .select('id, association_code, association_name, first_name, last_name')
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

    email
      ? supabaseAdmin.from('board_members')
          .select('id, association_code, first_name, last_name, position')
          .eq('active', true)
          .ilike('email', `%${email}%`)
          .limit(5)
      : Promise.resolve({ data: [] }),

    digits.length >= 7
      ? supabaseAdmin.from('board_members')
          .select('id, association_code, first_name, last_name, position')
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
  type OwnerRow = { id: number; association_code: string; association_name: string; first_name?: string | null; last_name?: string | null }
  const ownerRows: OwnerRow[] = [
    ...((ownerEmailRes as { data: OwnerRow[] }).data ?? []),
    ...((ownerPhoneRes  as { data: OwnerRow[] }).data ?? []),
  ]
  const seenOwners = new Set<number>()
  for (const row of ownerRows) {
    if (seenOwners.has(row.id) || !nameMatches(row) || !row.association_code) continue
    seenOwners.add(row.id)
    roles.push({
      type: 'owner',
      owner_id: row.id,
      association_code: row.association_code,
      association_name: row.association_name ?? '',
      firstName: row.first_name ?? undefined,
      lastName:  row.last_name  ?? undefined,
    })
  }

  // ── Board members — merge + deduplicate + resolve association names ────────
  type BoardRow = { id: string; association_code: string; first_name?: string | null; last_name?: string | null; position?: string | null }
  const boardRows: BoardRow[] = [
    ...((boardEmailRes as { data: BoardRow[] }).data ?? []),
    ...((boardPhoneRes  as { data: BoardRow[] }).data ?? []),
  ]
  const seenBoard = new Set<string>()
  const boardMatches: BoardRow[] = []
  for (const row of boardRows) {
    if (seenBoard.has(row.id) || !nameMatches(row) || !row.association_code) continue
    seenBoard.add(row.id)
    boardMatches.push(row)
  }

  if (boardMatches.length > 0) {
    const codes = [...new Set(boardMatches.map(r => r.association_code))]
    const { data: assocs } = await supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .in('association_code', codes)
    const nameMap: Record<string, string> = {}
    assocs?.forEach(a => { nameMap[a.association_code] = a.association_name })

    for (const row of boardMatches) {
      roles.push({
        type: 'board',
        board_member_id: row.id,
        association_code: row.association_code,
        association_name: nameMap[row.association_code] ?? row.association_code,
        position: row.position ?? null,
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
