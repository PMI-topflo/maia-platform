// GET  /api/admin/onboarding/[code]/proposals   → latest run + proposals
// POST /api/admin/onboarding/[code]/proposals   { accept: [{id, value?}], reject: [id] }
//   Accepted → existing_config decision, applied at once. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession, staffLabel } from '@/lib/staff-auth'
import { listProposals, reviewProposals } from '@/lib/onboarding-proposals'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { code } = await ctx.params
  return NextResponse.json(await listProposals(code))
}

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { code } = await ctx.params
  let b: { accept?: unknown; reject?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const accept = (Array.isArray(b.accept) ? b.accept : []).map(a => { const o = (a ?? {}) as Record<string, unknown>; return { id: String(o.id ?? ''), value: o.value } }).filter(a => a.id)
  const reject = (Array.isArray(b.reject) ? b.reject : []).map(String)
  try {
    const r = await reviewProposals(code, { accept, reject }, staffLabel(session))
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
