// =====================================================================
// lib/reports/association-stats.ts
//
// Computes a per-association activity rollup (Received / Sent / Response
// time / Tickets) over a rolling window. Reads existing tables only —
// no schema changes — and is migration-tolerant: missing columns or
// pre-migration tables degrade silently to zeros rather than throwing.
//
// Inputs:
//   - associationCode (uppercase canonical, e.g. "ABBOTT")
//   - opts.windowDays (default 30)
//
// Buckets every message by channel (email/sms/whatsapp/voice/web/other)
// and by contact type (board → owner → tenant → other, first hit wins).
// Response-time is computed from gmail_thread_id: first non-staff inbound
// → first staff outbound after it. Capped at 200 threads for p95 budget.
// =====================================================================
import { supabaseAdmin } from '@/lib/supabase-admin'

export type Channel =
  | 'email'
  | 'sms'
  | 'whatsapp'
  | 'voice'
  | 'web'
  | 'other'

export type ChannelBreakdown = {
  email:    number
  sms:      number
  whatsapp: number
  voice:    number
  web:      number
  other:    number
}

export type ContactBreakdown = {
  board:  number
  owner:  number
  tenant: number
  other:  number
}

export type AssociationStats = {
  windowDays: number
  messagesReceived: {
    total:      number
    byChannel:  ChannelBreakdown
    byContact:  ContactBreakdown
  }
  messagesSent: {
    total:      number
    byChannel:  ChannelBreakdown
    byContact:  ContactBreakdown
  }
  responseTime: {
    avgMinutes:      number | null
    medianMinutes:   number | null
    threadsAnalyzed: number
  }
  tickets: {
    opened:           number
    resolved:         number
    openNow:          number
    avgResolveHours:  number | null
  }
}

function emptyChannelBreakdown(): ChannelBreakdown {
  return { email: 0, sms: 0, whatsapp: 0, voice: 0, web: 0, other: 0 }
}

function emptyContactBreakdown(): ContactBreakdown {
  return { board: 0, owner: 0, tenant: 0, other: 0 }
}

export function emptyStats(windowDays: number): AssociationStats {
  return {
    windowDays,
    messagesReceived: { total: 0, byChannel: emptyChannelBreakdown(), byContact: emptyContactBreakdown() },
    messagesSent:     { total: 0, byChannel: emptyChannelBreakdown(), byContact: emptyContactBreakdown() },
    responseTime:     { avgMinutes: null, medianMinutes: null, threadsAnalyzed: 0 },
    tickets:          { opened: 0, resolved: 0, openNow: 0, avgResolveHours: null },
  }
}

