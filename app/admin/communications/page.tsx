import { cookies } from 'next/headers'

import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { resolveStaffByLoginEmail, staffCandidateEmails } from '@/lib/staff-lookup'
import CommunicationsDashboard from './components/CommunicationsDashboard'

export const metadata = { title: 'Communications — PMI Top Florida' }

export const dynamic = 'force-dynamic'

/** Read the new can_see_all_communications flag with migration
 *  tolerance — returns false silently when the column doesn't exist
 *  yet (so the page degrades to "everyone sees their own" instead
 *  of erroring). */
async function fetchCanSeeAll(staffId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('pmi_staff')
    .select('can_see_all_communications')
    .eq('id', staffId)
    .maybeSingle()
  if (error || !data) return false
  return (data as { can_see_all_communications?: boolean | null }).can_see_all_communications === true
}

interface AccessContext {
  canSeeAll:     boolean
  staffEmails:   string[]  // lowercased, includes alt_emails
  staffId:       string | null
}

async function getAccessContext(): Promise<AccessContext> {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    // Middleware should have blocked this already — defensive empty.
    return { canSeeAll: false, staffEmails: [], staffId: null }
  }
  const loginEmail = typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : ''

  const staffRow = loginEmail ? await resolveStaffByLoginEmail(loginEmail) : null
  if (!staffRow) {
    // Staff session but no pmi_staff record — fall back to filtering by
    // the login email alone. Better than showing everything.
    return {
      canSeeAll:   false,
      staffEmails: loginEmail ? [loginEmail] : [],
      staffId:     null,
    }
  }

  const canSeeAll = await fetchCanSeeAll(staffRow.id)
  return {
    canSeeAll,
    staffEmails: staffCandidateEmails(staffRow, loginEmail),
    staffId:     staffRow.id,
  }
}

/** Build a comma-separated, sanitized list for use inside an .in.() clause. */
function emailListForIn(emails: string[]): string {
  // Defensive: drop anything weird so we can't break the OR string.
  return emails.filter(e => /^[a-z0-9._+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e)).join(',')
}

async function getData(ctx: AccessContext) {
  const list = emailListForIn(ctx.staffEmails)
  const hasFilter = !ctx.canSeeAll && list.length > 0
  // If filtering is on and we somehow have no emails, return empty — fail safe.
  const restrictNothing = !ctx.canSeeAll && list.length === 0

  let convQuery = supabaseAdmin
    .from('general_conversations')
    .select('id, session_id, persona, language, association_code, topic, status, channel, contact_name, contact_phone, contact_email, assigned_to, handled_by, summary, message, response, subject, sender_email, created_at, updated_at, messages')
    .order('updated_at', { ascending: false })
    .limit(100)

  let emailQuery = supabaseAdmin
    .from('email_logs')
    .select('id, direction, from_email, to_email, subject, body_preview, persona, association_code, status, resend_message_id, sent_by, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  let ticketQuery = supabaseAdmin
    .from('tickets')
    .select('id, title:ticket_number, subject, description:summary, type, ticket_type:type, status, priority, association_code, channel_source:channel_origin, contact_name, contact_phone, contact_email, persona, assigned_to:assignee_email, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(100)

  let cmdQuery = supabaseAdmin
    .from('maia_email_commands')
    .select('id, sender_email, sender_name, subject, trigger_phrase, record_type, extracted_data, status, error_message, db_record_id, db_table, reply_sent, attachments, reference_code, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (hasFilter) {
    // Conversations: contact_email / sender_email / handled_by (staff id) / assigned_to (staff id)
    const orConv = [
      `contact_email.in.(${list})`,
      `sender_email.in.(${list})`,
    ]
    if (ctx.staffId) {
      orConv.push(`handled_by.eq.${ctx.staffId}`)
      orConv.push(`assigned_to.eq.${ctx.staffId}`)
    }
    convQuery = convQuery.or(orConv.join(','))

    emailQuery = emailQuery.or(
      `from_email.in.(${list}),to_email.in.(${list}),sent_by.in.(${list})`,
    )

    ticketQuery = ticketQuery.or(
      `contact_email.in.(${list}),assignee_email.in.(${list})`,
    )

    cmdQuery = cmdQuery.or(`sender_email.in.(${list})`)
  }
  // Defensive: if we have no emails AND can't see all, return empty results.
  if (restrictNothing) {
    return {
      conversations: [],
      emails:        [],
      tickets:       [],
      staff:         [],
      emailCommands: [],
      canSeeAll:     false,
    }
  }

  const [convRes, emailRes, ticketRes, staffRes, cmdRes] = await Promise.all([
    convQuery,
    emailQuery,
    ticketQuery,
    supabaseAdmin
      .from('pmi_staff')
      .select('id, name, email, role, department')
      .eq('active', true)
      .order('name'),
    cmdQuery,
  ])

  return {
    conversations: convRes.data ?? [],
    emails:        emailRes.data ?? [],
    tickets:       ticketRes.data ?? [],
    staff:         staffRes.data ?? [],
    emailCommands: cmdRes.data ?? [],
    canSeeAll:     ctx.canSeeAll,
  }
}

export default async function CommunicationsPage() {
  const ctx  = await getAccessContext()
  const data = await getData(ctx)

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <CommunicationsDashboard {...data} />
      </main>
    </div>
  )
}
