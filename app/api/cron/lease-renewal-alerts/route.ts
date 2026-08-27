// GET /api/cron/lease-renewal-alerts
// At EXACTLY 30 days and 7 days before a lease ends, notify everyone who needs
// to act on a renewal: PMI + Jonathan (AR), the association's on-site managers
// + board, and the owner + tenant. Exact-day matching is the dedupe — each
// lease fires once at the 30-day mark and once at the 7-day mark, so a daily
// cron never re-spams. Reads unit_tenant_contacts.lease_end (the source the
// unit page + drive-organize populate). Two callers:
//   • Vercel cron (Bearer CRON_SECRET) — sends.
//   • Staff (session) — dry-run by default; ?send=1 to actually send.
//
// User direction, 2026-08-26 (screenshots of these exact reminder emails,
// Unit 97M/Venetian Park I and Unit 802/MANXI): the resident-facing email had
// no call to action beyond a mailto link. Each resident email now carries a
// lease-renewal check-in link (app/lease-renewal/[token]/page.tsx,
// lib/lease-renewal-check.ts) — one lease_renewal_checks row per unit+lease
// end, created on the 30-day pass and reused on the 7-day pass so the link
// stays the same. Once a party has answered, further reminders to THAT party
// stop; once both have answered, the internal FYI stops too — "stop if
// satisfied," per that same direction.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { findOrCreateCheck, isSatisfied, hasOpenApplication } from '@/lib/lease-renewal-check'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const PMI = process.env.STAFF_ALERT_EMAIL ?? 'PMI@topfloridaproperties.com'
const AR  = process.env.LEASE_ALERT_CC ?? 'ar@topfloridaproperties.com'   // Jonathan / AR
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const firstEmail = (e: string | null) => (e ?? '').split(/[,;\s]+/).map(s => s.trim()).find(x => x.includes('@')) ?? null

