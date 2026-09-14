// =====================================================================
// lib/board-contact.ts
//
// The board's SHARED mailbox (associations.board_contact_email) and the
// rule for copying the board on an email an applicant also receives:
// the shared address goes on CC (visible), the members' and on-site
// managers' own addresses go on BCC (hidden). Without a shared mailbox
// the members are CC'd directly, as before — the Association Questions
// panel tells staff that their private emails will be visible until one
// is set. User direction, 2026-09-14 (MANXI: themanorsbuildingxi@gmail.com).
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

export interface BoardContact {
  shared:   string | null   // the shared mailbox, if set
  members:  string[]        // active board members' emails
  managers: string[]        // active on-site / building managers' emails
}

const clean = (e: unknown) => String(e ?? '').trim().toLowerCase()
const isEmail = (e: string) => e.includes('@')

export async function boardContactFor(associationCode: string): Promise<BoardContact> {
  const code = associationCode.toUpperCase()
  const [{ data: a }, { data: members }, { data: mgrs }] = await Promise.all([
    supabaseAdmin.from('associations').select('board_contact_email').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('association_board_members').select('email').eq('association_code', code).eq('active', true),
    supabaseAdmin.from('building_managers').select('email').eq('association_code', code).eq('active', true),
  ])
  const shared = clean(a?.board_contact_email)
  return {
    shared: isEmail(shared) ? shared : null,
    members: [...new Set((members ?? []).map(m => clean(m.email)).filter(isEmail))],
    managers: [...new Set((mgrs ?? []).map(m => clean(m.email)).filter(isEmail))],
  }
}

/** CC / BCC lists for an email the applicant receives that must also reach
 *  the board. `exclude` removes the applicant's own address(es). */
export async function boardCopyForApplicantEmail(associationCode: string, exclude: string[] = []): Promise<{ cc: string[]; bcc: string[]; shared: string | null }> {
  const c = await boardContactFor(associationCode)
  const skip = new Set(exclude.map(clean))
  const people = [...new Set([...c.members, ...c.managers])].filter(e => !skip.has(e) && e !== c.shared)
  if (c.shared) return { cc: [c.shared], bcc: people, shared: c.shared }
  return { cc: people, bcc: [], shared: null }
}
