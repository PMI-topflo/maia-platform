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
