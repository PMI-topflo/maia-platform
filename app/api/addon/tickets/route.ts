// =====================================================================
// GET /api/addon/tickets?mine=1&status=open&limit=25
//
// The add-on's homepage panel ("my tickets / work orders"). Defaults to
// the calling staffer's assigned, still-actionable items.
//   mine    — '1' (default): assigned to me; '0': all
//   status  — 'open' (default): open+pending+waiting_external; 'all': any
//   limit   — default 25, max 100
//
// Auth: add-on bearer token.
// =====================================================================

import { NextResponse } from 'next/server'
import { addonStaffEmail } from '@/lib/addon-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveStaffByLoginEmail, staffCandidateEmails, trustedDomainVariants } from '@/lib/staff-lookup'

export const dynamic = 'force-dynamic'

const ACTIONABLE = ['open', 'pending', 'waiting_external']

export async function GET(req: Request) {
  const staff = await addonStaffEmail(req)
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url     = new URL(req.url)
  const mine    = (url.searchParams.get('mine') ?? '1') !== '0'
  const status  = (url.searchParams.get('status') ?? 'open').toLowerCase()
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '25', 10)
  const limit   = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 25

  let q = supabaseAdmin
    .from('tickets')
    .select('id, ticket_number, type, status, priority, subject, association_code, contact_name, assignee_email, due_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (mine) {
    // Match every address that could be on assignee_email for this staffer.
    // Start with the login expanded across the trusted PMI domains
    // (<name>@topfloridaproperties.com ≡ <name>@pmitop.com), so it works
    // even if no staff row resolves; then add the staff record's emails.
    const candidates = new Set<string>(trustedDomainVariants(staff))
    const row = await resolveStaffByLoginEmail(staff)
    if (row) for (const e of staffCandidateEmails(row, staff)) candidates.add(e)
    q = q.in('assignee_email', [...candidates])
  }
  if (status !== 'all')  q = q.in('status', ACTIONABLE)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ staff, tickets: data ?? [] })
}
