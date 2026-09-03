// =====================================================================
// GET /api/addon/context?gmailThreadId=…&email=…
//
// The Gmail add-on calls this when an email is open to render its header:
// the matched open ticket on this thread/contact (if any), plus recent
// tickets for the same contact. Persona/association are surfaced best-
// effort from the most recent ticket for the contact.
//
// Auth: add-on bearer token (lib/addon-token.ts). Not session-gated.
// =====================================================================

import { NextResponse } from 'next/server'
import { addonStaffEmail } from '@/lib/addon-token'
import { findOpenTicketByGmailThread } from '@/lib/tickets'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// PMI work domains + shared role mailboxes. When a staffer FORWARDS an
// email, the add-on sees the sender as one of these (e.g. billing@), not
// the real external party — so matching "tickets for this contact" by it
// grabs unrelated tickets (every invoice forward shares billing@). Never
// contact-match on these; rely on the Gmail thread instead.
const PMI_DOMAINS = new Set(['topfloridaproperties.com', 'pmitop.com', 'mypmitop.com'])
function isInternalAddress(email: string | null): boolean {
  if (!email) return false
  const domain = email.split('@')[1] ?? ''
  return PMI_DOMAINS.has(domain)
}

export async function GET(req: Request) {
  const staff = await addonStaffEmail(req)
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url    = new URL(req.url)
  const thread = (url.searchParams.get('gmailThreadId') ?? '').trim() || null
  const email  = (url.searchParams.get('email') ?? '').trim().toLowerCase() || null

  // Only treat an EXTERNAL sender as a real contact. Internal/shared PMI
  // addresses (forwards) must not drive contact-matching.
  const contactEmail = email && !isInternalAddress(email) ? email : null

  // Matched open ticket: ONLY the Gmail thread is a reliable signal for
  // "this specific email is about this specific ticket." A contact-email
  // fallback used to also surface the sender's most recent open ticket on
  // ANY thread -- staff report, 2026-09-03: opened a brand-new inquiry email
  // about one unit and the sidebar showed "🔗 Linked ticket" for an
  // unrelated, older ticket about a different unit, just because the same
  // person had once emailed about that too. The contact's history is still
  // surfaced below as "recent tickets for this contact" (clearly labeled as
  // history, with its own manual 🔗 Link button per row) -- that distinction
  // is exactly the fix: history to review, not an auto-applied match
  // presented as fact.
  const matched = thread ? await findOpenTicketByGmailThread(thread) : null

  // Recent tickets for this contact (any status), newest first — external only.
  let recent: Array<Record<string, unknown>> = []
  if (contactEmail) {
    const { data } = await supabaseAdmin
      .from('tickets')
      .select('id, ticket_number, type, status, subject, association_code, assignee_email, updated_at')
      .eq('contact_email', contactEmail)
      .order('updated_at', { ascending: false })
      .limit(6)
    recent = data ?? []
  }

  // Best-effort persona/association from the matched or most-recent ticket.
  const ref = matched ?? (recent[0] as { association_code?: string | null; persona?: string | null } | undefined)
  return NextResponse.json({
    staff,
    contact:     { email },
    matched,
    recent,
    association: (ref as { association_code?: string | null } | null)?.association_code ?? null,
    persona:     (matched?.persona ?? null),
  })
}
