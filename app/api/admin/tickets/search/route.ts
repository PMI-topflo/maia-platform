// =====================================================================
// GET /api/admin/tickets/search?q=...
//
// Lightweight ticket search for picker UIs. Matches against ticket_number
// (exact prefix) and subject (ilike). Returns up to 20 rows sorted by
// updated_at desc. Excludes archived tickets.
//
// Used by the communications dashboard "Link to ticket" modal.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const q   = (url.searchParams.get('q') ?? '').trim()

  let query = supabaseAdmin
    .from('tickets')
    .select('id, ticket_number, subject, type, status, association_code, updated_at')
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (q) {
    const needle = q.replace(/[%_]/g, ch => `\\${ch}`)
    query = query.or(
      `ticket_number.ilike.%${needle}%,subject.ilike.%${needle}%`,
    )
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: `search failed: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ tickets: data ?? [] })
}
