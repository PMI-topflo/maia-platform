// POST /api/admin/pre-apply/[id]/agents
//   { owner_agent?: {name,email,phone}, applicant_agent?: {name,email,phone} }
// Save the owner's agent (listing_agent) and the applicant's agent
// (applicant_agent) so they get CC'd on every request + communication. An empty
// name clears that agent. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizePhone } from '@/lib/cinc-sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface AgentIn { name?: string; email?: string; phone?: string }

async function upsertAgent(appId: string, role: 'listing_agent' | 'applicant_agent', a: AgentIn | undefined) {
  if (!a) return
  const name = String(a.name ?? '').trim()
  const email = String(a.email ?? '').trim()
  if (email && !email.includes('@')) throw new Error('Enter a valid agent email.')
  const { data: existing } = await supabaseAdmin.from('application_stakeholders')
    .select('id').eq('application_id', appId).eq('role', role).maybeSingle()

  if (!name && !email) {
    // Cleared → remove the agent row (never touches applicant/owner rows).
    if (existing) await supabaseAdmin.from('application_stakeholders').delete().eq('id', existing.id)
    return
  }
  const row = { name: name || null, email: email || null, phone: normalizePhone(a.phone) ?? (String(a.phone ?? '').trim() || null), updated_at: new Date().toISOString() }
  if (existing) await supabaseAdmin.from('application_stakeholders').update(row).eq('id', existing.id)
  else await supabaseAdmin.from('application_stakeholders').insert({ application_id: appId, role, status: 'active', added_by_role: 'staff', ...row })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: app } = await supabaseAdmin.from('listing_applications').select('id').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let b: { owner_agent?: AgentIn; applicant_agent?: AgentIn }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  try {
    if ('owner_agent' in b) await upsertAgent(id, 'listing_agent', b.owner_agent)
    if ('applicant_agent' in b) await upsertAgent(id, 'applicant_agent', b.applicant_agent)
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }) }
  return NextResponse.json({ ok: true })
}
