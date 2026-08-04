// GET /api/cron/pet-registration-alerts
// At EXACTLY 30 days and 7 days before a pet registration expires — and on the
// day it expires — notify everyone who needs to act: PMI + Jonathan (AR), the
// association's on-site managers + board, and the owner + tenant. Exact-day
// matching is the dedupe, so a daily cron never re-spams. Expiry = one year
// after the earliest rabies vaccination date across the pets (see
// petRegistrationExpiry). Mirrors /api/cron/lease-renewal-alerts. Two callers:
//   • Vercel cron (Bearer CRON_SECRET) — sends.
//   • Staff (session) — dry-run by default; ?send=1 to actually send.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { petRegistrationExpiry } from '@/lib/esign-forms'
import type { PetPayload } from '@/lib/esign-forms'
import type { EsignSigner } from '@/lib/esign'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const PMI = process.env.STAFF_ALERT_EMAIL ?? 'PMI@topfloridaproperties.com'
const AR  = process.env.LEASE_ALERT_CC ?? 'ar@topfloridaproperties.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const firstEmail = (e: string | null) => (e ?? '').split(/[,;\s]+/).map(s => s.trim()).find(x => x.includes('@')) ?? null
const fmt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) }
const dayOffset = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

const whenPhrase = (days: number) => days === 0 ? 'has expired' : `expires in ${days} days`

