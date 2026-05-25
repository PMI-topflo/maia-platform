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
  loginEmail:    string    // bare login email — drives the default emailTo filter
}

async function getAccessContext(): Promise<AccessContext> {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    // Middleware should have blocked this already — defensive empty.
    return { canSeeAll: false, staffEmails: [], staffId: null, loginEmail: '' }
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
      loginEmail,
    }
  }

  const canSeeAll = await fetchCanSeeAll(staffRow.id)
  return {
    canSeeAll,
    staffEmails: staffCandidateEmails(staffRow, loginEmail),
    staffId:     staffRow.id,
    loginEmail,
  }
}

/** Build a comma-separated, sanitized list for use inside an .in.() clause. */
function emailListForIn(emails: string[]): string {
  // Defensive: drop anything weird so we can't break the OR string.
  return emails.filter(e => /^[a-z0-9._+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e)).join(',')
}

// MAIA's own sending addresses. Non-owner staff see emails to/from
// these in addition to their own, so the MAIA-handled mail stream is
// visible alongside their personal correspondence.
const MAIA_EMAILS = ['maia@pmitop.com', 'noreply@pmitop.com', 'no-reply@pmitop.com']

/** Extract bare lowercase email addresses from a raw header value that
 *  may be "Name <addr>", "<addr>", or a comma/semicolon-separated list.
 *  The From/To dropdown options must be bare addresses so the client
 *  filter (which also normalizes) matches them exactly. */
function extractEmailAddrs(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[,;]/)
    .map(part => {
      const m = part.match(/<([^>]+)>/)
      return (m ? m[1] : part).trim().toLowerCase()
    })
    .filter(a => a.includes('@'))
}

/** Probe email_logs for the optional columns we'd like to SELECT.
 *  Returns a per-column boolean. Cached for the lifetime of the
 *  request — Next.js re-creates this module's state per request. */
async function detectOptionalColumns(): Promise<{
  dismissed_at:        boolean
  dismissed_by_email:  boolean
  gmail_thread_id:     boolean
  email_date:          boolean
}> {
  const probe = async (col: string): Promise<boolean> => {
    const { error } = await supabaseAdmin.from('email_logs').select(col).limit(0)
    return !error
  }
  const [d1, d2, t, ed] = await Promise.all([
    probe('dismissed_at'),
    probe('dismissed_by_email'),
    probe('gmail_thread_id'),
    probe('email_date'),
  ])
  return { dismissed_at: d1, dismissed_by_email: d2, gmail_thread_id: t, email_date: ed }
}

