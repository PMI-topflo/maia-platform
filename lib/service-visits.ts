// =====================================================================
// lib/service-visits.ts  — Phase 2
// Turn active recurring_services into weekly visits, each backed by a
// work-order ticket (documentation: photos + report), and send the
// vendor's crew their upload links (reusing the vendor portal).
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { createTicket } from '@/lib/tickets'
import { signVendorUploadToken } from '@/lib/vendor-upload-token'
import { sendEmail } from '@/lib/gmail'
import { sendSMSStrict, sendWhatsAppStrict } from '@/lib/twilio-send'
import { listVendorEmployees, type RecurringService } from '@/lib/recurring-services'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

/** Monday (YYYY-MM-DD) of the week containing `d` (defaults to today). */
export function mondayOf(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = date.getUTCDay()              // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day     // back to Monday
  date.setUTCDate(date.getUTCDate() + diff)
  return date.toISOString().slice(0, 10)
}

export interface ServiceVisit {
  id:                   number
  recurring_service_id: number | null
  association_code:     string
  cinc_vendor_id:       string | null
  vendor_name:          string | null
  service_type:         string | null
  week_of:              string
  status:               string
  ticket_id:            number | null
}

/** Ensure a visit (+ its documentation work order) exists for one service
 *  in a given week. Idempotent via the (recurring_service_id, week_of)
 *  unique constraint. */
export async function ensureWeeklyVisit(svc: RecurringService, weekOf: string): Promise<{ created: boolean; visit: ServiceVisit | null }> {
  const { data: existing } = await supabaseAdmin
    .from('service_visits').select('*')
    .eq('recurring_service_id', svc.id).eq('week_of', weekOf).maybeSingle()
  if (existing) return { created: false, visit: existing as ServiceVisit }

  // Documentation work order for this week's visit.
  const ticket = await createTicket({
    type:             'work_order',
    channel_origin:   'internal',
    association_code: svc.association_code,
    subject:          `Weekly ${svc.service_type} — ${svc.vendor_name} — week of ${weekOf}`,
    summary:          `Recurring ${svc.service_type.toLowerCase()} visit. Crew uploads photos + a brief report via the weekly link.`,
  })

  const { data, error } = await supabaseAdmin.from('service_visits').insert({
    recurring_service_id: svc.id,
    association_code:     svc.association_code,
    cinc_vendor_id:       svc.cinc_vendor_id,
    vendor_name:          svc.vendor_name,
    service_type:         svc.service_type,
    week_of:             weekOf,
    status:              'expected',
    ticket_id:           ticket.id,
  }).select('*').single()
  if (error) {
    // Lost a race on the unique constraint — fetch the winner.
    const { data: won } = await supabaseAdmin.from('service_visits').select('*').eq('recurring_service_id', svc.id).eq('week_of', weekOf).maybeSingle()
    return { created: false, visit: (won ?? null) as ServiceVisit | null }
  }
  return { created: true, visit: data as ServiceVisit }
}

/** Generate visits for every active recurring service for a given week. */
export async function generateVisitsForWeek(weekOf: string): Promise<{ created: number; existing: number }> {
  const { data: services } = await supabaseAdmin.from('recurring_services').select('*').eq('active', true)
  let created = 0, existing = 0
  for (const svc of (services ?? []) as RecurringService[]) {
    const r = await ensureWeeklyVisit(svc, weekOf)
    if (r.created) created++; else existing++
  }
  return { created, existing }
}

export async function listVisits(assoc: string, weekOf?: string): Promise<ServiceVisit[]> {
  let q = supabaseAdmin.from('service_visits').select('*').eq('association_code', assoc.toUpperCase()).order('week_of', { ascending: false }).order('service_type')
  if (weekOf) q = q.eq('week_of', weekOf)
  const { data } = await q
  return (data ?? []) as ServiceVisit[]
}

/** Send each crew member of the visit's vendor their personal upload link
 *  (the vendor portal, scoped to this visit's work order) via their
 *  preferred channel. Returns per-employee results. */
