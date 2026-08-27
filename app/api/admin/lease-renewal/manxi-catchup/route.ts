// GET /api/admin/lease-renewal/manxi-catchup
// One-off, user-directed catch-up send for MANXI (Manors of Inverrary XI):
// resends the lease-renewal check-in link to every unit with an expired OR
// upcoming lease_end, regardless of the standing crons' exact-30/7-day
// matching. User direction, 2026-08-27: exclude board members from the
// internal recipients for this run, and skip any unit with an open
// application (hasOpenApplication, lib/lease-renewal-check.ts — a permanent
// rule both standing crons already apply).
//
// Staff session only. Dry-run by default; ?send=1 to actually send.
//
// RESUMABLE: the first live run hit MAIA's existing anti-runaway rate
// limiter (lib/outbound-rate-limit.ts — global cap of 20 sends/5min) almost
// immediately, since this fires far more emails in one burst than that cap
// allows; only 21 of ~68 attempted actually went out, the rest came back
// blocked (working as designed — that limiter exists precisely to stop a
// burst like this from flooding real inboxes, see the 2026-08-20 runaway
// incident it was built for). Before each send this now checks
// outbound_send_attempts for an already-successful (blocked_reason IS NULL)
// send with the same to_email+subject TODAY, and skips it — so hitting
// ?send=1 again a few minutes later (once the rolling window clears) picks
// up only what's still outstanding, with no duplicate sends. Keep
// re-triggering until the response's `blocked` count reaches 0.
//
// This is a temporary, narrowly-scoped route for this one catch-up — remove once used.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { findOrCreateCheck, isSatisfied, hasOpenApplication } from '@/lib/lease-renewal-check'
import { internalHtml, residentHtml as expiringResidentHtml } from '@/app/api/cron/lease-renewal-alerts/route'
import { digestHtml, residentHtml as expiredResidentHtml, type Row } from '@/app/api/cron/expired-leases-digest/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ASSOC = 'MANXI'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const PMI = process.env.STAFF_ALERT_EMAIL ?? 'PMI@topfloridaproperties.com'
const AR = process.env.LEASE_ALERT_CC ?? 'ar@topfloridaproperties.com'
const firstEmail = (e: string | null) => (e ?? '').split(/[,;\s]+/).map(s => s.trim()).find(x => x.includes('@')) ?? null