async function getData(
  ctx: AccessContext,
  showDismissed: boolean,
  emailFilters: { to: string; from: string },
  showConvArchived: boolean,
) {
  const list = emailListForIn(ctx.staffEmails)
  // Email queries also include MAIA's own addresses so a non-owner
  // staffer sees the MAIA mail stream, not just their personal mail.
  const emailList = emailListForIn([...ctx.staffEmails, ...MAIA_EMAILS])
  const hasFilter = !ctx.canSeeAll && list.length > 0
  // If filtering is on and we somehow have no emails, return empty — fail safe.
  const restrictNothing = !ctx.canSeeAll && list.length === 0
  // Conversations/tickets: a row with no handler AND no assignee is an
  // unclaimed MAIA-handled item — every staffer sees the shared queue
  // so they can pick items up and attach them to tickets.
  const convUnclaimed   = 'and(handled_by.is.null,assigned_to.is.null)'

  // 10-day window for the working set — staff catch up daily, so older
  // mail just clutters the queue. Past data is still in email_logs and
  // can be queried directly if needed.
  const tenDaysAgo = new Date(Date.now() - 10 * 86400 * 1000).toISOString()

  // Migration-tolerant probe for the soft-archive column. When absent
  // (migration not applied) we just skip the archive filter + column.
  const convArchivedExists = await (async () => {
    const { error } = await supabaseAdmin.from('general_conversations').select('archived_at').limit(0)
    return !error
  })()

  const convCols =
    'id, session_id, persona, language, association_code, topic, status, channel, contact_name, contact_phone, contact_email, assigned_to, handled_by, summary, message, response, subject, sender_email, gmail_thread_id, created_at, updated_at, messages'
    + (convArchivedExists ? ', archived_at' : '')

  let convQuery = supabaseAdmin
    .from('general_conversations')
    .select(convCols)
    .order('updated_at', { ascending: false })
    .limit(100)

  // Default view hides archived conversations; the toggle includes them.
  if (convArchivedExists && !showConvArchived) {
    convQuery = convQuery.is('archived_at', null)
  }

  // Migration-tolerant column list. Probes each optional column once
  // and omits it from the SELECT if the migration that adds it hasn't
  // been applied. Prevents the whole page from rendering 0 emails just
  // because one column is missing.
  const optionalCols = await detectOptionalColumns()
  const emailCols = [
    'id', 'direction', 'from_email', 'to_email', 'subject', 'body_preview',
    'persona', 'association_code', 'status', 'resend_message_id', 'sent_by',
    'created_at',
    ...(optionalCols.dismissed_at        ? ['dismissed_at']        : []),
    ...(optionalCols.dismissed_by_email  ? ['dismissed_by_email']  : []),
    ...(optionalCols.gmail_thread_id     ? ['gmail_thread_id']     : []),
    ...(optionalCols.email_date          ? ['email_date']          : []),
  ].join(', ')

  // The 10-day working window applies to the DEFAULT (unfiltered) view
  // only. Once a Staff inbox or sender is picked, the whole history is
  // shown so the view mirrors the entire Gmail inbox — including mail
  // older than 10 days.
  const inboxFilterActive = !!(emailFilters.to || emailFilters.from)

  // The server query orders + windows by created_at (always present,
  // never null). The DISPLAYED order is then re-sorted client-side by
  // the email's true date (email_date ?? created_at) — see emailWhen()
  // in CommunicationsDashboard. This avoids a column-wide email_date
  // backfill (146k rows): a brand-new email_date column is simply NULL
  // for old rows and the client falls back to created_at for those.

  // count: 'exact' returns the TRUE number of matching rows even though
  // .limit() caps the loaded set at 1000 — so the on-screen count is
  // accurate (e.g. "13,300 emails") instead of always showing 1000.
  let emailQuery = supabaseAdmin
    .from('email_logs')
    .select(emailCols, { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(1000)
  if (!inboxFilterActive) {
    emailQuery = emailQuery.gte('created_at', tenDaysAgo)
  }

  // Default view hides dismissed rows. Show-dismissed toggle includes them.
  // maia@ is a normal inbox — its inbound mail is filtered by the same
  // noise denylist as every other account, so the standard dismissed
  // filter applies to it too. (An earlier maia@-only exception existed
  // while maia@ inbound was blanket-hidden; that hide was removed in
  // #134, so the exception is gone — it would otherwise surface tens
  // of thousands of dismissed noise rows whenever To=maia@ was picked.)
  if (!showDismissed && optionalCols.dismissed_at) {
    emailQuery = emailQuery.is('dismissed_at', null)
  }

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
    // Conversations: own (contact / sender / handler / assignee) PLUS
    // the unclaimed MAIA queue.
    const orConv = [
      `contact_email.in.(${list})`,
      `sender_email.in.(${list})`,
      convUnclaimed,
    ]
    if (ctx.staffId) {
      orConv.push(`handled_by.eq.${ctx.staffId}`)
      orConv.push(`assigned_to.eq.${ctx.staffId}`)
    }
    convQuery = convQuery.or(orConv.join(','))

    // Emails: own + MAIA's own addresses.
    emailQuery = emailQuery.or(
      `from_email.in.(${emailList}),to_email.in.(${emailList}),sent_by.in.(${emailList})`,
    )

    // Tickets: own (contact / assignee) PLUS unassigned MAIA-created tickets.
    ticketQuery = ticketQuery.or(
      `contact_email.in.(${list}),assignee_email.in.(${list}),assignee_email.is.null`,
    )

    cmdQuery = cmdQuery.or(`sender_email.in.(${emailList})`)
  }

  // Server-side recipient / sender filter. Applied as a substring
  // (ilike) match so it tolerates bracket-wrapped + multi-recipient
  // header values — and, crucially, it searches the whole 10-day
  // window instead of only the 1000 rows that load into the table.
  // Without this, picking a low-volume inbox (billing@, pmi@) from
  // the dropdown returned nothing because its mail fell outside the
  // 1000 most-recent rows.
  const likeEscape = (s: string) => s.replace(/[%_\\]/g, c => `\\${c}`)
  if (emailFilters.to)   emailQuery = emailQuery.ilike('to_email',   `%${likeEscape(emailFilters.to)}%`)
  if (emailFilters.from) emailQuery = emailQuery.ilike('from_email', `%${likeEscape(emailFilters.from)}%`)

  // Defensive: if we have no emails AND can't see all, return empty results.
  if (restrictNothing) {
    return {
      conversations:             [],
      emails:                    [],
      tickets:                   [],
      staff:                     [],
      emailCommands:             [],
      canSeeAll:                 false,
      emailFromOptions:          [],
      emailToOptions:            [],
      conversationSenderOptions: [],
      emailTotal:                0,
    }
  }

  // Comprehensive option list for the From (sender) filter. Same 10-day
  // window as the on-screen list. ORDER BY created_at DESC ensures the
  // 10k sample skews to recent rows (so every actively-used sender is
  // represented), instead of an arbitrary slice. The To filter no
  // longer samples here — it is the curated "Staff" inbox list below.
  let emailOptsQuery = supabaseAdmin
    .from('email_logs')
    .select('from_email')
    .gte('created_at', tenDaysAgo)
    .order('created_at', { ascending: false })
    .limit(10_000)
  if (hasFilter) {
    emailOptsQuery = emailOptsQuery.or(
      `from_email.in.(${emailList}),to_email.in.(${emailList}),sent_by.in.(${emailList})`,
    )
  }

  let convOptsQuery = supabaseAdmin
    .from('general_conversations')
    .select('sender_email, contact_email')
    .gte('updated_at', tenDaysAgo)
    .order('updated_at', { ascending: false })
    .limit(10_000)
  if (hasFilter) {
    const orConvOpts = [
      `contact_email.in.(${list})`,
      `sender_email.in.(${list})`,
      convUnclaimed,
    ]
    if (ctx.staffId) {
      orConvOpts.push(`handled_by.eq.${ctx.staffId}`)
      orConvOpts.push(`assigned_to.eq.${ctx.staffId}`)
    }
    convOptsQuery = convOptsQuery.or(orConvOpts.join(','))
  }

  // Connected staff inboxes — these ARE the "Staff" filter options
  // (a curated list of the team's mailboxes, not every address ever
  // seen). maia@ is added on top since it runs on the app's own
  // credentials and isn't a staff_gmail_accounts row.
  const staffInboxesQuery = supabaseAdmin
    .from('staff_gmail_accounts')
    .select('gmail_address')
    .eq('active', true)

  const [convRes, emailRes, ticketRes, staffRes, cmdRes, emailOptsRes, convOptsRes, staffInboxesRes] = await Promise.all([
    convQuery,
    emailQuery,
    ticketQuery,
    supabaseAdmin
      .from('pmi_staff')
      .select('id, name, email, role, department')
      .eq('active', true)
      .order('name'),
    cmdQuery,
    emailOptsQuery,
    convOptsQuery,
    staffInboxesQuery,
  ])

  // From (sender) filter options — sampled from real traffic.
  const emailFromSet = new Set<string>()
  for (const r of (emailOptsRes.data ?? []) as Array<{ from_email: string | null }>) {
    for (const a of extractEmailAddrs(r.from_email)) emailFromSet.add(a)
  }
  emailFromSet.add('maia@pmitop.com')

  // "Staff" filter options — the curated set of team mailboxes: every
  // active connected inbox plus maia@. This is intentionally NOT every
  // recipient address ever seen; picking one filters to that inbox.
  // Always include the logged-in staff's own email so the default
  // "filter to my inbox" view shows a selected option even when that
  // mailbox isn't registered in staff_gmail_accounts.
  const emailToSet = new Set<string>()
  for (const inbox of (staffInboxesRes.data ?? []) as Array<{ gmail_address: string | null }>) {
    for (const a of extractEmailAddrs(inbox.gmail_address)) emailToSet.add(a)
  }
  emailToSet.add('maia@pmitop.com')
  if (ctx.loginEmail) emailToSet.add(ctx.loginEmail)

  const convSenderSet = new Set<string>()
  for (const r of (convOptsRes.data ?? []) as Array<{ sender_email: string | null; contact_email: string | null }>) {
    for (const a of extractEmailAddrs(r.sender_email ?? r.contact_email)) convSenderSet.add(a)
  }

  // True email-thread sizes for every Gmail thread that appears on the
  // Conversations tab — so the "✉ N in thread" badge reflects the FULL
  // Gmail thread (inbound + outbound, every recipient), not just the
  // subset that hit MAIA. Queries email_logs directly so the count is
  // not bounded by the 10-day window or the 1000-row email load cap.
  const convThreadIds = Array.from(
    new Set(
      ((convRes.data ?? []) as unknown as Array<{ gmail_thread_id: string | null }>)
        .map(c => c.gmail_thread_id)
        .filter((t): t is string => !!t),
    ),
  )
  const emailThreadCounts: Record<string, number> = {}
  if (convThreadIds.length > 0 && optionalCols.gmail_thread_id) {
    // Fetch all email_logs rows for these threads; counted client-side
    // because PostgREST has no group-by. The rows are tiny (id only) so
    // this stays fast even for hundreds of threads.
    const { data: threadEmails } = await supabaseAdmin
      .from('email_logs')
      .select('gmail_thread_id')
      .in('gmail_thread_id', convThreadIds)
      .limit(10_000)
    for (const r of (threadEmails ?? []) as Array<{ gmail_thread_id: string | null }>) {
      const t = r.gmail_thread_id
      if (!t) continue
      emailThreadCounts[t] = (emailThreadCounts[t] ?? 0) + 1
    }
  }

  return {
    // Cast through any — dynamic .select(string) collapses Supabase's
    // inferred shape; the dashboard's runtime guards handle missing cols.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conversations:             (convRes.data ?? []) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emails:                    (emailRes.data ?? []) as any,
    tickets:                   ticketRes.data ?? [],
    staff:                     staffRes.data ?? [],
    emailCommands:             cmdRes.data ?? [],
    canSeeAll:                 ctx.canSeeAll,
    emailFromOptions:          Array.from(emailFromSet).sort(),
    emailToOptions:            Array.from(emailToSet).sort(),
    conversationSenderOptions: Array.from(convSenderSet).sort(),
    // True total of matching emails (may exceed the 1000 loaded rows).
    emailTotal:                emailRes.count ?? (emailRes.data?.length ?? 0),
    emailThreadCounts,
  }
}

export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ dismissed?: string; emailTo?: string; emailFrom?: string; convArchived?: string }>
}) {
  const sp = await searchParams
  const showDismissed    = sp.dismissed    === '1'
  const showConvArchived = sp.convArchived === '1'
  // Validate the From/To filter params — they drive a server query, so
  // only accept well-formed email addresses; anything else → no filter.
  const asEmail = (v: string | undefined): string => {
    const lc = (v ?? '').toLowerCase().trim()
    return /^[a-z0-9._+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(lc) ? lc : ''
  }
  const ctx  = await getAccessContext()

  // Default the To-filter to the logged-in staff member's inbox so
  // every navigation lands on "my mail" instead of the global queue.
  // ?emailTo=all is an explicit opt-out the dropdown writes when the
  // user picks "All staff"; otherwise a missing param means "use my
  // own inbox". canSeeAll users (owners) get no default — they're the
  // ones who actively want the cross-staff view.
  const rawEmailTo = (sp.emailTo ?? '').toLowerCase().trim()
  const emailToResolved =
      rawEmailTo === 'all'              ? ''                        // explicit override → no filter
    : asEmail(sp.emailTo)               ? asEmail(sp.emailTo)       // explicit email
    : (!ctx.canSeeAll && ctx.loginEmail) ? ctx.loginEmail            // default → my inbox
    :                                     ''                        // owner / no login
  const emailFilters = { to: emailToResolved, from: asEmail(sp.emailFrom) }
  const data = await getData(ctx, showDismissed, emailFilters, showConvArchived)

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <CommunicationsDashboard
          {...data}
          showDismissed={showDismissed}
          emailTo={emailFilters.to}
          emailFrom={emailFilters.from}
          showConvArchived={showConvArchived}
        />
      </main>
    </div>
  )
}
