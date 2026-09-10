import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { activeBoardByEmail, activeBoardByPhoneFragment, type RosterMember } from '@/lib/board-roster'

export type AssocMatchedRole =
  | { type: 'staff' }
  | { type: 'owner';  owner_id: number; association_code: string; association_name: string; firstName?: string; lastName?: string }
  | { type: 'board';  board_member_id: string; association_code: string; association_name: string; position: string | null; firstName?: string; lastName?: string }
  | { type: 'tenant'; association_code: string; association_name: string; firstName?: string; lastName?: string }

export async function POST(req: NextRequest) {
  const { email, phone, associationCode } = await req.json()

  if ((!email && !phone) || !associationCode) {
    return NextResponse.json({ found: false, reason: 'missing_fields' })
  }

  const code   = (associationCode as string).toUpperCase()
  const digits = (phone ?? '').replace(/\D/g, '').slice(-10)

  const [staffRes, ownerEmailRes, ownerPhoneRes, boardEmailRes, boardPhoneRes, tenantEmailRes, tenantPhoneRes] = await Promise.all([
    // Staff — any domain, all associations
    email
      ? supabaseAdmin.from('pmi_staff').select('id').eq('active', true)
          .or(`email.ilike.%${email}%,personal_email.ilike.%${email}%`).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),

    // Owners — this association only, active
    email
      ? supabaseAdmin.from('owners')
          .select('id, association_code, association_name, first_name, last_name')
          .eq('association_code', code).ilike('emails', `%${email}%`).neq('status', 'previous').limit(5)
      : Promise.resolve({ data: [] }),

    digits.length >= 7
      ? supabaseAdmin.from('owners')
          .select('id, association_code, association_name, first_name, last_name')
          .eq('association_code', code)
          .or(`phone.ilike.%${digits}%,phone_e164.ilike.%${digits}%,phone_2.ilike.%${digits}%`)
          .neq('status', 'previous').limit(5)
      : Promise.resolve({ data: [] }),

    // Board members — the CINC-synced roster (association_board_members),
    // active only; the legacy board_members table is consulted only for a
    // phone match and only when that email is active on the roster. An
    // ex-member can no longer log in as board (2026-09-10).
    email ? activeBoardByEmail(email, code).then(rows => ({ data: rows })) : Promise.resolve({ data: [] }),
    digits.length >= 7 ? activeBoardByPhoneFragment(digits, code).then(rows => ({ data: rows })) : Promise.resolve({ data: [] }),

    // Tenants — this association only, active
    email
      ? supabaseAdmin.from('association_tenants')
          .select('id, association_code, association_name, first_name, last_name')
          .eq('association_code', code).ilike('email', `%${email}%`)
          .not('status', 'in', '("previous","expired")').limit(5)
      : Promise.resolve({ data: [] }),

    digits.length >= 7
      ? supabaseAdmin.from('association_tenants')
          .select('id, association_code, association_name, first_name, last_name')
          .eq('association_code', code).ilike('phone', `%${digits}%`)
          .not('status', 'in', '("previous","expired")').limit(5)
      : Promise.resolve({ data: [] }),
  ])

  const roles: AssocMatchedRole[] = []

  // Staff
  if ((staffRes as { data: { id: string } | null }).data?.id) {
    roles.push({ type: 'staff' })
  }

  // Association name (resolve once for board members)
  let assocName = code
  const { data: assocRow } = await supabaseAdmin
    .from('associations').select('association_name').eq('association_code', code).maybeSingle()
  if (assocRow?.association_name) assocName = assocRow.association_name

  // Owners
  type OwnerRow = { id: number; association_code: string; association_name: string; first_name?: string | null; last_name?: string | null }
  const ownerRows: OwnerRow[] = [
    ...((ownerEmailRes as { data: OwnerRow[] }).data ?? []),
    ...((ownerPhoneRes  as { data: OwnerRow[] }).data ?? []),
  ]
  const seenOwners = new Set<number>()
  for (const row of ownerRows) {
    if (seenOwners.has(row.id)) continue
    seenOwners.add(row.id)
    roles.push({ type: 'owner', owner_id: row.id, association_code: row.association_code, association_name: row.association_name ?? assocName, firstName: row.first_name ?? undefined, lastName: row.last_name ?? undefined })
  }

  // Board members
  const boardRows: RosterMember[] = [
    ...((boardEmailRes as { data: RosterMember[] }).data ?? []),
    ...((boardPhoneRes  as { data: RosterMember[] }).data ?? []),
  ]
  const seenBoard = new Set<string>()
  for (const row of boardRows) {
    if (seenBoard.has(row.id)) continue
    seenBoard.add(row.id)
    roles.push({ type: 'board', board_member_id: row.id, association_code: row.association_code, association_name: assocName, position: row.role ?? null, firstName: row.first_name ?? undefined, lastName: row.last_name ?? undefined })
  }

  // Tenants
  type TenantRow = { id: number; association_code: string; association_name: string; first_name?: string | null; last_name?: string | null }
  const tenantRows: TenantRow[] = [
    ...((tenantEmailRes as { data: TenantRow[] }).data ?? []),
    ...((tenantPhoneRes  as { data: TenantRow[] }).data ?? []),
  ]
  const seenTenants = new Set<number>()
  for (const row of tenantRows) {
    if (seenTenants.has(row.id)) continue
    seenTenants.add(row.id)
    roles.push({ type: 'tenant', association_code: row.association_code, association_name: row.association_name ?? assocName, firstName: row.first_name ?? undefined, lastName: row.last_name ?? undefined })
  }

  if (roles.length > 0) return NextResponse.json({ found: true, roles })

  // Previous owner/tenant check — block with a message
  type PrevRow = { id: number; first_name?: string | null; last_name?: string | null; association_name?: string | null; ownership_end_date?: string | null; lease_end_date?: string | null }
  const [prevOwnerRes, prevTenantRes] = await Promise.all([
    email
      ? supabaseAdmin.from('owners').select('id, first_name, last_name, association_name, ownership_end_date').eq('association_code', code).ilike('emails', `%${email}%`).eq('status', 'previous').limit(1)
      : Promise.resolve({ data: [] }),
    email
      ? supabaseAdmin.from('association_tenants').select('id, first_name, last_name, association_name, lease_end_date').eq('association_code', code).ilike('email', `%${email}%`).in('status', ['previous', 'expired']).limit(1)
      : Promise.resolve({ data: [] }),
  ])

  const prevRows: PrevRow[] = [
    ...((prevOwnerRes as { data: PrevRow[] }).data ?? []),
    ...((prevTenantRes as { data: PrevRow[] }).data ?? []),
  ]
  if (prevRows.length > 0) {
    const p = prevRows[0]
    return NextResponse.json({
      found: false,
      reason: 'previous_member',
      details: {
        name:     [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Resident',
        assocName: p.association_name ?? assocName,
        endDate:  p.ownership_end_date ?? p.lease_end_date ?? null,
      },
    })
  }

  return NextResponse.json({ found: false })
}
