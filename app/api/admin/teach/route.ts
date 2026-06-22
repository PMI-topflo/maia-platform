// =====================================================================
// GET /api/admin/teach
// Lists taught-knowledge items for the studio, plus the association list
// for the scope picker + coverage matrix. Staff-only.
// Optional filters: ?association_code=&persona=&status=
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireStaff(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}

export async function GET(req: NextRequest) {
  if (!(await requireStaff(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  let q = supabaseAdmin
    .from('maia_knowledge')
    .select('id, association_code, persona, account_number, unit_number, title, source_kind, source_filename, understood_summary, approved_body, status, created_by, reviewed_by, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(500)

  const assoc = sp.get('association_code')
  if (assoc) q = q.eq('association_code', assoc)
  const persona = sp.get('persona')
  if (persona) q = q.eq('persona', persona)
  const status = sp.get('status')
  if (status) q = q.eq('status', status)

  const [{ data: items, error }, { data: associations }] = await Promise.all([
    q,
    supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .eq('active', true)
      .order('association_name', { ascending: true }),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    items: items ?? [],
    associations: (associations ?? []).filter(a => a.association_code && a.association_name),
  })
}
