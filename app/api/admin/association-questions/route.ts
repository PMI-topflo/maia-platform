// =====================================================================
// /api/admin/association-questions   (staff-only)
// GET   → pets_allowed / requires_interview_lease / requires_interview_purchase
//         for every association — the "Association Questions" section on
//         /admin/association-document-setup.
// PATCH → { associationCode, ...fields } partial update of the same three
//         booleans. requires_interview_purchase drives
//         lib/board-decision-letter.ts's advanceToApprovalSent — flipping it
//         off does not touch an interview already requested/completed on an
//         in-flight application, only future ones.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FIELDS = ['pets_allowed', 'requires_interview_lease', 'requires_interview_purchase'] as const
type Field = typeof FIELDS[number]

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin.from('associations')
    .select('association_code, association_name, pets_allowed, requires_interview_lease, requires_interview_purchase')
    .order('association_name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ associations: data ?? [] })
}

export async function PATCH(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { associationCode?: string } & Partial<Record<Field, unknown>>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const associationCode = String(body.associationCode ?? '').trim().toUpperCase()
  if (!associationCode) return NextResponse.json({ error: 'associationCode is required' }, { status: 400 })

  const patch: Partial<Record<Field, boolean>> = {}
  for (const f of FIELDS) if (typeof body[f] === 'boolean') patch[f] = body[f] as boolean
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'no recognized fields in body' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('associations').update(patch)
    .eq('association_code', associationCode).select('association_code').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: `No association with code "${associationCode}"` }, { status: 404 })
  return NextResponse.json({ ok: true })
}
