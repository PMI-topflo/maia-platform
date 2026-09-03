// GET /api/pre-apply/lookup?code=XXX&unit=YYY
//
// Public, pre-token lookup for the /pre-apply/[code] landing flow. Two things
// the welcome/contact steps need before any stakeholder/token exists yet:
//   - the association's real display name -- the hero used to hardcode one
//     specific association's name regardless of which [code] the link was
//     for, so every OTHER association's link showed the wrong community.
//   - whether a given unit number is on file (owners table), so the new
//     "confirm your unit" step can tell the applicant whether it matched
//     something real instead of silently accepting a typo.
//
// No PII returned -- this runs before identity is verified.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const code = (sp.get('code') ?? '').trim().toUpperCase()
  const unit = (sp.get('unit') ?? '').trim()
  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 })

  const { data: assoc } = await supabaseAdmin.from('associations')
    .select('association_name, legal_name, active').eq('association_code', code).maybeSingle()
  if (!assoc || assoc.active === false) {
    return NextResponse.json({ active: false, associationName: null, unitFound: null })
  }

  // Soft signal, never a hard block -- not every unit is guaranteed a row
  // here (a brand-new building, a data gap), so "not found" just tells the
  // applicant to double-check the number, it doesn't stop them.
  let unitFound: boolean | null = null
  if (unit) {
    const { data: owner } = await supabaseAdmin.from('owners')
      .select('id').eq('association_code', code).eq('unit_number', unit).maybeSingle()
    unitFound = !!owner
  }

  return NextResponse.json({
    active: true,
    associationName: (assoc.association_name as string | null) || (assoc.legal_name as string | null) || code,
    unitFound,
  })
}
