// =====================================================================
// lib/board-certification-data.ts
//
// Server-side loaders for board-education tracking: pull each association's
// board members plus their uploaded certification documents and fold in the
// derived DBPR standing (lib/board-certification). Backs the Board officers
// box on /admin/cinc-sync/[code] and the board-cert block on /units.
//
// Resilient by design: if the 20260729 migration hasn't been applied yet the
// certification query fails softly and every member reads as "missing" —
// nothing throws.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  certKindFromType, summarizeBoardMemberCert,
  type BoardCertDoc, type BoardCertSummary, type CertKind,
} from '@/lib/board-certification'

export interface BoardMemberCert {
  id: string
  name: string | null
  email: string | null
  role: string | null
  serviceStartDate: string | null
  serviceInterrupted: boolean
  docs: BoardCertDoc[]
  summary: BoardCertSummary
}

export interface BoardCertOverview {
  associationCode: string
  kind: CertKind
  members: BoardMemberCert[]
  expiredCount: number
  expiringCount: number
  missingCount: number
}

/** Load the certification standing for every active board member of an
 *  association. */
export async function getBoardCertOverview(associationCode: string): Promise<BoardCertOverview> {
  const code = associationCode.toUpperCase()

  // Resilient to the 20260729 migration not being applied yet: the service_*
  // columns and the certifications table both soft-fail to empty rather than
  // throwing, so board members still list (just without cert data).
  const [{ data: assoc }, membersRes, certRes] = await Promise.all([
    supabaseAdmin.from('associations').select('association_type').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('association_board_members')
      .select('id, name, email, role, service_start_date, service_interrupted')
      .eq('association_code', code).eq('active', true).order('sort_order', { ascending: true })
      .then(r => r.error
        ? supabaseAdmin.from('association_board_members')
            .select('id, name, email, role').eq('association_code', code).eq('active', true).order('sort_order', { ascending: true })
        : r),
    supabaseAdmin.from('board_member_certifications')
      .select('id, board_member_id, board_member_email, doc_type, certificate_date, status, filename, created_at')
      .eq('association_code', code)
      .then(r => r, () => ({ data: [] as Record<string, unknown>[] })),
  ])
  const members = (membersRes?.data ?? []) as Array<{
    id: string; name: string | null; email: string | null; role: string | null
    service_start_date?: string | null; service_interrupted?: boolean | null
  }>

  const kind = certKindFromType(assoc?.association_type ?? null)
  const certs = (certRes?.data ?? []) as Array<{
    id: string; board_member_id: string | null; board_member_email: string | null
    doc_type: string; certificate_date: string | null; status: string; filename: string | null; created_at: string
  }>

  const membersOut: BoardMemberCert[] = (members ?? []).map(m => {
    // Match a cert to a member by id first, then by email (self-uploads that
    // predate a board re-sync can lose the id link).
    const docs: BoardCertDoc[] = certs
      .filter(c => c.board_member_id === m.id ||
        (!!c.board_member_email && !!m.email && c.board_member_email.toLowerCase() === m.email.toLowerCase()))
      .map(c => ({
        id: c.id, doc_type: c.doc_type as BoardCertDoc['doc_type'],
        certificate_date: c.certificate_date, status: c.status, filename: c.filename, created_at: c.created_at,
      }))
    const summary = summarizeBoardMemberCert(
      { service_start_date: m.service_start_date ?? null, service_interrupted: m.service_interrupted ?? false },
      docs, kind,
    )
    return {
      id: m.id, name: m.name, email: m.email, role: m.role,
      serviceStartDate: m.service_start_date ?? null,
      serviceInterrupted: !!m.service_interrupted,
      docs, summary,
    }
  })

  return {
    associationCode: code, kind, members: membersOut,
    expiredCount:  membersOut.filter(m => m.summary.state === 'expired').length,
    expiringCount: membersOut.filter(m => m.summary.state === 'expiring').length,
    missingCount:  membersOut.filter(m => m.summary.state === 'missing').length,
  }
}
