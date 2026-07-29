// GET /api/board-certification/[token]
// Login-free context for the board-member self-upload page: who they are,
// the association, and what they've already uploaded. Token is the auth.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyBoardCertToken } from '@/lib/board-cert-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const data = await verifyBoardCertToken(token)
  if (!data) return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 401 })

  const [{ data: member }, { data: assoc }, { data: docs }] = await Promise.all([
    supabaseAdmin.from('association_board_members').select('id, name, role, association_code').eq('id', data.memberId).maybeSingle(),
    supabaseAdmin.from('associations').select('association_name').eq('association_code', data.assoc).maybeSingle(),
    supabaseAdmin.from('board_member_certifications')
      .select('id, doc_type, filename, status, created_at').eq('board_member_id', data.memberId)
      .order('created_at', { ascending: false }),
  ])
  if (!member || member.association_code.toUpperCase() !== data.assoc.toUpperCase()) {
    return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 404 })
  }

  return NextResponse.json({
    memberName:      member.name,
    role:            member.role,
    associationName: assoc?.association_name ?? data.assoc,
    uploaded: (docs ?? []).map(d => ({ id: d.id, doc_type: d.doc_type, filename: d.filename, status: d.status })),
  })
}
