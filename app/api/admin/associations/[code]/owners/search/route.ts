// GET /api/admin/associations/[code]/owners/search?name=Joan%20Roberts
// Find owner/unit candidates in this association matching a named insured.
// Used to route a unit-owner HO-6 to the right unit. Staff-only.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export interface OwnerCandidate { account_number: string; name: string; unit_number: string | null; score: number }

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await ctx.params
  const assoc = (code ?? '').trim().toUpperCase()
  const name = (new URL(req.url).searchParams.get('name') ?? '').trim().toLowerCase()
  const tokens = name.split(/\s+/).filter(t => t.length > 1)

  const { data, error } = await supabaseAdmin
    .from('owners').select('account_number, unit_number, first_name, last_name, entity_name, status')
    .eq('association_code', assoc)
  if (error) return NextResponse.json({ candidates: [], error: error.message })

  const rows = (data ?? []) as { account_number: string | null; unit_number: string | null; first_name: string | null; last_name: string | null; entity_name: string | null; status: string | null }[]
  const candidates: OwnerCandidate[] = rows
    .filter(r => r.account_number)
    .map(r => {
      const full = `${r.first_name ?? ''} ${r.last_name ?? ''} ${r.entity_name ?? ''}`.toLowerCase()
      const score = tokens.length === 0 ? 0 : tokens.filter(t => full.includes(t)).length / tokens.length
      const display = (r.entity_name?.trim() || `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()) || r.account_number!
      return { account_number: r.account_number!, name: display, unit_number: r.unit_number, score: score + (r.status === 'active' ? 0.01 : 0) }
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)

  return NextResponse.json({ candidates })
}
