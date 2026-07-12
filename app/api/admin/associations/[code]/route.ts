// =====================================================================
// PATCH /api/admin/associations/[code]
//
// Updates the core `associations` row's MAIA-only classification/identity
// fields (type, service level, statute, address, Sunbiz filing info,
// website). /api/admin/cinc-sync/onboard deliberately leaves these null
// when a new association is first onboarded ("staff fill in afterwards")
// — this is the "afterwards" write path, backing the "Edit details" modal
// on the Association Hub page. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const ASSOC_TYPES  = new Set(['condo', 'hoa', 'coop', 'commercial_condo', 'master_hoa'])
const SERVICE_TYPES = new Set(['full management', 'bookkeeping'])
const STATUTES      = new Set(['Chapter 718', 'Chapter 719', 'Chapter 720'])

function cleanText(v: unknown): string | null {
  const s = (typeof v === 'string' ? v : '').trim()
  return s.length ? s : null
}
function cleanEnum(v: unknown, allowed: Set<string>): string | null {
  const s = cleanText(v)
  return s && allowed.has(s) ? s : null
}

export async function PATCH(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await ctx.params
  const upperCode = code.toUpperCase()

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const patch = {
    association_type:       cleanEnum(body.association_type, ASSOC_TYPES),
    service_type:            cleanEnum(body.service_type, SERVICE_TYPES),
    florida_statute:         cleanEnum(body.florida_statute, STATUTES),
    principal_address:       cleanText(body.principal_address),
    city:                    cleanText(body.city),
    state:                   cleanText(body.state)?.toUpperCase().slice(0, 2) ?? null,
    zip:                     cleanText(body.zip),
    sunbiz_document_number:  cleanText(body.sunbiz_document_number),
    fei_ein_number:          cleanText(body.fei_ein_number),
    sunbiz_status:           cleanText(body.sunbiz_status),
    date_filed:              cleanText(body.date_filed),
    public_website_url:      cleanText(body.public_website_url),
  }

  const { data, error } = await supabaseAdmin
    .from('associations')
    .update(patch)
    .eq('association_code', upperCode)
    .select('association_code')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: `No association with code "${upperCode}"` }, { status: 404 })

  return NextResponse.json({ ok: true })
}
