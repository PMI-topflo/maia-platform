// =====================================================================
// POST /api/admin/cinc-sync/onboard
// Creates a MAIA `associations` row for an association that exists in
// CINC but isn't onboarded into MAIA yet. After the row is created,
// the caller is expected to navigate to /admin/cinc-sync/<code> and
// run the normal owner + board import.
//
// Body:
//   { assocCode: string }     // required, case-insensitive
//
// Behavior:
//   - Verifies the staff session
//   - Pulls authoritative metadata from CINC (name, unit count) so the
//     MAIA row is named exactly as CINC has it
//   - Upserts on association_code so re-runs are idempotent — staff can
//     click Onboard twice without creating a duplicate
//   - Leaves association_type / service_type / florida_statute as null;
//     they're MAIA-only classifications staff fill in afterwards
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAssociationMeta } from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

interface Body {
  assocCode?: string
}

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Body
  try { body = await req.json() as Body }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const code = (body.assocCode ?? '').trim().toUpperCase()
  if (!code) {
    return NextResponse.json({ error: 'assocCode is required' }, { status: 400 })
  }

  // Look CINC up first so we know the row would carry valid metadata
  // before we touch the DB. If CINC has no such association the user
  // is probably typing the code by hand into the URL.
  const meta = await getAssociationMeta(code)
  if (!meta) {
    return NextResponse.json(
      { error: `CINC has no association with code "${code}"` },
      { status: 404 },
    )
  }

  // Guard against double-onboarding. Idempotent: existing rows return
  // ok=true without overwriting.
  const { data: existing } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name')
    .eq('association_code', code)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      ok:               true,
      created:          false,
      association_code: existing.association_code,
      association_name: existing.association_name,
      message:          'Already onboarded — skipping insert.',
    })
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('associations')
    .insert({
      association_code: code,
      association_name: meta.AssociationName,
      // active=true so the new association immediately shows up in
      // dropdowns (board-setup, applications, etc.). Staff can
      // classify type/service afterwards.
      active:           true,
    })
    .select('association_code, association_name')
    .single()

  if (error || !inserted) {
    return NextResponse.json(
      { error: `Failed to create association row: ${error?.message ?? 'no row returned'}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok:               true,
    created:          true,
    association_code: inserted.association_code,
    association_name: inserted.association_name,
    cincUnitCount:    meta.Numberofunits,
  })
}
