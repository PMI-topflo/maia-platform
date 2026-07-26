// =====================================================================
// lib/units-portal-auth.ts
// Shared auth for the association unit-audit portal (/units + /api/units).
// Access: board | building_manager | unit_manager | staff, each scoped to
// their own association (staff may target any via an explicit assoc).
// =====================================================================

import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type UnitsPersona = 'board' | 'building_manager' | 'unit_manager' | 'staff'
const ALLOWED = new Set<UnitsPersona>(['board', 'building_manager', 'unit_manager', 'staff'])

export interface UnitsAuth {
  persona:   UnitsPersona
  userId:    string
  name:      string        // display name of the logged-in person
  assoc:     string        // resolved association code (upper)
  canUpload: boolean       // may submit documents into the approval queue
  canReview: boolean       // may approve/reject submissions (board + staff)
  managedUnits: string[] | null   // unit_manager restriction (else null)
}

/** Resolve + authorize a units-portal request. `paramAssoc` is honored only
 *  for staff (others are bound to their session's association). Returns null
 *  (caller → 401/redirect) when unauthenticated or wrong persona. */
export async function resolveUnitsAuth(paramAssoc?: string | null): Promise<UnitsAuth | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || !ALLOWED.has(session.persona as UnitsPersona)) return null
  const persona = session.persona as UnitsPersona

  const assoc = persona === 'staff'
    ? ((paramAssoc || session.associationCode || '').toUpperCase())
    : (session.associationCode || '').toUpperCase()
  if (!assoc) return null
  // A board/manager may only ever act on their own association.
  if (persona !== 'staff' && paramAssoc && paramAssoc.toUpperCase() !== assoc) return null

  let canUpload = persona === 'staff'
  let managedUnits: string[] | null = null
  if (persona === 'building_manager' || persona === 'unit_manager') {
    const table = persona === 'building_manager' ? 'building_managers' : 'unit_managers'
    const { data } = await supabaseAdmin.from(table)
      .select(persona === 'unit_manager' ? 'can_upload, managed_units' : 'can_upload')
      .eq('id', String(session.userId)).maybeSingle()
    canUpload = (data as { can_upload?: boolean } | null)?.can_upload ?? true
    if (persona === 'unit_manager') managedUnits = ((data as { managed_units?: string[] } | null)?.managed_units ?? []).map(String)
  } else if (persona === 'board') {
    canUpload = true   // board may upload + review
  }

  return {
    persona,
    userId: String(session.userId),
    name: session.displayName || session.contactName || persona,
    assoc,
    canUpload,
    canReview: persona === 'staff' || persona === 'board',
    managedUnits,
  }
}