function lower(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

function normalizeChannel(c: string | null | undefined): Channel {
  const v = lower(c)
  if (v === 'email')    return 'email'
  if (v === 'sms')      return 'sms'
  if (v === 'whatsapp') return 'whatsapp'
  if (v === 'voice' || v === 'phone' || v === 'call') return 'voice'
  if (v === 'web' || v === 'chat' || v === 'widget') return 'web'
  return 'other'
}

// Split a comma/semicolon-separated email field (owners.emails stores
// multiple addresses in one column).
function splitEmails(s: string | null | undefined): string[] {
  if (!s) return []
  return s.split(/[,;\s]+/).map(e => lower(e)).filter(e => e.includes('@'))
}

// Pull the contact-classification sets for an association. Each Set
// holds lowercased emails. Phone numbers are kept in a separate Set per
// role (digits-only, last 10) for SMS/WhatsApp/voice attribution.
type ContactSets = {
  boardEmails:  Set<string>
  ownerEmails:  Set<string>
  tenantEmails: Set<string>
  boardPhones:  Set<string>
  ownerPhones:  Set<string>
  tenantPhones: Set<string>
}

function digits(s: string | null | undefined): string {
  const d = (s ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : d
}

async function loadContactSets(associationCode: string): Promise<ContactSets> {
  const sets: ContactSets = {
    boardEmails:  new Set(),
    ownerEmails:  new Set(),
    tenantEmails: new Set(),
    boardPhones:  new Set(),
    ownerPhones:  new Set(),
    tenantPhones: new Set(),
  }

  const [boardRes, ownerRes, tenantRes] = await Promise.all([
    supabaseAdmin
      .from('board_members')
      .select('email, phone')
      .eq('association_code', associationCode)
      .eq('active', true),
    supabaseAdmin
      .from('owners')
      .select('emails, phone, phone_e164, phone_2')
      .eq('association_code', associationCode)
      .or('status.neq.previous,status.is.null'),
    supabaseAdmin
      .from('association_tenants')
      .select('email, phone')
      .eq('association_code', associationCode)
      .not('status', 'in', '("previous","expired")'),
  ])

  for (const b of (boardRes.data ?? []) as Array<{ email: string | null; phone: string | null }>) {
    if (b.email) sets.boardEmails.add(lower(b.email))
    const d = digits(b.phone)
    if (d) sets.boardPhones.add(d)
  }
  for (const o of (ownerRes.data ?? []) as Array<{ emails: string | null; phone: string | null; phone_e164: string | null; phone_2: string | null }>) {
    for (const e of splitEmails(o.emails)) sets.ownerEmails.add(e)
    for (const p of [o.phone, o.phone_e164, o.phone_2]) {
      const d = digits(p)
      if (d) sets.ownerPhones.add(d)
    }
  }
  for (const t of (tenantRes.data ?? []) as Array<{ email: string | null; phone: string | null }>) {
    if (t.email) sets.tenantEmails.add(lower(t.email))
    const d = digits(t.phone)
    if (d) sets.tenantPhones.add(d)
  }

  return sets
}

// Resolve staff-owned outbound addresses (staff_gmail_accounts.gmail_address
// plus pmi_staff email/personal_email/alt_emails). Used to distinguish
// staff replies from MAIA-only replies, and to mark thread responses.
async function loadStaffEmails(): Promise<Set<string>> {
  const out = new Set<string>()
  const [gmailRes, staffRes] = await Promise.all([
    supabaseAdmin.from('staff_gmail_accounts').select('gmail_address'),
    supabaseAdmin.from('pmi_staff').select('email, personal_email, alt_emails'),
  ])
  for (const r of (gmailRes.data ?? []) as Array<{ gmail_address: string | null }>) {
    if (r.gmail_address) out.add(lower(r.gmail_address))
  }
  for (const r of (staffRes.data ?? []) as Array<{ email: string | null; personal_email: string | null; alt_emails: string[] | null }>) {
    if (r.email)          out.add(lower(r.email))
    if (r.personal_email) out.add(lower(r.personal_email))
    for (const a of r.alt_emails ?? []) if (a) out.add(lower(a))
  }
  // MAIA also sends as maia@pmitop.com — treat it as staff-side.
  out.add('maia@pmitop.com')
  return out
}

function classifyContact(
  email: string | null | undefined,
  phone: string | null | undefined,
  sets:  ContactSets,
): keyof ContactBreakdown {
  const e = lower(email)
  if (e) {
    if (sets.boardEmails.has(e))  return 'board'
    if (sets.ownerEmails.has(e))  return 'owner'
    if (sets.tenantEmails.has(e)) return 'tenant'
  }
  const d = digits(phone)
  if (d) {
    if (sets.boardPhones.has(d))  return 'board'
    if (sets.ownerPhones.has(d))  return 'owner'
    if (sets.tenantPhones.has(d)) return 'tenant'
  }
  return 'other'
}

// ──────────────────────────────────────────────────────────────────────
// Email logs — direction is explicit. Inbound: classify sender. Outbound:
// classify recipient. Channel is always 'email'.
// ──────────────────────────────────────────────────────────────────────
type EmailLogRow = {
  direction:       'inbound' | 'outbound' | null
  from_email:      string | null
  to_email:        string | null
  created_at:      string | null
  gmail_thread_id: string | null
  dismissed_at:    string | null
}

async function fetchEmailLogs(associationCode: string, sinceIso: string): Promise<EmailLogRow[]> {
  // First attempt with `dismissed_at IS NULL` filter. If the column
  // doesn't exist yet, retry without it for backward-compat.
  const { data, error } = await supabaseAdmin
    .from('email_logs')
    .select('direction, from_email, to_email, created_at, gmail_thread_id, dismissed_at')
    .eq('association_code', associationCode)
    .gte('created_at', sinceIso)
    .is('dismissed_at', null)
    .limit(5000)
  if (!error) return (data ?? []) as EmailLogRow[]

  if (/dismissed_at/.test(error.message)) {
    const { data: fallback } = await supabaseAdmin
      .from('email_logs')
      .select('direction, from_email, to_email, created_at, gmail_thread_id')
      .eq('association_code', associationCode)
      .gte('created_at', sinceIso)
      .limit(5000)
    return ((fallback ?? []) as Omit<EmailLogRow, 'dismissed_at'>[]).map(r => ({ ...r, dismissed_at: null }))
  }
  return []
}

// ──────────────────────────────────────────────────────────────────────
// general_conversations — no explicit direction column. Conversations
// represent inbound contact from a person, then MAIA replies. We count
// the first message (sender_email/contact_email + created_at) as 1
// inbound on the row's channel, and each `assistant`/`outbound` entry
// inside messages[] as 1 outbound on the same channel.
// ──────────────────────────────────────────────────────────────────────
type ConversationRow = {
  channel:         string | null
  sender_email:    string | null
  contact_email:   string | null
  contact_phone:   string | null
  created_at:      string | null
  messages:        unknown
}

async function fetchConversations(associationCode: string, sinceIso: string): Promise<ConversationRow[]> {
  const { data, error } = await supabaseAdmin
    .from('general_conversations')
    .select('channel, sender_email, contact_email, contact_phone, created_at, messages')
    .eq('association_code', associationCode)
    .gte('created_at', sinceIso)
    .limit(2000)
  if (error) return []
  return (data ?? []) as ConversationRow[]
}

// ──────────────────────────────────────────────────────────────────────
// Tickets — opened/resolved counts and resolution-time average.
// resolved_at exists on the schema; we also fall back to updated_at on
// rows whose status is resolved/closed if resolved_at is null (defensive).
// ──────────────────────────────────────────────────────────────────────
type TicketRow = {
  status:      string | null
  created_at:  string | null
  resolved_at: string | null
  updated_at?: string | null
}

async function fetchTickets(associationCode: string, sinceIso: string): Promise<{
  windowed: TicketRow[]
  openNow:  number
}> {
  const [windowedRes, openNowRes] = await Promise.all([
    supabaseAdmin
      .from('tickets')
      .select('status, created_at, resolved_at, updated_at')
      .eq('association_code', associationCode)
      .gte('created_at', sinceIso)
      .limit(5000),
    supabaseAdmin
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('association_code', associationCode)
      .in('status', ['open', 'pending', 'waiting_external']),
  ])
  return {
    windowed: (windowedRes.data ?? []) as TicketRow[],
    openNow:  openNowRes.count ?? 0,
  }
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

// Group emails by thread, compute first non-staff inbound → first staff
// outbound minute delta. Capped at MAX_THREADS for p95 latency.
const MAX_THREADS = 200

function computeResponseTimes(
  emails:       EmailLogRow[],
  staffEmails:  Set<string>,
): { avgMinutes: number | null; medianMinutes: number | null; threadsAnalyzed: number } {
  const byThread = new Map<string, EmailLogRow[]>()
  for (const e of emails) {
    if (!e.gmail_thread_id) continue
    const arr = byThread.get(e.gmail_thread_id) ?? []
    arr.push(e)
    byThread.set(e.gmail_thread_id, arr)
  }

  // Take the N most-recent threads (by max created_at within the thread).
  const threadSummaries = Array.from(byThread.entries())
    .map(([id, arr]) => {
      const sorted = [...arr].sort((a, b) =>
        new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
      )
      const lastTs = sorted[sorted.length - 1]?.created_at
      return { id, sorted, lastTs: lastTs ? new Date(lastTs).getTime() : 0 }
    })
    .sort((a, b) => b.lastTs - a.lastTs)
    .slice(0, MAX_THREADS)

  const minutesList: number[] = []
  for (const t of threadSummaries) {
    const firstInbound = t.sorted.find(m =>
      m.direction === 'inbound' && !staffEmails.has(lower(m.from_email))
    )
    if (!firstInbound?.created_at) continue
    const inboundMs = new Date(firstInbound.created_at).getTime()

    const firstReply = t.sorted.find(m =>
      m.direction === 'outbound'
      && staffEmails.has(lower(m.from_email))
      && new Date(m.created_at ?? 0).getTime() > inboundMs
    )
    if (!firstReply?.created_at) continue

    const deltaMin = (new Date(firstReply.created_at).getTime() - inboundMs) / 60000
    if (deltaMin >= 0 && deltaMin < 60 * 24 * 30) minutesList.push(deltaMin)
  }

  return {
    avgMinutes:      avg(minutesList) !== null ? Math.round(avg(minutesList) as number) : null,
    medianMinutes:   median(minutesList) !== null ? Math.round(median(minutesList) as number) : null,
    threadsAnalyzed: minutesList.length,
  }
}

// ──────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────
export async function getAssociationStats(
  associationCode: string,
  opts: { windowDays?: number } = {},
): Promise<AssociationStats> {
  const windowDays = Math.max(1, Math.min(opts.windowDays ?? 30, 365))
  const code       = associationCode.toUpperCase()
  const sinceIso   = new Date(Date.now() - windowDays * 86400 * 1000).toISOString()

  const [contacts, staffEmails, emails, conversations, ticketsBundle] = await Promise.all([
    loadContactSets(code),
    loadStaffEmails(),
    fetchEmailLogs(code, sinceIso),
    fetchConversations(code, sinceIso),
    fetchTickets(code, sinceIso),
  ])

  const stats = emptyStats(windowDays)

  // Email logs → bucket each row.
  for (const e of emails) {
    if (e.direction === 'inbound') {
      stats.messagesReceived.total += 1
      stats.messagesReceived.byChannel.email += 1
      stats.messagesReceived.byContact[classifyContact(e.from_email, null, contacts)] += 1
    } else if (e.direction === 'outbound') {
      stats.messagesSent.total += 1
      stats.messagesSent.byChannel.email += 1
      stats.messagesSent.byContact[classifyContact(e.to_email, null, contacts)] += 1
    }
  }

  // general_conversations → 1 inbound (the originating contact) + every
  // assistant entry in messages[] = 1 outbound on the same channel.
  for (const c of conversations) {
    const channel = normalizeChannel(c.channel)
    const contactType = classifyContact(c.sender_email ?? c.contact_email, c.contact_phone, contacts)

    stats.messagesReceived.total += 1
    stats.messagesReceived.byChannel[channel] += 1
    stats.messagesReceived.byContact[contactType] += 1

    if (Array.isArray(c.messages)) {
      for (const m of c.messages as Array<{ role?: string; direction?: string }>) {
        const isOutbound = m?.role === 'assistant' || m?.direction === 'outbound'
        if (!isOutbound) continue
        stats.messagesSent.total += 1
        stats.messagesSent.byChannel[channel] += 1
        stats.messagesSent.byContact[contactType] += 1
      }
    }
  }

  // Response time — emails only (other channels are typically realtime
  // and don't have stable thread keys yet).
  stats.responseTime = computeResponseTimes(emails, staffEmails)

  // Tickets — opened/resolved within window, plus current open count.
  stats.tickets.openNow = ticketsBundle.openNow
  const resolveDurationsHours: number[] = []
  for (const t of ticketsBundle.windowed) {
    stats.tickets.opened += 1
    const isResolvedStatus = t.status === 'resolved' || t.status === 'closed'
    const resolvedTs = t.resolved_at ?? (isResolvedStatus ? t.updated_at ?? null : null)
    if (resolvedTs) {
      stats.tickets.resolved += 1
      if (t.created_at) {
        const hours = (new Date(resolvedTs).getTime() - new Date(t.created_at).getTime()) / (1000 * 3600)
        if (hours >= 0 && hours < 24 * 365) resolveDurationsHours.push(hours)
      }
    }
  }
  const avgH = avg(resolveDurationsHours)
  stats.tickets.avgResolveHours = avgH !== null ? Math.round(avgH) : null

  return stats
}

// ──────────────────────────────────────────────────────────────────────
// Aggregation helper used by the staff-stats panel: sum a list of
// per-association AssociationStats into one totals object (channel-/
// contact-breakdowns add, response-time + resolve-time become a
// weighted average across the inputs).
// ──────────────────────────────────────────────────────────────────────
export function sumStats(windowDays: number, parts: AssociationStats[]): AssociationStats {
  const out = emptyStats(windowDays)
  const responseWeightedMinutes: number[] = []
  const responseMedianMinutes:   number[] = []
  let   threadsAnalyzed = 0
  const resolveWeightedHours:    number[] = []
  let   totalResolved = 0

  for (const s of parts) {
    out.messagesReceived.total += s.messagesReceived.total
    out.messagesSent.total     += s.messagesSent.total
    for (const k of ['email','sms','whatsapp','voice','web','other'] as const) {
      out.messagesReceived.byChannel[k] += s.messagesReceived.byChannel[k]
      out.messagesSent.byChannel[k]     += s.messagesSent.byChannel[k]
    }
    for (const k of ['board','owner','tenant','other'] as const) {
      out.messagesReceived.byContact[k] += s.messagesReceived.byContact[k]
      out.messagesSent.byContact[k]     += s.messagesSent.byContact[k]
    }
    if (s.responseTime.avgMinutes !== null && s.responseTime.threadsAnalyzed > 0) {
      for (let i = 0; i < s.responseTime.threadsAnalyzed; i++) {
        responseWeightedMinutes.push(s.responseTime.avgMinutes)
      }
      threadsAnalyzed += s.responseTime.threadsAnalyzed
    }
    if (s.responseTime.medianMinutes !== null && s.responseTime.threadsAnalyzed > 0) {
      responseMedianMinutes.push(s.responseTime.medianMinutes)
    }
    out.tickets.opened   += s.tickets.opened
    out.tickets.resolved += s.tickets.resolved
    out.tickets.openNow  += s.tickets.openNow
    if (s.tickets.avgResolveHours !== null && s.tickets.resolved > 0) {
      for (let i = 0; i < s.tickets.resolved; i++) {
        resolveWeightedHours.push(s.tickets.avgResolveHours)
      }
      totalResolved += s.tickets.resolved
    }
  }

  out.responseTime.threadsAnalyzed = threadsAnalyzed
  out.responseTime.avgMinutes      = avg(responseWeightedMinutes) !== null ? Math.round(avg(responseWeightedMinutes) as number) : null
  out.responseTime.medianMinutes   = median(responseMedianMinutes) !== null ? Math.round(median(responseMedianMinutes) as number) : null
  out.tickets.avgResolveHours      = totalResolved > 0
    ? (avg(resolveWeightedHours) !== null ? Math.round(avg(resolveWeightedHours) as number) : null)
    : null

  return out
}
