// =====================================================================
// GET /api/portal/documents?assoc=CODE
//
// Resident-portal documents for an association, sourced from MAIA (not
// Drive). Session-gated: staff see any association; owner / board / tenant
// / manager personas may only read their OWN association's documents.
// Returns short-lived signed download URLs — fetched client-side after
// login so the URLs never land in a public page.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getPortalDocuments } from '@/lib/portal-documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const assoc = (new URL(req.url).searchParams.get('assoc') ?? '').trim().toUpperCase()
  if (!assoc) return NextResponse.json({ error: 'assoc is required' }, { status: 400 })

  // Staff can view any association; everyone else is locked to their own.
  if (session.persona !== 'staff' && (session.associationCode ?? '').toUpperCase() !== assoc) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const groups = await getPortalDocuments(assoc)
  return NextResponse.json({ groups })
}
