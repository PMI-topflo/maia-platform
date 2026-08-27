// GET /api/cron/expired-leases-digest
// Weekly digest of units whose lease has ALREADY expired (lease_end < today).
// Grouped by association, emailed as an internal FYI to PMI + Jonathan/AR + the
// association's on-site managers + board — so the board knows which units are
// on an expired lease. That internal list is unconditional: it's a compliance
// fact, and stays on it regardless of whether the resident below has replied.
//
// User direction, 2026-08-27: the owner/tenant themselves got no link here —
// only the 30/7-day pre-expiry reminder (lease-renewal-alerts) carried the
// check-in link, so a lease that was ALREADY expired before that reminder
// ever fired (or that nobody answered) never got one at all. Each expired
// unit now also gets the same lease-renewal check-in link
// (lib/lease-renewal-check.ts) sent to whichever party hasn't answered yet —
// reusing the SAME lease_renewal_checks row the 30/7-day cron would have
// created (keyed on association+unit+lease_end), so a resident who already
// answered there isn't re-asked here, and this cron is exactly what backfills
// a check-in link for leases that expired before this feature existed. Two
// callers:
//   • Vercel cron (Bearer CRON_SECRET) — sends.
//   • Staff (session) — dry-run by default; ?send=1 to actually send.

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
const AR  = process.env.LEASE_ALERT_CC ?? 'ar@topfloridaproperties.com'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const firstEmail = (e: string | null) => (e ?? '').split(/[,;\s]+/).map(s => s.trim()).find(x => x.includes('@')) ?? null
const fmt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) }

export interface Row { unit: string; tenant: string; owner: string; end: string; daysAgo: number; ownerEmail: string | null; tenantEmail: string | null; tenantName: string | null }

