// =====================================================================
// lib/recurring-agenda.ts — Phase 3a
// The weekly "confirm next week's agenda" loop:
//   • Friday cron emails each vendor office a tokenized link (in their
//     language) to confirm next week's crew + service day.
//   • The office submits → we create next week's visit (+ work order),
//     record the crew + planned date, and send that crew their upload
//     links right away.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { signAgendaToken } from '@/lib/agenda-token'
import { mondayOf, ensureWeeklyVisit, sendCrewUploadLinks } from '@/lib/service-visits'
import type { RecurringService } from '@/lib/recurring-services'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

/** Monday of NEXT week (the week we're asking the office to confirm). */
export function nextMonday(from: Date = new Date()): string {
  const d = new Date(from); d.setUTCDate(d.getUTCDate() + 7)
  return mondayOf(d)
}

function agendaEmail(lang: string, svc: RecurringService, weekOf: string, link: string) {
  const btn = (label: string) => `<p style="margin:20px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600">${label}</a></p><p style="color:#6b7280;font-size:12px">${link}</p>`
  if (lang === 'es') return {
    subject: `Confirme el equipo de ${svc.service_type} para la semana del ${weekOf} — ${svc.association_code}`,
    html: `<p>Hola${svc.vendor_name ? ' ' + svc.vendor_name : ''},</p><p>Por favor confirme qué empleados realizarán el servicio de <strong>${svc.service_type}</strong> en <strong>${svc.association_code}</strong> la próxima semana (semana del ${weekOf}) y el día previsto.</p>${btn('Confirmar agenda de la próxima semana')}`,
  }
  return {
    subject: `Confirm next week's ${svc.service_type} crew — week of ${weekOf} — ${svc.association_code}`,
    html: `<p>Hello${svc.vendor_name ? ' ' + svc.vendor_name : ''},</p><p>Please confirm which employees will perform the <strong>${svc.service_type}</strong> service at <strong>${svc.association_code}</strong> next week (week of ${weekOf}) and the planned day.</p>${btn("Confirm next week's agenda")}`,
  }
}

/** Friday cron: email every active recurring service's office their
 *  next-week agenda link. Returns counts. */
export async function sendAgendaEmails(): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const weekOf = nextMonday()
  const { data: services } = await supabaseAdmin.from('recurring_services').select('*').eq('active', true)
  let sent = 0, skipped = 0
  const errors: string[] = []
  for (const svc of (services ?? []) as RecurringService[]) {
    if (!svc.office_email) { skipped++; continue }
    try {
      const token = await signAgendaToken(svc.id)
      const link  = `${APP_URL}/vendor/agenda/${token}`
      const m = agendaEmail(svc.office_language || 'en', svc, weekOf, link)
      await sendEmail({ to: svc.office_email, subject: m.subject, html: m.html })
      sent++
    } catch (err) { errors.push(`service ${svc.id}: ${(err as Error).message}`) }
  }
  return { sent, skipped, errors }
}

/** Office submitted the agenda: ensure next week's visit (+ WO), record
 *  the crew + planned day, and send those crew their upload links. */
export async function confirmAgenda(opts: {
  serviceId:    number
  plannedDate?: string | null
  employeeIds:  string[]
}): Promise<{ ok: true; visitId: number; sent: number } | { ok: false; error: string }> {
  const { data: svc } = await supabaseAdmin.from('recurring_services').select('*').eq('id', opts.serviceId).maybeSingle()
  if (!svc) return { ok: false, error: 'service not found' }
  const service = svc as RecurringService

  const weekOf = nextMonday()
  const { visit } = await ensureWeeklyVisit(service, weekOf)
  if (!visit) return { ok: false, error: 'could not create the visit' }

  await supabaseAdmin.from('service_visits').update({
    planned_date:          opts.plannedDate || null,
    assigned_employee_ids: opts.employeeIds,
    status:                'confirmed',
    confirmed_at:          new Date().toISOString(),
    updated_at:            new Date().toISOString(),
  }).eq('id', visit.id)

  // Send the confirmed crew their upload links straight away.
  const res = await sendCrewUploadLinks(visit.id, opts.employeeIds)
  return { ok: true, visitId: visit.id, sent: res.ok ? res.sent : 0 }
}
