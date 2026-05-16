// =====================================================================
// PATCH /api/admin/cinc-sync/[code]/owner/[id]
// Lets staff edit an owner's emails + phone + secondary phone directly
// from the cinc-sync diff page. The motivation is that CINC's homeowner
// record can't reliably hold international phone numbers (it loses or
// reformats them), so MAIA needs to own those fields outright — and
// staff want to fix them without leaving the sync workflow.
//
// Body:
//   { emails?: string|null, phone?: string|null, phone_2?: string|null }
//
// All three fields are optional; only the keys present in the request
// body get written. Empty string is normalized to NULL so staff can
// blank a field. Phones are run through normalizePhone() so we always
// store the E.164 form (+1XXXXXXXXXX for US, "+<digits>" otherwise).
//
// Authorized: staff persona only. Association code is in the URL for
// log/audit symmetry with the other cinc-sync routes; the owner row
// itself is keyed by integer id (path param).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizePhone } from '@/lib/cinc-sync'

export const dynamic = 'force-dynamic'

interface Body {
  emails?:  string | null
  phone?:   string | null
  phone_2?: string | null
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ code: string; id: string }> },
) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { code, id } = await ctx.params
  const ownerId = Number(id)
  if (!Number.isFinite(ownerId) || ownerId <= 0) {
    return NextResponse.json({ error: 'Invalid owner id' }, { status: 400 })
  }

  let body: Body
  try { body = await req.json() as Body }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  // Build the patch — only include fields the request actually carried
  // so we never accidentally NULL out something the caller didn't touch.
  const patch: Record<string, string | null> = {}

  if ('emails' in body) {
    // Normalize: trim each entry, drop empties, lower-case, dedupe.
    // Empty result → null so the column reads as "no emails" rather
    // than as an empty string.
    const cleaned = (body.emails ?? '')
      .split(/[,;]/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
    const deduped = [...new Set(cleaned)]
    patch.emails = deduped.length === 0 ? null : deduped.join(',')
  }
  if ('phone'   in body) patch.phone   = normalizePhone(body.phone)
  if ('phone_2' in body) patch.phone_2 = normalizePhone(body.phone_2)

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // Scope the update by both id AND association_code so a typo in the
  // URL can't cross-contaminate a different association's data.
  const { data, error } = await supabaseAdmin
    .from('owners')
    .update(patch)
    .eq('id', ownerId)
    .eq('association_code', code.toUpperCase())
    .select('id, emails, phone, phone_2')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Owner not found for this association' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, owner: data })
}