export async function GET(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const dryRun = sp.get('send') !== '1'

  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0)
  const [{ data: leases }, { data: assocRow }, { data: mgrs }, { data: already }] = await Promise.all([
    supabaseAdmin.from('unit_tenant_contacts').select('unit_ref, tenant_name, tenant_email, lease_end').eq('association_code', ASSOC).not('lease_end', 'is', null),
    supabaseAdmin.from('associations').select('association_name').eq('association_code', ASSOC).maybeSingle(),
    supabaseAdmin.from('building_managers').select('email').eq('association_code', ASSOC).eq('active', true),
    supabaseAdmin.from('outbound_send_attempts').select('to_email, subject').is('blocked_reason', null).gte('created_at', todayStart.toISOString()),
  ])
  const assocName = (assocRow?.association_name as string | null) ?? ASSOC
  // Board deliberately excluded from this run's internal recipients — user
  // direction, this run only. The standing automatic crons still include board.
  const internalRecipients = [...new Set([PMI, AR, ...(mgrs ?? []).map(m => firstEmail(m.email as string | null))].filter((e): e is string => !!e))]
  const alreadySent = new Set((already ?? []).map(r => `${String(r.to_email).toLowerCase()}|${r.subject}`))

  const log: string[] = []
  let skippedOpenApp = 0, residentSends = 0, internalExpiringSends = 0, delivered = 0, blocked = 0, alreadyDelivered = 0
  const expiredRows: Row[] = []

  // Sends one email, skipping it entirely if today's log already shows it
  // delivered, and tracking real outcome (delivered vs blocked) instead of
  // just intent — sendEmail returns {messageId:'blocked-by-...'} rather than
  // throwing when the rate limiter catches it.
  async function send(to: string, subject: string, html: string) {
    if (alreadySent.has(`${to.toLowerCase()}|${subject}`)) { alreadyDelivered++; return }
    if (dryRun) return
    try {
      const r = await sendEmail({ to, subject, html })
      if (r.messageId?.startsWith('blocked-by-')) blocked++
      else delivered++
    } catch { blocked++ }
  }

  for (const l of leases ?? []) {
    const account = String(l.unit_ref)
    const { data: owner } = await supabaseAdmin.from('owners').select('first_name, last_name, entity_name, emails, unit_number').eq('association_code', ASSOC).eq('account_number', account).or('status.neq.previous,status.is.null').maybeSingle()
    const unit = (owner?.unit_number as string | null) || account

    if (await hasOpenApplication(ASSOC, unit)) { skippedOpenApp++; log.push(`SKIP (open application): ${unit}`); continue }

    const ownerName = (owner?.entity_name as string | null) || [owner?.first_name, owner?.last_name].filter(Boolean).join(' ').trim() || '—'
    const ownerEmail = firstEmail((owner?.emails as string | null) ?? null)
    const tenantEmail = firstEmail((l.tenant_email as string | null) ?? null)
    const tenantName = (l.tenant_name as string | null) || '—'
    const end = String(l.lease_end)
    const days = Math.round((new Date(end).getTime() - Date.now()) / 86_400_000)
    const isExpired = days < 0

    const check = await findOrCreateCheck({
      associationCode: ASSOC, unitLabel: unit, leaseEnd: end,
      ownerEmail, tenantEmail, ownerName: ownerName === '—' ? null : ownerName, tenantName: tenantName === '—' ? null : tenantName,
    })
    if (!check) { log.push(`NO CHECK ROW (skipped): ${unit}`); continue }
    const satisfied = isSatisfied(check)
    const sendOwner = !satisfied.owner ? ownerEmail : null
    const sendTenant = !satisfied.tenant ? tenantEmail : null

    if (isExpired) {
      const daysAgo = Math.abs(days)
      expiredRows.push({ unit, tenant: tenantName, owner: ownerName, end, daysAgo, ownerEmail, tenantEmail, tenantName: tenantName === '—' ? null : tenantName })
      if (sendOwner) {
        log.push(`expired-owner: ${unit} ${sendOwner}`); residentSends++
        await send(sendOwner, `Lease renewal follow-up — Unit ${unit}, ${assocName}`, expiredResidentHtml({ name: ownerName, unit, assoc: assocName, end, daysAgo, link: `${APP}/lease-renewal/${check.owner_token}` }))
      }
      if (sendTenant) {
        log.push(`expired-tenant: ${unit} ${sendTenant}`); residentSends++
        await send(sendTenant, `Lease renewal follow-up — Unit ${unit}, ${assocName}`, expiredResidentHtml({ name: tenantName, unit, assoc: assocName, end, daysAgo, link: `${APP}/lease-renewal/${check.tenant_token}` }))
      }
    } else {
      for (const to of internalRecipients) {
        internalExpiringSends++
        await send(to, `Lease expiring in ${days} days — Unit ${unit}, ${assocName}`, internalHtml({ unit, assoc: assocName, tenant: tenantName, owner: ownerName, end, days }))
      }
      if (sendOwner) {
        log.push(`upcoming-owner: ${unit} ${sendOwner}`); residentSends++
        await send(sendOwner, `Lease renewal reminder — Unit ${unit}, ${assocName}`, expiringResidentHtml({ name: ownerName, unit, assoc: assocName, end, days, link: `${APP}/lease-renewal/${check.owner_token}` }))
      }
      if (sendTenant) {
        log.push(`upcoming-tenant: ${unit} ${sendTenant}`); residentSends++
        await send(sendTenant, `Lease renewal reminder — Unit ${unit}, ${assocName}`, expiringResidentHtml({ name: tenantName, unit, assoc: assocName, end, days, link: `${APP}/lease-renewal/${check.tenant_token}` }))
      }
    }
  }

  if (expiredRows.length) {
    expiredRows.sort((a, b) => b.daysAgo - a.daysAgo)
    const html = digestHtml(assocName, expiredRows)
    for (const to of internalRecipients) { await send(to, `Expired leases — ${assocName} (${expiredRows.length})`, html) }
  }

  return NextResponse.json({
    ok: true, dryRun, internalRecipients, skippedOpenApp, residentSends, internalExpiringSends,
    expiredDigestUnits: expiredRows.length,
    // delivered/blocked/alreadyDelivered only reflect a live run (dryRun sends nothing).
    // blocked > 0 means the rate limiter caught some — re-hit ?send=1 in a few
    // minutes to pick up exactly what's still outstanding, no duplicates.
    delivered, blocked, alreadyDelivered, log,
  })
}