export async function sendCrewUploadLinks(visitId: number, employeeIds?: string[]): Promise<{ ok: true; sent: number; results: string[] } | { ok: false; error: string }> {
  const { data: visit } = await supabaseAdmin.from('service_visits').select('*').eq('id', visitId).maybeSingle()
  if (!visit) return { ok: false, error: 'visit not found' }
  const v = visit as ServiceVisit
  if (!v.ticket_id) return { ok: false, error: 'visit has no work order' }

  let crew = (await listVendorEmployees(v.cinc_vendor_id)).filter(e => e.active)
  if (employeeIds && employeeIds.length) crew = crew.filter(e => employeeIds.includes(e.id))
  if (crew.length === 0) return { ok: false, error: 'no active crew for this vendor — add employees first' }

  const token = await signVendorUploadToken(v.ticket_id)
  const svc   = v.service_type ?? 'service'

  const results: string[] = []
  let sent = 0
  for (const e of crew) {
    const lang = e.preferred_language || 'en'
    const link = `${APP_URL}/vendor/upload/${token}?lang=${encodeURIComponent(lang)}`
    const m = crewMessage(lang, svc, v.association_code, v.week_of, link, e.name)
    try {
      if (e.preferred_channel === 'sms' && e.phone)            { await sendSMSStrict(e.phone, m.short); sent++; results.push(`${e.name}: sms`) }
      else if (e.preferred_channel === 'whatsapp' && e.phone)  { await sendWhatsAppStrict(e.phone, m.short); sent++; results.push(`${e.name}: whatsapp`) }
      else if (e.email)                                        { await sendEmail({ to: e.email, subject: m.subject, html: m.html }); sent++; results.push(`${e.name}: email`) }
      else                                                     { results.push(`${e.name}: skipped (no ${e.preferred_channel} contact)`) }
    } catch (err) {
      results.push(`${e.name}: failed (${(err as Error).message})`)
    }
  }
  return { ok: true, sent, results }
}

// =====================================================================
// Coverage rollup — "are vendors sending this week's reports?"
//
// service_visits.status is unreliable (only ever 'expected'/'confirmed'),
// so coverage is DERIVED from the underlying data, keyed by the visit's
// ticket_id:
//   • has photos  = an image row in work_order_attachments
//   • has report  = the vendor's "📋 Report:" internal note (optional —
//                   per product call, photos alone count as reported).
// "Due-ness" comes from expected_day (0=Sun..6=Sat) within the visit's
// week (week_of = the Monday). Nothing is flagged before the expected
// day passes — avoids Monday-morning false alarms.
// =====================================================================

export type CoverageState =
  | 'complete'  // photos uploaded (green)
  | 'not_due'   // no photos yet, but the expected day hasn't passed (green)
  | 'late'      // no photos, expected day passed but the week isn't over (amber)
  | 'missed'    // no photos and the whole service week has elapsed (red)
  | 'none'      // no visit has ever been generated for this service (table only)

export type CoverageSeverity = 'nominal' | 'caution' | 'warning'

export interface CoverageRow {
  service_id:       number
  association_code: string
  vendor_name:      string | null
  service_type:     string | null
  cadence:          string | null
  expected_day:     number | null
  week_of:          string | null   // visit week being measured (null = never generated)
  planned_date:     string | null
  ticket_id:        number | null
  has_photos:       boolean
  has_report:       boolean
  last_activity_at: string | null   // newest attachment time — proxy for the actual visit
  state:            CoverageState
}

export interface WeeklyCoverage {
  week_of:  string
  rows:     CoverageRow[]
  total:    number
  complete: number
  late:     number
  missed:   number
  sev:      CoverageSeverity
}

// ── date helpers (all UTC, YYYY-MM-DD; ISO strings compare correctly) ──
function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
/** Calendar date of the expected visit within its week (week_of = Monday).
 *  expected_day is 0=Sun..6=Sat; null when the vendor has no fixed day. */
function expectedDateOf(weekOf: string, expectedDay: number | null): string | null {
  if (expectedDay == null) return null
  const offset = expectedDay === 0 ? 6 : expectedDay - 1   // Mon=0 … Sun=6 from week_of
  return addDaysISO(weekOf, offset)
}
function visitState(weekOf: string, expectedDay: number | null, hasPhotos: boolean, today: string): CoverageState {
  if (hasPhotos) return 'complete'
  const weekEnd = addDaysISO(weekOf, 6)               // Sunday
  const dueRef  = expectedDateOf(weekOf, expectedDay) ?? weekEnd
  if (today <= dueRef)  return 'not_due'
  if (today <= weekEnd) return 'late'
  return 'missed'
}

