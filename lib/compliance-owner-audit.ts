// =====================================================================
// lib/compliance-owner-audit.ts
// Scan units for missing required documents and email each owner their
// self-service link (/owner/compliance/<token>), pacing reminders so nobody
// is spammed. Safe by design: capped per run, scoped per association,
// cadence-gated, and gated behind OWNER_AUDIT_ENABLED for live sends.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { signOwnerComplianceToken } from '@/lib/owner-portal-token'
import { getUnitComplianceState } from '@/lib/unit-required-docs'
import { sendEmail } from '@/lib/gmail'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const REMINDER_DAYS = 14
const MAX_SENDS = 4
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

function firstEmail(emails: string | null): string | null {
  if (!emails) return null
  return emails.split(/[,;\s]+/).map(s => s.trim()).find(e => e.includes('@')) ?? null
}

export interface AuditResult {
  scanned: number; needDocs: number; eligible: number; sent: number
  samples: { account: string; email: string | null; missing: string[] }[]
}

export async function runOwnerComplianceAudit(opts: { assoc?: string | null; dryRun?: boolean; limit?: number } = {}): Promise<AuditResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500))
  let q = supabaseAdmin.from('owners')
    .select('account_number, association_code, emails, first_name, last_name, association_name')
    .or('status.neq.previous,status.is.null')
  if (opts.assoc) q = q.eq('association_code', opts.assoc.toUpperCase())
  const { data } = await q
  const owners = (data ?? []) as { account_number: string | null; association_code: string; emails: string | null; first_name: string | null; last_name: string | null; association_name: string | null }[]

  const seen = new Set<string>()
  const res: AuditResult = { scanned: 0, needDocs: 0, eligible: 0, sent: 0, samples: [] }

  for (const o of owners) {
    if (!o.account_number) continue
    const key = `${o.association_code}:${o.account_number}`
    if (seen.has(key)) continue
    seen.add(key)
    res.scanned++

    const { missing } = await getUnitComplianceState(o.association_code, o.account_number)
    // Mark resolved + skip when the unit's file is complete.
    if (missing.length === 0) {
      await supabaseAdmin.from('owner_compliance_requests')
        .update({ resolved_at: new Date().toISOString() })
        .eq('association_code', o.association_code).eq('unit_ref', o.account_number).is('resolved_at', null)
        .then(() => null, () => null)
      continue
    }
    res.needDocs++
    const email = firstEmail(o.emails)
    if (!email) continue

    const { data: req } = await supabaseAdmin.from('owner_compliance_requests')
      .select('last_sent_at, send_count').eq('association_code', o.association_code).eq('unit_ref', o.account_number).maybeSingle()
    const recently = req?.last_sent_at && (Date.now() - new Date(req.last_sent_at as string).getTime()) < REMINDER_DAYS * 86_400_000
    const maxed = (req?.send_count ?? 0) >= MAX_SENDS
    if (recently || maxed) continue
    res.eligible++

    if (res.sent >= limit) continue
    if (opts.dryRun) { if (res.samples.length < 25) res.samples.push({ account: o.account_number, email, missing: missing.map(m => m.label) }); res.sent++; continue }

    const name = [o.first_name, o.last_name].filter(Boolean).join(' ').trim()
    const link = `${APP}/owner/compliance/${await signOwnerComplianceToken(o.association_code, o.account_number)}`
    const list = missing.map(m => `<li>${esc(m.label)}</li>`).join('')
    await sendEmail({
      to: email,
      subject: `Documents needed for your unit — ${o.association_name ?? o.association_code}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
        <p>Hello${name ? ` ${esc(name)}` : ''},</p>
        <p>PMI Top Florida Properties manages <strong>${esc(o.association_name ?? o.association_code)}</strong>. To keep your unit file current, we still need:</p>
        <ul>${list}</ul>
        <p style="margin:22px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">Confirm &amp; upload →</a></p>
        <p style="color:#6b7280;font-size:12px">No account needed. This link is specific to your unit and expires in 30 days.</p>
        <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p>
      </div>`,
    }).then(() => { res.sent++ }, () => null)

    await supabaseAdmin.from('owner_compliance_requests').upsert(
      { association_code: o.association_code, unit_ref: o.account_number, last_sent_at: new Date().toISOString(), send_count: (req?.send_count ?? 0) + 1, resolved_at: null },
      { onConflict: 'association_code,unit_ref' },
    ).then(() => null, () => null)
  }

  return res
}
