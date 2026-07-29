// =====================================================================
// lib/staff-auth.ts
// Tiny helper for staff-only /api/admin routes (which are NOT covered by
// middleware.ts's matcher — the matcher guards the /admin *pages*, so each
// admin API route must check the session itself). Mirrors the inline
// pattern used across app/api/admin/**.
// =====================================================================

import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE, type SessionData } from '@/lib/session'

/** Returns the staff session, or null if the caller is not a signed-in
 *  staff user. */
export async function requireStaffSession(): Promise<SessionData | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}