/** Batch-fetch which tickets have ≥1 image attachment + their newest
 *  attachment time, in a single query. */
async function ticketPhotoInfo(ticketIds: number[]): Promise<{ photos: Set<number>; lastActivity: Map<number, string> }> {
  const photos = new Set<number>()
  const lastActivity = new Map<number, string>()
  if (ticketIds.length === 0) return { photos, lastActivity }
  const { data } = await supabaseAdmin
    .from('work_order_attachments')
    .select('ticket_id, mime_type, created_at')
    .in('ticket_id', ticketIds)
    .order('created_at', { ascending: false })
  for (const r of (data ?? []) as Array<{ ticket_id: number; mime_type: string | null; created_at: string }>) {
    if (!lastActivity.has(r.ticket_id)) lastActivity.set(r.ticket_id, r.created_at) // desc → first = newest
    if ((r.mime_type ?? '').startsWith('image/')) photos.add(r.ticket_id)
  }
  return { photos, lastActivity }
}

/** Batch-fetch which tickets carry a vendor "📋 Report:" note. */
async function ticketsWithReport(ticketIds: number[]): Promise<Set<number>> {
  if (ticketIds.length === 0) return new Set()
  const { data } = await supabaseAdmin
    .from('ticket_messages')
    .select('ticket_id')
    .in('ticket_id', ticketIds)
    .eq('direction', 'internal_note')
    .ilike('body', '%📋 Report%')
  return new Set((data ?? []).map(r => (r as { ticket_id: number }).ticket_id))
}

function severityFor(rows: { state: CoverageState }[]): CoverageSeverity {
  if (rows.some(r => r.state === 'missed')) return 'warning'
  if (rows.some(r => r.state === 'late'))   return 'caution'
  return 'nominal'
}

/** This week's coverage across active WEEKLY services (the ones genuinely
 *  expected to report every week). Powers the dashboard LED. */
export async function getWeeklyCoverage(weekOf: string = mondayOf()): Promise<WeeklyCoverage> {
  const today = todayISO()
  const { data: svcData } = await supabaseAdmin
    .from('recurring_services')
    .select('id, association_code, vendor_name, service_type, cadence, expected_day')
    .eq('active', true)
    .eq('cadence', 'weekly')
  const services = (svcData ?? []) as Array<{ id: number; association_code: string; vendor_name: string | null; service_type: string | null; cadence: string; expected_day: number | null }>

  const { data: visitData } = await supabaseAdmin
    .from('service_visits')
    .select('id, recurring_service_id, ticket_id, planned_date')
    .eq('week_of', weekOf)
  const visitByService = new Map<number, { ticket_id: number | null; planned_date: string | null }>()
  for (const v of (visitData ?? []) as Array<{ recurring_service_id: number | null; ticket_id: number | null; planned_date: string | null }>) {
    if (v.recurring_service_id != null) visitByService.set(v.recurring_service_id, { ticket_id: v.ticket_id, planned_date: v.planned_date })
  }

  const ticketIds = [...visitByService.values()].map(v => v.ticket_id).filter((n): n is number => n != null)
  const [{ photos, lastActivity }, reports] = await Promise.all([ticketPhotoInfo(ticketIds), ticketsWithReport(ticketIds)])

  const rows: CoverageRow[] = services.map(svc => {
    const visit     = visitByService.get(svc.id)
    const ticketId  = visit?.ticket_id ?? null
    const hasPhotos = ticketId != null && photos.has(ticketId)
    const hasReport = ticketId != null && reports.has(ticketId)
    return {
      service_id:       svc.id,
      association_code: svc.association_code,
      vendor_name:      svc.vendor_name,
      service_type:     svc.service_type,
      cadence:          svc.cadence,
      expected_day:     svc.expected_day,
      week_of:          weekOf,
      planned_date:     visit?.planned_date ?? null,
      ticket_id:        ticketId,
      has_photos:       hasPhotos,
      has_report:       hasReport,
      last_activity_at: ticketId != null ? (lastActivity.get(ticketId) ?? null) : null,
      state:            visitState(weekOf, svc.expected_day, hasPhotos, today),
    }
  })

  return {
    week_of:  weekOf,
    rows,
    total:    rows.length,
    complete: rows.filter(r => r.state === 'complete').length,
    late:     rows.filter(r => r.state === 'late').length,
    missed:   rows.filter(r => r.state === 'missed').length,
    sev:      severityFor(rows),
  }
}

