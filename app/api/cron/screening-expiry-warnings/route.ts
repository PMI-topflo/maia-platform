// GET /api/cron/screening-expiry-warnings
// Warns the primary applicant at 10, 5, and 1 days before their Checkr
// screening's 45-day validity window closes (docs/ROADMAP.md's "Screening
// validity" section, lib/screening/validity.ts), then once more -- with the
// $150 re-screening payment link -- the moment it actually expires
// (docs/ROADMAP.md's "Re-screening charge" section). The clock is
// application-level (lib/board-review.ts's screeningValidThrough) -- it only
// starts once EVERY screening_subjects row bridged via
// listing_applications.detailed_application_id has actually completed, and
// only matters while the application is still incomplete: an
// already-approved/declined application's screening going stale afterward
// is nobody's problem to warn about. Dedupe via screening_expiry_warnings
// (listing_application_id, days_before -- 0 for the expiry notice itself)
// so a daily cron never re-sends a warning (or the expiry link) already
// sent. Two callers:
//   • Vercel cron (Bearer CRON_SECRET) — sends.
//   • Staff (session) — dry-run by default; ?send=1 to actually send.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { getReviewStates } from '@/lib/board-review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const WARN_DAYS = [10, 5, 1] as const
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

// The exact required legal framing (user-provided, Florida condo
// §718.112(2)(k) context) -- copy this string verbatim everywhere the
// re-screening charge is mentioned. Never paraphrase it.
export const RESCREENING_NOT_AN_APPLICATION_FEE_NOTICE =
  'This is not an association application fee. It reimburses the actual cost of ' +
  'obtaining a new third-party background/credit report and processing it in the ' +
  'system, required because your prior screening expired 45+ days ago without your ' +
  'application being completed.'

function fmt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

export function warningHtml(o: { name: string; unit: string; assoc: string; validThrough: string; days: number }): string {
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p>Dear ${o.name ? esc(o.name) : 'Applicant'},</p>
    <p>Your background screening for <strong>Unit ${esc(o.unit)}</strong> at <strong>${esc(o.assoc)}</strong> is valid through <strong>${fmt(o.validThrough)}</strong> — in <strong>${o.days} day${o.days === 1 ? '' : 's'}</strong>.</p>
    <p>Please make sure every required document is submitted before then. If the screening expires before your application is complete, a new screening will be required, with its own charge, before your application can continue.</p>
    <p style="margin:4px 0">Questions? ✉ <a href="mailto:PMI@topfloridaproperties.com">PMI@topfloridaproperties.com</a> · ☎ (305) 900-5077</p>
    <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p>
  </div>`
}

export function expiredHtml(o: { name: string; unit: string; assoc: string; link: string }): string {
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p>Dear ${o.name ? esc(o.name) : 'Applicant'},</p>
    <p>Your background screening for <strong>Unit ${esc(o.unit)}</strong> at <strong>${esc(o.assoc)}</strong> has expired — it has now been more than 45 days since it completed, and your application still isn't complete.</p>
    <p>To continue, a fresh screening is required.</p>
    <p style="margin:10px 0 6px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12.5px;color:#92400e;line-height:1.5">${esc(RESCREENING_NOT_AN_APPLICATION_FEE_NOTICE)}</p>
    <p style="margin:14px 0"><a href="${o.link}" style="display:inline-block;background:#c0571a;color:#fff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:8px">Pay $150 &amp; continue my application</a></p>
    <p style="margin:4px 0">Questions? ✉ <a href="mailto:PMI@topfloridaproperties.com">PMI@topfloridaproperties.com</a> · ☎ (305) 900-5077</p>
    <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p>
  </div>`
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const cron = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  const staff = !!session && session.persona === 'staff'
  if (!cron && !staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const live = cron || sp.get('send') === '1'
  const dryRun = !live

  // Only applications actually bridged to a Checkr order and still open --
  // matches screeningExpired's own "only while incomplete" rule.
  const { data: apps } = await supabaseAdmin.from('listing_applications')
    .select('id, association_code, unit_label')
    .not('detailed_application_id', 'is', null)
    .not('status', 'in', '("approved","declined","withdrawn")')
  const ids = (apps ?? []).map(a => String(a.id))
  if (!ids.length) return NextResponse.json({ ok: true, dryRun, warnings: 0, results: [] })

  const [states, { data: assocRows }, { data: existingWarnings }] = await Promise.all([
    getReviewStates(ids),
    supabaseAdmin.from('associations').select('association_code, association_name').in('association_code', [...new Set((apps ?? []).map(a => String(a.association_code)))]),
    supabaseAdmin.from('screening_expiry_warnings').select('listing_application_id, days_before').in('listing_application_id', ids),
  ])
  const assocNameByCode = new Map((assocRows ?? []).map(a => [String(a.association_code), (a.association_name as string | null) ?? String(a.association_code)]))
  const alreadySent = new Set((existingWarnings ?? []).map(w => `${w.listing_application_id}:${w.days_before}`))

  const results: { unit: string; assoc: string; days: number; to: string; expired: boolean }[] = []

  for (const app of apps ?? []) {
    const id = String(app.id)
    const state = states.get(id)
    if (!state || state.complete || !state.screeningValidThrough) continue

    const daysLeft = Math.ceil((new Date(state.screeningValidThrough).getTime() - Date.now()) / 86400000)
    const expired = daysLeft <= 0
    const days = expired ? 0 : WARN_DAYS.find(d => d === daysLeft)
    if (days === undefined) continue
    if (alreadySent.has(`${id}:${days}`)) continue

    const { data: primary } = await supabaseAdmin.from('application_stakeholders')
      .select('name, email').eq('application_id', id).eq('role', 'applicant').eq('is_primary', true).maybeSingle()
    const email = (primary?.email as string | null) ?? null
    if (!email) continue

    const unit = (app.unit_label as string | null) ?? '—'
    const assocName = assocNameByCode.get(String(app.association_code)) ?? String(app.association_code)
    const name = (primary?.name as string | null) ?? ''
    results.push({ unit, assoc: assocName, days, to: email, expired })
    if (dryRun) continue

    try {
      if (expired) {
        // One-time payment token -- app/rescreen/[token]'s entire auth. A
        // fresh row per expiry (an application can only actually expire
        // once before either paying or getting handled by staff), so no
        // need to reuse/rotate an existing one.
        const payToken = randomBytes(24).toString('hex')
        const { error: insErr } = await supabaseAdmin.from('rescreening_payments')
          .insert({ listing_application_id: id, token: payToken })
        if (insErr) throw insErr
        await sendEmail({
          to: email, subject: `Action needed: your background screening has expired — Unit ${unit}, ${assocName}`,
          html: expiredHtml({ name, unit, assoc: assocName, link: `${APP}/rescreen/${payToken}` }),
        })
      } else {
        await sendEmail({
          to: email, subject: `Your background screening expires in ${days} day${days === 1 ? '' : 's'} — Unit ${unit}, ${assocName}`,
          html: warningHtml({ name, unit, assoc: assocName, validThrough: state.screeningValidThrough, days }),
        })
      }
      await supabaseAdmin.from('screening_expiry_warnings').insert({ listing_application_id: id, days_before: days })
    } catch { /* continue -- a send failure here shouldn't block the rest of the run */ }
  }

  return NextResponse.json({ ok: true, dryRun, warnings: results.length, results })
}
