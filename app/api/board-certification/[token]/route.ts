// GET /api/board-certification/[token]
// Login-free context for the board-member self-upload page: who they are,
// the association, and what they've already uploaded. Token is the auth.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyBoardCertToken } from '@/lib/board-cert-token'
import { certKindFromType, summarizeBoardMemberCert, type BoardCertDoc } from '@/lib/board-certification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const data = await verifyBoardCertToken(token)
  if (!data) return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 401 })

  const [{ data: member }, { data: assoc }, { data: docs }] = await Promise.all([
    supabaseAdmin.from('association_board_members').select('id, name, role, association_code, service_start_date, service_interrupted').eq('id', data.memberId).maybeSingle(),
    supabaseAdmin.from('associations').select('association_name, association_type').eq('association_code', data.assoc).maybeSingle(),
    supabaseAdmin.from('board_member_certifications')
      .select('id, doc_type, certificate_date, filename, status, created_at').eq('board_member_id', data.memberId)
      .order('created_at', { ascending: false }),
  ])
  if (!member || member.association_code.toUpperCase() !== data.assoc.toUpperCase()) {
    return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 404 })
  }

  const kind = certKindFromType((assoc as { association_type?: string | null } | null)?.association_type ?? null)
  const certDocs: BoardCertDoc[] = (docs ?? []).map(d => ({
    id: d.id, doc_type: d.doc_type as BoardCertDoc['doc_type'],
    certificate_date: d.certificate_date, status: d.status, filename: d.filename, created_at: d.created_at,
  }))
  const summary = summarizeBoardMemberCert(
    { service_start_date: (member as { service_start_date?: string | null }).service_start_date ?? null,
      service_interrupted: (member as { service_interrupted?: boolean | null }).service_interrupted ?? false },
    certDocs, kind,
  )

  return NextResponse.json({
    memberName:      member.name,
    role:            member.role,
    associationName: assoc?.association_name ?? data.assoc,
    kind,
    summary: {
      state: summary.state,
      initialCertExpiration: summary.initialCertExpiration,
      continuingEdDue: summary.continuingEdDue,
      continuingEdOverdue: summary.continuingEdOverdue,
    },
    uploaded: (docs ?? []).map(d => ({ id: d.id, doc_type: d.doc_type, certificate_date: d.certificate_date, filename: d.filename, status: d.status })),
  })
}
