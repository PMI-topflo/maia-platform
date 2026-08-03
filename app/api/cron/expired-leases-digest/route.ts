// GET /api/cron/expired-leases-digest
// Weekly digest of units whose lease has ALREADY expired (lease_end < today).
// Grouped by association, emailed as an internal FYI to PMI + Jonathan/AR + the
// association's on-site managers + board — so the board knows which units are
// on an expired lease. Residents are NOT emailed here (that's the 30/7-day
// renewal reminder). Two callers:
//   • Vercel cron (Bearer CRON_SECRET) — sends.
//   • Staff (session) — dry-run by default; ?send=1 to actually send.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const PMI = process.env.STAFF_ALERT_EMAIL ?? 'PMI@topfloridaproperties.com'
const AR  = process.env.LEASE_ALERT_CC ?? 'ar@topfloridaproperties.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const firstEmail = (e: string | null) => (e ?? '').split(/[,;\s]+/).map(s => s.trim()).find(x => x.includes('@')) ?? null
const fmt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) }

interface Row { unit: string; tenant: string; owner: string; end: string; daysAgo: number }

function digestHtml(assocName: string, rows: Row[]): string {
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
    .select('association_code, unit_ref, tenant_name, lease_end').not('lease_end', 'is', null).lt('lease_end', today)
  const byAssoc = new Map<string, { association_code: string; unit_ref: string; tenant_name: string | null; lease_end: string }[]>()
  for (const r of expired ?? []) {
    const a = String(r.association_code); if (!byAssoc.has(a)) byAssoc.set(a, [])
    byAssoc.get(a)!.push(r as { association_code: string; unit_ref: string; tenant_name: string | null; lease_end: string })
  }

  const out: { assoc: string; units: number; to: string[] }[] = []
  for (const [assoc, leases] of byAssoc) {
    const [{ data: assocRow }, { data: mgrs }, { data: board }] = await Promise.all([
      supabaseAdmin.from('associations').select('association_name').eq('association_code', assoc).maybeSingle(),
      supabaseAdmin.from('building_managers').select('email').eq('association_code', assoc).eq('active', true),
      supabaseAdmin.from('association_board_members').select('email').eq('association_code', assoc).eq('active', true),
    ])
    const assocName = (assocRow?.association_name as string | null) ?? assoc

    const rows: Row[] = []
    for (const l of leases) {
      const { data: o } = await supabaseAdmin.from('owners').select('first_name, last_name, entity_name, unit_number').eq('association_code', assoc).eq('account_number', l.unit_ref).or('status.neq.previous,status.is.null').maybeSingle()
      const daysAgo = Math.max(0, Math.round((Date.now() - new Date(l.lease_end).getTime()) / 86_400_000))
      rows.push({
        unit: (o?.unit_number as string | null) || l.unit_ref,
        tenant: (l.tenant_name as string | null) || '—',
        owner: (o?.entity_name as string | null) || [o?.first_name, o?.last_name].filter(Boolean).join(' ').trim() || '—',
        end: l.lease_end, daysAgo,
      })
    }
    rows.sort((a, b) => b.daysAgo - a.daysAgo)

    const recipients = [...new Set([PMI, AR,
      ...(mgrs ?? []).map(m => firstEmail(m.email as string | null)),
      ...(board ?? []).map(b => firstEmail(b.email as string | null))].filter((e): e is string => !!e))]
    out.push({ assoc: assocName, units: rows.length, to: recipients })
    if (dryRun) continue
    const html = digestHtml(assocName, rows)
    for (const to of recipients) { try { await sendEmail({ to, subject: `Expired leases — ${assocName} (${rows.length})`, html }) } catch { /* continue */ } }
  }

  return NextResponse.json({ ok: true, dryRun, associations: out.length, expiredTotal: (expired ?? []).length, digests: out })
}