function internalHtml(o: { unit: string; assoc: string; pets: string; expiry: string; days: number }): string {
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p style="font-size:16px;font-weight:600;margin:0 0 10px">Pet registration ${whenPhrase(o.days)} — Unit ${esc(o.unit)}</p>
    <table style="border-collapse:collapse;font-size:13px;margin:6px 0 14px">
      <tr><td style="padding:3px 10px;color:#6b7280">Association</td><td style="padding:3px 10px">${esc(o.assoc)}</td></tr>
      <tr><td style="padding:3px 10px;color:#6b7280">Unit</td><td style="padding:3px 10px">${esc(o.unit)}</td></tr>
      <tr><td style="padding:3px 10px;color:#6b7280">Pet(s)</td><td style="padding:3px 10px">${esc(o.pets)}</td></tr>
      <tr><td style="padding:3px 10px;color:#6b7280">Registration ${o.days === 0 ? 'expired' : 'expires'}</td><td style="padding:3px 10px"><strong>${fmt(o.expiry)}</strong></td></tr>
    </table>
    <p style="color:#6b7280;font-size:12px">Please have the resident renew the pet registration / vaccination. — MAIA, PMI Top Florida Properties</p>
  </div>`
}
function residentHtml(o: { name: string; unit: string; assoc: string; pets: string; expiry: string; days: number }): string {
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p>Dear ${o.name ? esc(o.name) : 'Resident'},</p>
    <p>Your pet registration for <strong>Unit ${esc(o.unit)}</strong> at <strong>${esc(o.assoc)}</strong> (${esc(o.pets)}) ${o.days === 0 ? '<strong>has expired</strong>' : `is scheduled to expire on <strong>${fmt(o.expiry)}</strong> — in <strong>${o.days} days</strong>`}.</p>
    <p>Please renew it with an up-to-date rabies vaccination so your pet stays registered:</p>
    <p style="margin:4px 0">✉ <a href="mailto:PMI@topfloridaproperties.com">PMI@topfloridaproperties.com</a> · ☎ (305) 900-5077</p>
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

  // Latest completed pet registration per unit (older re-registrations ignored).
  const { data: docs } = await supabaseAdmin.from('esign_documents')
    .select('association_code, unit_ref, payload, signers, created_at')
    .eq('kind', 'pet_registration').eq('status', 'completed')
    .order('created_at', { ascending: false })
  type PetDocRow = { association_code: string; unit_ref: string; payload: PetPayload | null; signers: EsignSigner[] | null; created_at: string }
  const latest = new Map<string, PetDocRow>()
  for (const d of (docs ?? []) as unknown as PetDocRow[]) {
    const key = `${d.association_code}::${d.unit_ref}`
    if (!latest.has(key)) latest.set(key, d)
  }

  const windows = [{ days: 30, date: dayOffset(30) }, { days: 7, date: dayOffset(7) }, { days: 0, date: dayOffset(0) }]
  const results: { unit: string; assoc: string; days: number; to: string[] }[] = []

  for (const d of latest.values()) {
    const payload = (d.payload ?? {}) as PetPayload
    const signers = (Array.isArray(d.signers) ? d.signers : []) as EsignSigner[]
    const signedAt = signers.find(sg => sg.role === 'applicant')?.signed_at ?? null
    const expiry = petRegistrationExpiry(payload, signedAt)
    if (!expiry) continue
    const w = windows.find(x => x.date === expiry)
    if (!w) continue

    const assoc = String(d.association_code); const account = String(d.unit_ref)
    const petsLabel = (payload.pets ?? []).map(p => p.name || p.type).filter(Boolean).join(', ') || 'pet(s)'
    const [{ data: owner }, { data: assocRow }, { data: mgrs }, { data: board }, { data: tenant }] = await Promise.all([
      supabaseAdmin.from('owners').select('first_name, last_name, entity_name, emails, unit_number').eq('association_code', assoc).eq('account_number', account).or('status.neq.previous,status.is.null').maybeSingle(),
      supabaseAdmin.from('associations').select('association_name').eq('association_code', assoc).maybeSingle(),
      supabaseAdmin.from('building_managers').select('email').eq('association_code', assoc).eq('active', true),
      supabaseAdmin.from('association_board_members').select('email').eq('association_code', assoc).eq('active', true),
      supabaseAdmin.from('unit_tenant_contacts').select('tenant_name, tenant_email').eq('association_code', assoc).eq('unit_ref', account).maybeSingle(),
    ])
    const assocName = (assocRow?.association_name as string | null) ?? assoc
    const unit = (owner?.unit_number as string | null) || account
    const ownerName = (owner?.entity_name as string | null) || [owner?.first_name, owner?.last_name].filter(Boolean).join(' ').trim() || '—'
    const ownerEmail = firstEmail((owner?.emails as string | null) ?? null)
    const tenantEmail = firstEmail((tenant?.tenant_email as string | null) ?? null)
    const tenantName = (tenant?.tenant_name as string | null) ?? 'Resident'

    const internal = [...new Set([PMI, AR,
      ...(mgrs ?? []).map(m => firstEmail(m.email as string | null)),
      ...(board ?? []).map(b => firstEmail(b.email as string | null))].filter((e): e is string => !!e))]
    const residents = [...new Set([ownerEmail, tenantEmail].filter((e): e is string => !!e))]

    results.push({ unit, assoc: assocName, days: w.days, to: [...internal, ...residents] })
    if (dryRun) continue

    const subj = `Pet registration ${whenPhrase(w.days)} — Unit ${unit}, ${assocName}`
    for (const to of internal) { try { await sendEmail({ to, subject: subj, html: internalHtml({ unit, assoc: assocName, pets: petsLabel, expiry, days: w.days }) }) } catch { /* continue */ } }
    if (ownerEmail) { try { await sendEmail({ to: ownerEmail, subject: `Pet registration renewal — Unit ${unit}, ${assocName}`, html: residentHtml({ name: ownerName, unit, assoc: assocName, pets: petsLabel, expiry, days: w.days }) }) } catch { /* */ } }
    if (tenantEmail) { try { await sendEmail({ to: tenantEmail, subject: `Pet registration renewal — Unit ${unit}, ${assocName}`, html: residentHtml({ name: tenantName, unit, assoc: assocName, pets: petsLabel, expiry, days: w.days }) }) } catch { /* */ } }
  }

  return NextResponse.json({ ok: true, dryRun, alerts: results.length, detail: results })
}
