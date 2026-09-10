// =====================================================================
// POST /api/admin/onboarding/[code]/decisions   (staff-only)
//
// Body: {
//   decisions: [{ key, value, note? }],
//   attribution: {
//     kind: 'board' | 'existing_config',
//     boardMemberId?: string,          // required for kind 'board'
//     source?: 'meeting' | 'email_consent',
//     sourceRef?: string,              // meeting date or consent email date
//   }
// }
// Identity facts ignore the attribution and are stamped as staff-confirmed.
// Board decisions are stamped with the named board member (name + role
// from association_board_members) and the source. Staff may also record an
// item as "existing configuration" — a snapshot of what is already live,
// not a board decision — so a running association can be back-filled
// without re-asking the board.
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession, staffLabel } from '@/lib/staff-auth'
import { recordDecisions, type Attribution } from '@/lib/onboarding'
import { isFactKey } from '@/lib/onboarding-catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  decisions?: { key?: string; value?: unknown; note?: string | null }[]
  attribution?: { kind?: string; boardMemberId?: string; source?: string; sourceRef?: string }
}

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { code } = await ctx.params
  const upper = code.toUpperCase()

  let body: Body
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const items = (body.decisions ?? []).filter(d => typeof d.key === 'string' && d.key.length > 0)
    .map(d => ({ key: d.key as string, value: d.value, note: d.note ?? null }))
  if (!items.length) return NextResponse.json({ error: 'decisions[] is required' }, { status: 400 })

  const a = body.attribution ?? {}
  // Identity facts never need a board member -- staff confirm them. Only look
  // up the attribution when at least one item is a real board decision.
  const allFacts = items.every(i => isFactKey(i.key))
  let attribution: Attribution
  if (allFacts) {
    attribution = { decidedBy: staffLabel(session), role: 'staff', source: 'staff_confirmed', sourceRef: null }
  } else if (a.kind === 'board') {
    const id = String(a.boardMemberId ?? '')
    if (!id) return NextResponse.json({ error: 'Choose the board member who decided' }, { status: 400 })
    const { data: m } = await supabaseAdmin.from('association_board_members').select('name, role, active')
      .eq('id', id).eq('association_code', upper).maybeSingle()
    if (!m || !m.active) return NextResponse.json({ error: 'That board member is not on this association’s active board' }, { status: 400 })
    const source = a.source === 'email_consent' ? 'email_consent' : a.source === 'meeting' ? 'meeting' : null
    if (!source) return NextResponse.json({ error: 'Source must be a board meeting or an email consent' }, { status: 400 })
    const sourceRef = String(a.sourceRef ?? '').trim()
    if (!sourceRef) return NextResponse.json({ error: source === 'meeting' ? 'Enter the meeting date' : 'Enter the date of the consent email' }, { status: 400 })
    attribution = { decidedBy: `${m.name}${m.role ? ` (${m.role})` : ''}`, role: 'board', source, sourceRef }
  } else if (a.kind === 'existing_config') {
    attribution = { decidedBy: staffLabel(session), role: 'staff', source: 'existing_config', sourceRef: null }
  } else {
    // Facts only — recordDecisions rejects a non-fact item under this attribution.
    attribution = { decidedBy: staffLabel(session), role: 'staff', source: 'staff_confirmed', sourceRef: null }
  }

  try {
    const decisions = await recordDecisions(upper, items, attribution, staffLabel(session))
    return NextResponse.json({ ok: true, decisions })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
