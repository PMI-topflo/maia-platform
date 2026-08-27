// GET /api/admin/lease-renewal/manxi-catchup
// One-off, user-directed catch-up send for MANXI (Manors of Inverrary XI):
// resends the lease-renewal check-in link to every unit with an expired OR
// upcoming lease_end, regardless of the standing crons' exact-30/7-day
// matching. User direction, 2026-08-27: exclude board members from the
// internal recipients for this run, and skip any unit with an open
// application (hasOpenApplication, lib/lease-renewal-check.ts — a permanent
// rule both standing crons already apply).
//
// Staff session only. Dry-run by default; ?send=1 to actually send. This is
// a temporary, narrowly-scoped route for this one catch-up — remove once used.

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

  const [{ data: leases }, { data: assocRow }, { data: mgrs }] = await Promise.all([
    supabaseAdmin.from('unit_tenant_contacts').select('unit_ref, tenant_name, tenant_email, lease_end').eq('association_code', ASSOC).not('lease_end', 'is', null),
    supabaseAdmin.from('associations').select('association_name').eq('association_code', ASSOC).maybeSingle(),
    supabaseAdmin.from('building_managers').select('email').eq('association_code', ASSOC).eq('active', true),
  ])
  const assocName = (assocRow?.association_name as string | null) ?? ASSOC
  // Board deliberately excluded from this run's internal recipients — user
  // direction, this run only. The standing automatic crons still include board.
  const internalRecipients = [...new Set([PMI, AR, ...(mgrs ?? []).map(m => firstEmail(m.email as string | null))].filter((e): e is string => !!e))]

  const log: string[] = []
  let skippedOpenApp = 0, residentSends = 0, internalExpiringSends = 0
  const expiredRows: Row[] = []

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
        if (!dryRun) { try { await sendEmail({ to: sendOwner, subject: `Lease renewal follow-up — Unit ${unit}, ${assocName}`, html: expiredResidentHtml({ name: ownerName, unit, assoc: assocName, end, daysAgo, link: `${APP}/lease-renewal/${check.owner_token}` }) }) } catch { /* continue */ } }
      }
      if (sendTenant) {
        log.push(`expired-tenant: ${unit} ${sendTenant}`); residentSends++
        if (!dryRun) { try { await sendEmail({ to: sendTenant, subject: `Lease renewal follow-up — Unit ${unit}, ${assocName}`, html: expiredResidentHtml({ name: tenantName, unit, assoc: assocName, end, daysAgo, link: `${APP}/lease-renewal/${check.tenant_token}` }) }) } catch { /* continue */ } }
      }
    } else {
      for (const to of internalRecipients) {
        internalExpiringSends++
        if (!dryRun) { try { await sendEmail({ to, subject: `Lease expiring in ${days} days — Unit ${unit}, ${assocName}`, html: internalHtml({ unit, assoc: assocName, tenant: tenantName, owner: ownerName, end, days }) }) } catch { /* continue */ } }
      }
      if (sendOwner) {
        log.push(`upcoming-owner: ${unit} ${sendOwner}`); residentSends++
        if (!dryRun) { try { await sendEmail({ to: sendOwner, subject: `Lease renewal reminder — Unit ${unit}, ${assocName}`, html: expiringResidentHtml({ name: ownerName, unit, assoc: assocName, end, days, link: `${APP}/lease-renewal/${check.owner_token}` }) }) } catch { /* continue */ } }
      }
      if (sendTenant) {
        log.push(`upcoming-tenant: ${unit} ${sendTenant}`); residentSends++
        if (!dryRun) { try { await sendEmail({ to: sendTenant, subject: `Lease renewal reminder — Unit ${unit}, ${assocName}`, html: expiringResidentHtml({ name: tenantName, unit, assoc: assocName, end, days, link: `${APP}/lease-renewal/${check.tenant_token}` }) }) } catch { /* continue */ } }
      }
    }
  }

  if (expiredRows.length) {
    expiredRows.sort((a, b) => b.daysAgo - a.daysAgo)
    if (!dryRun) {
      const html = digestHtml(assocName, expiredRows)
      for (const to of internalRecipients) { try { await sendEmail({ to, subject: `Expired leases — ${assocName} (${expiredRows.length})`, html }) } catch { /* continue */ } }
    }
  }

  return NextResponse.json({
    ok: true, dryRun, internalRecipients, skippedOpenApp, residentSends, internalExpiringSends,
    expiredDigestUnits: expiredRows.length, log,
  })
}
