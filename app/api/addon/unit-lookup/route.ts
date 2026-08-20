// GET /api/addon/unit-lookup?assoc=CODE&unit=NNN
//
// "Who is on the other end of this email" as an explicit lookup, not a guess.
// The add-on's automatic thread/email matching (/api/addon/applications) is
// convenience for the common case; this is the verification tool for when
// staff genuinely don't know who they're talking to — the exact gap flagged
// in docs/APPLICATIONS-EMAIL-PLAYBOOK.md under "Persona detection": no
// automated tool existed, only "ask before guessing". This is that tool.
//
// Every persona tied to the unit, in one read: the owner(s) of record, the
// tenant on file, and — if there's an open application — its full roster
// plus any agents recorded on it. Agents are just application_stakeholders
// rows with role IN ('listing_agent','applicant_agent'), the same table as
// everyone else; there is no separate agents table.
//
// Auth: add-on bearer token.

import { NextResponse } from 'next/server'
import { addonStaffEmail } from '@/lib/addon-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { splitEmails } from '@/lib/document-request-email'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const staff = await addonStaffEmail(req)
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const assoc = (url.searchParams.get('assoc') ?? '').trim().toUpperCase()
  const unit = (url.searchParams.get('unit') ?? '').trim()
  if (!assoc || !unit) return NextResponse.json({ error: 'assoc and unit are required' }, { status: 400 })

  const [{ data: ownerRows }, { data: tenantRow }, { data: apps }] = await Promise.all([
    supabaseAdmin.from('owners')
      .select('first_name, last_name, entity_name, emails, phone')
      .eq('association_code', assoc).or(`unit_number.eq.${unit},account_number.eq.${assoc}${unit}`)
      .or('status.neq.previous,status.is.null'),
    supabaseAdmin.from('unit_tenant_contacts')
      .select('tenant_name, tenant_email, tenant_phone').eq('association_code', assoc).eq('unit_ref', unit).maybeSingle(),
    supabaseAdmin.from('listing_applications')
      .select('id, application_type, status, created_at').eq('association_code', assoc).eq('unit_label', unit)
      .order('created_at', { ascending: false }).limit(5),
  ])

  const owners = (ownerRows ?? []).map(o => ({
    name: (o.entity_name as string | null)?.trim() || [o.first_name, o.last_name].map(x => String(x ?? '').trim()).filter(Boolean).join(' ') || null,
    emails: splitEmails(o.emails), phone: (o.phone as string | null) ?? null,
  }))
  const tenant = tenantRow?.tenant_name || tenantRow?.tenant_email
    ? { name: (tenantRow?.tenant_name as string | null) ?? null, email: (tenantRow?.tenant_email as string | null) ?? null, phone: (tenantRow?.tenant_phone as string | null) ?? null }
    : null

  // The most recent OPEN application, so a decided one from a prior tenancy
  // doesn't surface a stale roster as if it were current.
  const openApp = (apps ?? []).find(a => ['started', 'submitted', 'under_review', 'approval_sent'].includes(String(a.status))) ?? null

  let applicants: { name: string | null; email: string | null; phone: string | null; role: string | null }[] = []
  let agents: { label: string; name: string | null; email: string | null; phone: string | null }[] = []
  if (openApp) {
    const { data: sh } = await supabaseAdmin.from('application_stakeholders')
      .select('role, applicant_role, name, email, phone').eq('application_id', openApp.id)
      .in('role', ['applicant', 'listing_agent', 'applicant_agent'])
      .order('is_primary', { ascending: false })
    applicants = (sh ?? []).filter(s => s.role === 'applicant')
      .map(s => ({ name: (s.name as string | null) ?? null, email: (s.email as string | null) ?? null, phone: (s.phone as string | null) ?? null, role: (s.applicant_role as string | null) ?? null }))
    agents = (sh ?? []).filter(s => s.role === 'listing_agent' || s.role === 'applicant_agent')
      .map(s => ({ label: s.role === 'listing_agent' ? "Owner's agent" : "Applicant's agent", name: (s.name as string | null) ?? null, email: (s.email as string | null) ?? null, phone: (s.phone as string | null) ?? null }))
      .filter(a => a.name || a.email)
  }

  return NextResponse.json({
    associationCode: assoc, unit,
    owners, tenant,
    applicationId: openApp?.id ?? null, applicationType: openApp?.application_type ?? null, applicationStatus: openApp?.status ?? null,
    applicants, agents,
  })
}
