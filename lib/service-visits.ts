// =====================================================================
// lib/service-visits.ts  — Phase 2
// Turn active recurring_services into weekly visits, each backed by a
// work-order ticket (documentation: photos + report), and send the
// vendor's crew their upload links (reusing the vendor portal).
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { createTicket } from '@/lib/tickets'
import { signVendorUploadToken } from '@/lib/vendor-upload-token'
import { signCrewToken } from '@/lib/crew-token'
import { sendEmail } from '@/lib/gmail'
import { sendSMSStrict, sendWhatsAppStrict } from '@/lib/twilio-send'
import { listVendorEmployees, type RecurringService } from '@/lib/recurring-services'
import { VENDOR_NOTIFY_CC, VENDOR_REPLY_TO } from '@/lib/notify-recipients'

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

/** Generate visits for every active recurring service that is DUE in the
 *  given week (cadence-aware — biweekly/monthly are skipped on off-weeks). */
export async function generateVisitsForWeek(weekOf: string): Promise<{ created: number; existing: number; skipped: number }> {
  const { data: services } = await supabaseAdmin.from('recurring_services').select('*').eq('active', true)
  let created = 0, existing = 0, skipped = 0
  for (const svc of (services ?? []) as RecurringService[]) {
    if (!isVisitDue(weekOf, svc.cadence, svc.schedule_anchor, svc.monthly_day)) { skipped++; continue }
    const r = await ensureWeeklyVisit(svc, weekOf)
    if (r.created) created++; else existing++
  }
  return { created, existing, skipped }
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
    const eTok = await signCrewToken(e.id)   // identifies this crew member so they can save a default language
    const link = `${APP_URL}/vendor/upload/${token}?lang=${encodeURIComponent(lang)}&e=${encodeURIComponent(eTok)}`
    const m = crewMessage(lang, svc, v.association_code, v.week_of, link, e.name)
    try {
      if (e.preferred_channel === 'sms' && e.phone)            { await sendSMSStrict(e.phone, m.short); sent++; results.push(`${e.name}: sms`) }
      else if (e.preferred_channel === 'whatsapp' && e.phone)  { await sendWhatsAppStrict(e.phone, m.short); sent++; results.push(`${e.name}: whatsapp`) }
      else if (e.email)                                        { await sendEmail({ to: e.email, bcc: VENDOR_NOTIFY_CC, replyTo: VENDOR_REPLY_TO, subject: m.subject, html: m.html }); sent++; results.push(`${e.name}: email`) }
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

/** Whole weeks between two dates (rounded), positive when b is after a. */
function weeksBetween(aISO: string, bISO: string): number {
  const ms = new Date(`${bISO}T00:00:00Z`).getTime() - new Date(`${aISO}T00:00:00Z`).getTime()
  return Math.round(ms / (7 * 86_400_000))
}

/** Is a service due in the week starting `weekOf` (a Monday), given its
 *  cadence + schedule anchor? This is the single source of truth for both
 *  visit generation and coverage flags, so they never disagree.
 *   • daily    → every week (they come multiple times a week; one weekly
 *                documentation visit still represents the week)
 *   • weekly   → every week
 *   • biweekly → alternating weeks measured from schedule_anchor's Monday
 *                (null anchor falls back to weekly so nothing is skipped)
 *   • monthly  → the week containing monthly_day (clamped to month length;
 *                null → the week containing the 1st) */
export function isVisitDue(
  weekOf: string,
  cadence: string | null | undefined,
  scheduleAnchor: string | null | undefined,
  monthlyDay: number | null | undefined,
): boolean {
  if (cadence === 'biweekly') {
    if (!scheduleAnchor) return true
    const anchorMonday = mondayOf(new Date(`${scheduleAnchor}T00:00:00Z`))
    const w = weeksBetween(anchorMonday, weekOf)
    return ((w % 2) + 2) % 2 === 0
  }
  if (cadence === 'monthly') {
    const target = monthlyDay ?? 1
    for (let i = 0; i < 7; i++) {
      const d = new Date(`${weekOf}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + i)
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
      if (d.getUTCDate() === Math.min(target, lastDay)) return true
    }
    return false
  }
  return true // daily + weekly (and any unknown cadence) → due every week
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

/** This week's coverage across every active service that is DUE this week
 *  (cadence-aware via isVisitDue, so biweekly/monthly only count on their
 *  scheduled weeks). Powers the dashboard LED. */
export async function getWeeklyCoverage(weekOf: string = mondayOf()): Promise<WeeklyCoverage> {
  const today = todayISO()
  const { data: svcData } = await supabaseAdmin
    .from('recurring_services')
    .select('id, association_code, vendor_name, service_type, cadence, expected_day, schedule_anchor, monthly_day')
    .eq('active', true)
  const services = ((svcData ?? []) as Array<{ id: number; association_code: string; vendor_name: string | null; service_type: string | null; cadence: string; expected_day: number | null; schedule_anchor: string | null; monthly_day: number | null }>)
    .filter(s => isVisitDue(weekOf, s.cadence, s.schedule_anchor, s.monthly_day))

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
  const wrap = (rtl: boolean, body: string) => rtl ? `<div dir="rtl">${body}</div>` : body
  switch (lang) {
    case 'es': return {
      short:   `PMI: por favor suba las fotos de ${svc} de esta semana y un breve informe para ${assoc} (semana del ${weekOf}): ${link}`,
      subject: `Suba las fotos de ${svc} de esta semana — ${assoc}`,
      html:    `<p>Hola ${name},</p><p>Por favor suba las fotos de <strong>${svc}</strong> de esta semana y un breve informe para <strong>${assoc}</strong> (semana del ${weekOf}).</p>${btn('Subir fotos e informe')}`,
    }
    case 'pt': return {
      short:   `PMI: por favor envie as fotos de ${svc} desta semana + um breve relatório para ${assoc} (semana de ${weekOf}): ${link}`,
      subject: `Envie as fotos de ${svc} desta semana — ${assoc}`,
      html:    `<p>Olá ${name},</p><p>Por favor envie as fotos de <strong>${svc}</strong> desta semana e um breve relatório para <strong>${assoc}</strong> (semana de ${weekOf}).</p>${btn('Enviar fotos e relatório')}`,
    }
    case 'fr': return {
      short:   `PMI : veuillez envoyer les photos de ${svc} de cette semaine + un bref rapport pour ${assoc} (semaine du ${weekOf}) : ${link}`,
      subject: `Envoyez les photos de ${svc} de cette semaine — ${assoc}`,
      html:    `<p>Bonjour ${name},</p><p>Veuillez envoyer les photos de <strong>${svc}</strong> de cette semaine et un bref rapport pour <strong>${assoc}</strong> (semaine du ${weekOf}).</p>${btn('Envoyer les photos et le rapport')}`,
    }
    case 'he': return {
      short:   `PMI: אנא העלו את תמונות ${svc} של השבוע + דוח קצר עבור ${assoc} (השבוע של ${weekOf}): ${link}`,
      subject: `העלו את תמונות ${svc} של השבוע — ${assoc}`,
      html:    wrap(true, `<p>שלום ${name},</p><p>אנא העלו את תמונות <strong>${svc}</strong> של השבוע ודוח קצר עבור <strong>${assoc}</strong> (השבוע של ${weekOf}).</p>${btn('העלאת תמונות ודוח')}`),
    }
    case 'ru': return {
      short:   `PMI: пожалуйста, загрузите фото ${svc} за эту неделю + краткий отчёт для ${assoc} (неделя ${weekOf}): ${link}`,
      subject: `Загрузите фото ${svc} за эту неделю — ${assoc}`,
      html:    `<p>Здравствуйте, ${name},</p><p>Пожалуйста, загрузите фото <strong>${svc}</strong> за эту неделю и краткий отчёт для <strong>${assoc}</strong> (неделя ${weekOf}).</p>${btn('Загрузить фото и отчёт')}`,
    }
    case 'ht': return {
      short:   `PMI: tanpri voye foto ${svc} semèn sa a + yon ti rapò pou ${assoc} (semèn ${weekOf}): ${link}`,
      subject: `Voye foto ${svc} semèn sa a — ${assoc}`,
      html:    `<p>Bonjou ${name},</p><p>Tanpri voye foto <strong>${svc}</strong> semèn sa a ak yon ti rapò pou <strong>${assoc}</strong> (semèn ${weekOf}).</p>${btn('Voye foto ak rapò')}`,
    }
    default: return {
      short:   `PMI: please upload this week's ${svc} photos + a brief report for ${assoc} (week of ${weekOf}): ${link}`,
      subject: `Upload this week's ${svc} photos — ${assoc}`,
      html:    `<p>Hi ${name},</p><p>Please upload this week's <strong>${svc}</strong> photos and a brief report for <strong>${assoc}</strong> (week of ${weekOf}).</p>${btn('Upload photos & report')}`,
    }
  }
}
