// GET  /api/admin/board-members/signature?code=CODE → which members have a
//   saved approval signature.
// POST /api/admin/board-members/signature { code, email, signature }
//   Set (or clear) a board member's on-file approval signature (a PNG data URL).
//   Reused automatically on approval letters. Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const MAX = 400 * 1024   // generous for a signature PNG data URL

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const code = new URL(req.url).searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })
  const { data } = await supabaseAdmin.from('association_board_members')
    .select('email, name, role, signature_image').eq('association_code', code.toUpperCase()).eq('active', true)
  return NextResponse.json({ members: (data ?? []).map(m => ({ email: m.email, name: m.name, role: m.role, hasSignature: !!m.signature_image })) })
}

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let b: { code?: string; email?: string; signature?: string | null }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const code = String(b.code ?? '').trim().toUpperCase()
  const email = String(b.email ?? '').trim()
  if (!code || !email.includes('@')) return NextResponse.json({ error: 'code and member email required' }, { status: 400 })

  const sig = b.signature === null || b.signature === '' ? null : String(b.signature)
  if (sig && (!sig.startsWith('data:image') || sig.length > MAX)) return NextResponse.json({ error: 'invalid or too-large signature image' }, { status: 400 })

  const { error } = await supabaseAdmin.from('association_board_members')
    .update({ signature_image: sig }).eq('association_code', code).eq('email', email)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, hasSignature: !!sig })
}