/** Every active recurring service with its LATEST visit (any week) and
 *  whether that visit was documented. Powers the coverage detail page. */
export async function listLatestVisitPerService(): Promise<CoverageRow[]> {
  const today = todayISO()
  const { data: svcData } = await supabaseAdmin
    .from('recurring_services')
    .select('id, association_code, vendor_name, service_type, cadence, expected_day')
    .eq('active', true)
    .order('association_code').order('vendor_name')
  const services = (svcData ?? []) as Array<{ id: number; association_code: string; vendor_name: string | null; service_type: string | null; cadence: string; expected_day: number | null }>

  // Newest visit per service (week_of desc → first seen wins).
  const { data: visitData } = await supabaseAdmin
    .from('service_visits')
    .select('recurring_service_id, ticket_id, week_of, planned_date')
    .order('week_of', { ascending: false })
  const latestByService = new Map<number, { ticket_id: number | null; week_of: string; planned_date: string | null }>()
  for (const v of (visitData ?? []) as Array<{ recurring_service_id: number | null; ticket_id: number | null; week_of: string; planned_date: string | null }>) {
    if (v.recurring_service_id != null && !latestByService.has(v.recurring_service_id)) {
      latestByService.set(v.recurring_service_id, { ticket_id: v.ticket_id, week_of: v.week_of, planned_date: v.planned_date })
    }
  }

  const ticketIds = [...latestByService.values()].map(v => v.ticket_id).filter((n): n is number => n != null)
  const [{ photos, lastActivity }, reports] = await Promise.all([ticketPhotoInfo(ticketIds), ticketsWithReport(ticketIds)])

  return services.map(svc => {
    const latest    = latestByService.get(svc.id)
    const ticketId  = latest?.ticket_id ?? null
    const hasPhotos = ticketId != null && photos.has(ticketId)
    const hasReport = ticketId != null && reports.has(ticketId)
    return {
      service_id:       svc.id,
      association_code: svc.association_code,
      vendor_name:      svc.vendor_name,
      service_type:     svc.service_type,
      cadence:          svc.cadence,
      expected_day:     svc.expected_day,
      week_of:          latest?.week_of ?? null,
      planned_date:     latest?.planned_date ?? null,
      ticket_id:        ticketId,
      has_photos:       hasPhotos,
      has_report:       hasReport,
      last_activity_at: ticketId != null ? (lastActivity.get(ticketId) ?? null) : null,
      state:            latest ? visitState(latest.week_of, svc.expected_day, hasPhotos, today) : 'none',
    }
  })
}

// Localized crew message (Spanish is the priority; others fall back to
// English — the report they write back is translated to English anyway).
function crewMessage(lang: string, svc: string, assoc: string, weekOf: string, link: string, name: string) {
  const btn = (label: string) => `<p style="margin:20px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600">${label}</a></p><p style="color:#6b7280;font-size:12px">${link}</p>`
  if (lang === 'es') return {
    short:   `PMI: por favor suba las fotos de ${svc} de esta semana y un breve informe para ${assoc} (semana del ${weekOf}): ${link}`,
    subject: `Suba las fotos de ${svc} de esta semana — ${assoc}`,
    html:    `<p>Hola ${name},</p><p>Por favor suba las fotos de <strong>${svc}</strong> de esta semana y un breve informe para <strong>${assoc}</strong> (semana del ${weekOf}).</p>${btn('Subir fotos e informe')}`,
  }
  return {
    short:   `PMI: please upload this week's ${svc} photos + a brief report for ${assoc} (week of ${weekOf}): ${link}`,
    subject: `Upload this week's ${svc} photos — ${assoc}`,
    html:    `<p>Hi ${name},</p><p>Please upload this week's <strong>${svc}</strong> photos and a brief report for <strong>${assoc}</strong> (week of ${weekOf}).</p>${btn('Upload photos & report')}`,
  }
}
