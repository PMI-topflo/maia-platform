// =====================================================================
// GET /api/admin/pre-registrations   (staff-only)
// Lists pre-registrations newest first, for the triage dashboard.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin.from('pre_registrations')
    .select('id, phone, persona, full_name, email, association, unit, request, source, language, status, handled_by, handled_at, created_at')
    .order('created_at', { ascending: false })
    .limit(500)
  return NextResponse.json({ preRegistrations: data ?? [] })
}
