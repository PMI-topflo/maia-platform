// =====================================================================
// app/api/auth/my-roles/route.ts
//
// Returns the personas the current logged-in user is actually
// registered as — by scanning the persona tables for rows that match
// the session's login email (email OR personal_email where applicable).
//
// Used by the global UserMenu to render only the personas the user
// can legitimately switch to, instead of always showing all five
// portals.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveStaffByLoginEmail, staffCandidateEmails } from '@/lib/staff-lookup'
import { lookupPersonaRecord, type Persona } from '@/lib/profile-change'

export const dynamic = 'force-dynamic'

type PersonaType = 'staff' | 'owner' | 'tenant' | 'board' | 'unit_manager' | 'building_manager'

interface ResolvedRole {
  type:              PersonaType
  href:              string
  label:             string
  association_name?: string | null
}

function portalFor(type: PersonaType, opts: { ownerId?: number; boardMemberId?: string; assocCode?: string; assocName?: string | null }): ResolvedRole {
  switch (type) {
    case 'staff':
      return { type, href: '/admin',                                                                                                                  label: 'Staff Dashboard' }
    case 'owner':
      return { type, href: opts.ownerId && opts.assocCode ? `/my-account?id=${opts.ownerId}&assoc=${opts.assocCode}` : '/my-account',                  label: opts.assocName ? `Owner — ${opts.assocName}` : 'Owner Portal',     association_name: opts.assocName ?? null }
    case 'tenant':
      return { type, href: opts.assocCode ? `/tenant?assoc=${opts.assocCode}` : '/tenant',                                                              label: opts.assocName ? `Tenant — ${opts.assocName}` : 'Tenant Portal',   association_name: opts.assocName ?? null }
    case 'board':
      return { type, href: opts.boardMemberId && opts.assocCode ? `/board?id=${opts.boardMemberId}&assoc=${opts.assocCode}` : '/board',                label: opts.assocName ? `Board — ${opts.assocName}`  : 'Board Portal',    association_name: opts.assocName ?? null }
    case 'unit_manager':
      return { type, href: '/unit-manager',                                                                                                            label: opts.assocName ? `Unit Manager — ${opts.assocName}`     : 'Unit Manager',     association_name: opts.assocName ?? null }
    case 'building_manager':
      return { type, href: '/building-manager',                                                                                                        label: opts.assocName ? `Building Manager — ${opts.assocName}` : 'Building Manager', association_name: opts.assocName ?? null }
  }
}

export async function GET() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session) return NextResponse.json({ roles: [] }, { status: 401 })

  let loginEmail = typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : ''

  // Owner / board / manager sessions carry the record id (not the email), so
  // derive the email(s) from the current persona's record — otherwise we can't
  // find the user's OTHER personas to offer in the account switcher.
  let derivedEmails: string[] = []
  if (!loginEmail) {
    const rec = await lookupPersonaRecord(session.persona as Persona, { userId: session.userId, associationCode: session.associationCode })
    derivedEmails = (rec?.current_email ?? '').split(/[,;]/).map(s => s.trim().toLowerCase()).filter(e => e.includes('@'))
    if (derivedEmails.length) loginEmail = derivedEmails[0]
  }

  const roles: ResolvedRole[] = []

  // Resolve staff first — it tells us both whether the user IS staff
  // and gives us the full set of alternate addresses (email / personal_
  // email / alt_emails) we should also search the other persona tables
  // with. Otherwise a staffer who logs in as fabio@pmitop.com but is
  // also a unit owner registered under pmi@pmitop.com wouldn't see
  // their owner persona in this menu.
  const staffRow = loginEmail ? await resolveStaffByLoginEmail(loginEmail) : null
  if (session.persona === 'staff' || staffRow) {
    roles.push(portalFor('staff', {}))
  }

  if (!loginEmail) {
    return NextResponse.json({ roles })
  }

  // Build the full email set to query the other persona tables with.
  // If the user resolved to a staff row, search by every email tied to
  // that row (work + personal + alt_emails + the login email itself).
  // Otherwise just use the login email.
  const lookupEmails = staffRow ? staffCandidateEmails(staffRow, loginEmail) : (derivedEmails.length ? derivedEmails : [loginEmail])

  // Build .or() clauses for each table — Postgres ILIKE OR'd across
  // each candidate email. Empty list shouldn't happen but guard anyway.
  const emailIlikeOr  = (col: string) => lookupEmails.map(e => `${col}.ilike.${e}`).join(',')
  const emailsIlikeOr = (col: string) => lookupEmails.map(e => `${col}.ilike.%${e}%`).join(',')

  // Run the remaining table lookups in parallel.
  const [ownerRes, tenantRes, boardRes, unitMgrRes, bldgMgrRes] = await Promise.all([
    supabaseAdmin
      .from('owners')
      .select('id, association_code, association_name')
      .or(emailsIlikeOr('emails'))
      .or('status.neq.previous,status.is.null')
      .limit(10),
    supabaseAdmin
      .from('association_tenants')
      .select('association_code, association_name, status')
      .or(emailIlikeOr('email'))
      .in('status', ['active'])
      .limit(10),
    supabaseAdmin
      .from('association_board_members')
      .select('id, association_code')
      .or(emailIlikeOr('email'))
      .eq('active', true)
      .limit(10),
    supabaseAdmin
      .from('unit_managers')
      .select('id, association_code')
      .or(emailIlikeOr('email'))
      .eq('active', true)
      .limit(10),
    supabaseAdmin
      .from('building_managers')
      .select('id, association_code')
      .or(emailIlikeOr('email'))
      .eq('active', true)
      .limit(10),
  ])

  // Resolve association_name for board / unit_mgr / bldg_mgr (their rows
  // don't carry it). Cheap join — only the few codes we found.
  const codesNeedingName = new Set<string>()
  for (const r of (boardRes.data    ?? [])) if (r.association_code) codesNeedingName.add(r.association_code)
  for (const r of (unitMgrRes.data  ?? [])) if (r.association_code) codesNeedingName.add(r.association_code)
  for (const r of (bldgMgrRes.data  ?? [])) if (r.association_code) codesNeedingName.add(r.association_code)
  const nameByCode = new Map<string, string>()
  if (codesNeedingName.size > 0) {
    const { data: assocs } = await supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .in('association_code', [...codesNeedingName])
    for (const a of (assocs ?? [])) if (a.association_code) nameByCode.set(a.association_code, a.association_name ?? a.association_code)
  }

  for (const r of (ownerRes.data ?? [])) {
    roles.push(portalFor('owner', { ownerId: r.id, assocCode: r.association_code, assocName: r.association_name }))
  }
  for (const r of (tenantRes.data ?? [])) {
    roles.push(portalFor('tenant', { assocCode: r.association_code, assocName: r.association_name }))
  }
  for (const r of (boardRes.data ?? [])) {
    roles.push(portalFor('board', { boardMemberId: r.id, assocCode: r.association_code, assocName: nameByCode.get(r.association_code) ?? r.association_code }))
  }
  for (const r of (unitMgrRes.data ?? [])) {
    roles.push(portalFor('unit_manager', { assocCode: r.association_code, assocName: nameByCode.get(r.association_code) ?? r.association_code }))
  }
  for (const r of (bldgMgrRes.data ?? [])) {
    roles.push(portalFor('building_manager', { assocCode: r.association_code, assocName: nameByCode.get(r.association_code) ?? r.association_code }))
  }

  return NextResponse.json({ roles })
}