function fmt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}
function dayOffset(n: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

export function internalHtml(o: { unit: string; assoc: string; tenant: string; owner: string; end: string; days: number }): string {
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p style="font-size:16px;font-weight:600;margin:0 0 10px">Lease expiring in ${o.days} days — Unit ${esc(o.unit)}</p>
    <table style="border-collapse:collapse;font-size:13px;margin:6px 0 14px">
      <tr><td style="padding:3px 10px;color:#6b7280">Association</td><td style="padding:3px 10px">${esc(o.assoc)}</td></tr>
      <tr><td style="padding:3px 10px;color:#6b7280">Unit</td><td style="padding:3px 10px">${esc(o.unit)}</td></tr>
      <tr><td style="padding:3px 10px;color:#6b7280">Tenant</td><td style="padding:3px 10px">${esc(o.tenant)}</td></tr>
      <tr><td style="padding:3px 10px;color:#6b7280">Owner</td><td style="padding:3px 10px">${esc(o.owner)}</td></tr>
      <tr><td style="padding:3px 10px;color:#6b7280">Lease ends</td><td style="padding:3px 10px"><strong>${fmt(o.end)}</strong></td></tr>
    </table>
    <p style="color:#6b7280;font-size:12px">Please coordinate renewal or move-out. — MAIA, PMI Top Florida Properties</p>
  </div>`
}
export function residentHtml(o: { name: string; unit: string; assoc: string; end: string; days: number; link: string }): string {
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p>Dear ${o.name ? esc(o.name) : 'Resident'},</p>
    <p>This is a reminder that the lease for <strong>Unit ${esc(o.unit)}</strong> at <strong>${esc(o.assoc)}</strong> is scheduled to expire on <strong>${fmt(o.end)}</strong> — in <strong>${o.days} days</strong>.</p>
    <p>Please let us know what's happening so we can help:</p>
    <p style="margin:10px 0"><a href="${o.link}" style="display:inline-block;background:#c0571a;color:#fff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:8px">Tell us what's next</a></p>
    <p style="margin:4px 0">Or contact us directly — ✉ <a href="mailto:PMI@topfloridaproperties.com">PMI@topfloridaproperties.com</a> · ☎ (305) 900-5077</p>
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

  const windows = [{ days: 30, date: dayOffset(30) }, { days: 7, date: dayOffset(7) }]
  const results: { unit: string; assoc: string; days: number; to: string[] }[] = []

  for (const w of windows) {
    const { data: leases } = await supabaseAdmin.from('unit_tenant_contacts')
      .select('association_code, unit_ref, tenant_name, tenant_email, lease_end')
      .eq('lease_end', w.date)
    for (const l of leases ?? []) {
      const assoc = String(l.association_code); const account = String(l.unit_ref)
      const [{ data: owner }, { data: assocRow }, { data: mgrs }, { data: board }] = await Promise.all([
        supabaseAdmin.from('owners').select('first_name, last_name, entity_name, emails, unit_number').eq('association_code', assoc).eq('account_number', account).or('status.neq.previous,status.is.null').maybeSingle(),
        supabaseAdmin.from('associations').select('association_name').eq('association_code', assoc).maybeSingle(),
        supabaseAdmin.from('building_managers').select('email').eq('association_code', assoc).eq('active', true),
        supabaseAdmin.from('association_board_members').select('email').eq('association_code', assoc).eq('active', true),
      ])
      const assocName = (assocRow?.association_name as string | null) ?? assoc
      const unit = (owner?.unit_number as string | null) || account
      const ownerName = (owner?.entity_name as string | null) || [owner?.first_name, owner?.last_name].filter(Boolean).join(' ').trim() || '—'
      const ownerEmail = firstEmail((owner?.emails as string | null) ?? null)
      const tenantEmail = firstEmail((l.tenant_email as string | null) ?? null)
      const tenantName = (l.tenant_name as string | null) ?? '—'

      // A unit already being actively worked (any non-terminal application,
      // not just a renewal) doesn't need the nag — staff already has it.
      if (await hasOpenApplication(assoc, unit)) continue

      // Check-in row: same one across the 30-day and 7-day pass, so the link
      // in both emails is identical. Created (or refreshed with current
      // addresses) even in dry-run — the row itself has no send side effect.
      const check = await findOrCreateCheck({
        associationCode: assoc, unitLabel: unit, leaseEnd: String(l.lease_end),
        ownerEmail, tenantEmail, ownerName: ownerName === '—' ? null : ownerName, tenantName: tenantName === '—' ? null : tenantName,
      })
      const satisfied = check ? isSatisfied(check) : { owner: false, tenant: false }

      // Internal FYI recipients (deduped): PMI, AR/Jonathan, on-site managers, board.
      // Skipped once BOTH parties have answered — nothing left to coordinate.
      const internal = satisfied.owner && satisfied.tenant ? [] : [...new Set([PMI, AR,
        ...(mgrs ?? []).map(m => firstEmail(m.email as string | null)),
        ...(board ?? []).map(b => firstEmail(b.email as string | null))].filter((e): e is string => !!e))]
      // Residents: owner + tenant, each dropped once THEY'VE answered.
      const sendOwner = !satisfied.owner ? ownerEmail : null
      const sendTenant = !satisfied.tenant ? tenantEmail : null
      const residents = [...new Set([sendOwner, sendTenant].filter((e): e is string => !!e))]

      results.push({ unit, assoc: assocName, days: w.days, to: [...internal, ...residents] })
      if (dryRun) continue

      const subj = `Lease expiring in ${w.days} days — Unit ${unit}, ${assocName}`
      for (const to of internal) { try { await sendEmail({ to, subject: subj, html: internalHtml({ unit, assoc: assocName, tenant: tenantName, owner: ownerName, end: String(l.lease_end), days: w.days }) }) } catch { /* continue */ } }
      if (sendOwner && check) { try { await sendEmail({ to: sendOwner, subject: `Lease renewal reminder — Unit ${unit}, ${assocName}`, html: residentHtml({ name: ownerName, unit, assoc: assocName, end: String(l.lease_end), days: w.days, link: `${APP}/lease-renewal/${check.owner_token}` }) }) } catch { /* */ } }
      if (sendTenant && check) { try { await sendEmail({ to: sendTenant, subject: `Lease renewal reminder — Unit ${unit}, ${assocName}`, html: residentHtml({ name: tenantName, unit, assoc: assocName, end: String(l.lease_end), days: w.days, link: `${APP}/lease-renewal/${check.tenant_token}` }) }) } catch { /* */ } }
    }
  }

  return NextResponse.json({ ok: true, dryRun, leases: results.length, alerts: results })
}