export function residentHtml(o: { name: string; unit: string; assoc: string; end: string; daysAgo: number; link: string }): string {
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p>Dear ${o.name ? esc(o.name) : 'Resident'},</p>
    <p>Our records show the lease for <strong>Unit ${esc(o.unit)}</strong> at <strong>${esc(o.assoc)}</strong> ended on <strong>${fmt(o.end)}</strong> — <strong>${o.daysAgo} day${o.daysAgo !== 1 ? 's' : ''} ago</strong>.</p>
    <p>Please let us know what's happening so we can update our records:</p>
    <p style="margin:10px 0"><a href="${o.link}" style="display:inline-block;background:#c0571a;color:#fff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:8px">Tell us what's next</a></p>
    <p style="margin:4px 0">Or contact us directly — ✉ <a href="mailto:PMI@topfloridaproperties.com">PMI@topfloridaproperties.com</a> · ☎ (305) 900-5077</p>
    <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p>
  </div>`
}

export function digestHtml(assocName: string, rows: Row[]): string {
  const body = rows.map(r => `<tr>
    <td style="padding:5px 10px;border:1px solid #e5e7eb">${esc(r.unit)}</td>
    <td style="padding:5px 10px;border:1px solid #e5e7eb">${esc(r.tenant)}</td>
    <td style="padding:5px 10px;border:1px solid #e5e7eb">${esc(r.owner)}</td>
    <td style="padding:5px 10px;border:1px solid #e5e7eb">${fmt(r.end)}</td>
    <td style="padding:5px 10px;border:1px solid #e5e7eb;color:#b91c1c">${r.daysAgo} day${r.daysAgo !== 1 ? 's' : ''} ago</td></tr>`).join('')
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p style="font-size:16px;font-weight:600;margin:0 0 4px">Expired leases — ${esc(assocName)} (${rows.length})</p>
    <p style="color:#6b7280;margin:0 0 12px">Units currently on an expired lease. Please follow up on renewal or move-out.</p>
    <table style="border-collapse:collapse;font-size:13px">
      <tr><th style="text-align:left;padding:5px 10px;background:#f9fafb;border:1px solid #e5e7eb">Unit</th><th style="text-align:left;padding:5px 10px;background:#f9fafb;border:1px solid #e5e7eb">Tenant</th><th style="text-align:left;padding:5px 10px;background:#f9fafb;border:1px solid #e5e7eb">Owner</th><th style="text-align:left;padding:5px 10px;background:#f9fafb;border:1px solid #e5e7eb">Lease ended</th><th style="text-align:left;padding:5px 10px;background:#f9fafb;border:1px solid #e5e7eb">Expired</th></tr>
      ${body}
    </table>
    <p style="color:#9ca3af;font-size:11px;margin-top:14px">— MAIA, PMI Top Florida Properties</p>
  </div>`
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const cron = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  const staff = !!session && session.persona === 'staff'
  if (!cron && !staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const dryRun = !(cron || sp.get('send') === '1')
  const today = new Date().toISOString().slice(0, 10)

  const { data: expired } = await supabaseAdmin.from('unit_tenant_contacts')
    .select('association_code, unit_ref, tenant_name, tenant_email, lease_end').not('lease_end', 'is', null).lt('lease_end', today)
  const byAssoc = new Map<string, { association_code: string; unit_ref: string; tenant_name: string | null; tenant_email: string | null; lease_end: string }[]>()
  for (const r of expired ?? []) {
    const a = String(r.association_code); if (!byAssoc.has(a)) byAssoc.set(a, [])
    byAssoc.get(a)!.push(r as { association_code: string; unit_ref: string; tenant_name: string | null; tenant_email: string | null; lease_end: string })
  }

  const out: { assoc: string; units: number; to: string[]; residentsSent: number }[] = []
  for (const [assoc, leases] of byAssoc) {
    const [{ data: assocRow }, { data: mgrs }, { data: board }] = await Promise.all([
      supabaseAdmin.from('associations').select('association_name').eq('association_code', assoc).maybeSingle(),
      supabaseAdmin.from('building_managers').select('email').eq('association_code', assoc).eq('active', true),
      supabaseAdmin.from('association_board_members').select('email').eq('association_code', assoc).eq('active', true),
    ])
    const assocName = (assocRow?.association_name as string | null) ?? assoc

    const rows: Row[] = []
    for (const l of leases) {
      const { data: o } = await supabaseAdmin.from('owners').select('first_name, last_name, entity_name, unit_number, emails').eq('association_code', assoc).eq('account_number', l.unit_ref).or('status.neq.previous,status.is.null').maybeSingle()
      const unitLabel = (o?.unit_number as string | null) || l.unit_ref
      // A unit already being actively worked (any non-terminal application)
      // doesn't need the nag — staff already has it.
      if (await hasOpenApplication(assoc, unitLabel)) continue
      const daysAgo = Math.max(0, Math.round((Date.now() - new Date(l.lease_end).getTime()) / 86_400_000))
      rows.push({
        unit: unitLabel,
        tenant: (l.tenant_name as string | null) || '—',
        owner: (o?.entity_name as string | null) || [o?.first_name, o?.last_name].filter(Boolean).join(' ').trim() || '—',
        end: l.lease_end, daysAgo,
        ownerEmail: firstEmail((o?.emails as string | null) ?? null),
        tenantEmail: firstEmail((l.tenant_email as string | null) ?? null),
        tenantName: (l.tenant_name as string | null) ?? null,
      })
    }
    rows.sort((a, b) => b.daysAgo - a.daysAgo)

    const recipients = [...new Set([PMI, AR,
      ...(mgrs ?? []).map(m => firstEmail(m.email as string | null)),
      ...(board ?? []).map(b => firstEmail(b.email as string | null))].filter((e): e is string => !!e))]

    // findOrCreateCheck runs even in dry-run (matches lease-renewal-alerts) —
    // the row itself has no send side effect, it just ensures the token
    // exists so a dry-run preview can show what WOULD go out.
    let residentsSent = 0
    for (const r of rows) {
      const check = await findOrCreateCheck({
        associationCode: assoc, unitLabel: r.unit, leaseEnd: r.end,
        ownerEmail: r.ownerEmail, tenantEmail: r.tenantEmail,
        ownerName: r.owner === '—' ? null : r.owner, tenantName: r.tenantName,
      })
      if (!check) continue
      const satisfied = isSatisfied(check)
      const sendToOwner = !satisfied.owner && r.ownerEmail
      const sendToTenant = !satisfied.tenant && r.tenantEmail
      if (sendToOwner) residentsSent++
      if (sendToTenant) residentsSent++
      if (dryRun) continue
      if (sendToOwner) { try { await sendEmail({ to: r.ownerEmail!, subject: `Lease renewal follow-up — Unit ${r.unit}, ${assocName}`, html: residentHtml({ name: r.owner, unit: r.unit, assoc: assocName, end: r.end, daysAgo: r.daysAgo, link: `${APP}/lease-renewal/${check.owner_token}` }) }) } catch { /* continue */ } }
      if (sendToTenant) { try { await sendEmail({ to: r.tenantEmail!, subject: `Lease renewal follow-up — Unit ${r.unit}, ${assocName}`, html: residentHtml({ name: r.tenant, unit: r.unit, assoc: assocName, end: r.end, daysAgo: r.daysAgo, link: `${APP}/lease-renewal/${check.tenant_token}` }) }) } catch { /* continue */ } }
    }

    out.push({ assoc: assocName, units: rows.length, to: recipients, residentsSent })
    if (dryRun) continue
    const html = digestHtml(assocName, rows)
    for (const to of recipients) { try { await sendEmail({ to, subject: `Expired leases — ${assocName} (${rows.length})`, html }) } catch { /* continue */ } }
  }

  return NextResponse.json({ ok: true, dryRun, associations: out.length, expiredTotal: (expired ?? []).length, digests: out })
}
