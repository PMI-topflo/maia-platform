// POST /api/admin/pre-apply/send-invite
//   { assoc, unit, name, email, lang?, ccOwner?, ccBoard? }
// Email an applicant the standard invite with their unit-scoped application link
// (no application record needs to exist yet). Optionally CC the owner + board.
// Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { renderMaiaEmail } from '@/lib/maia-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const SUPPORT = 'support@topfloridaproperties.com'
const splitEmails = (raw: string | null | undefined) => [...new Set((raw ?? '').split(',').map(s => s.trim()).filter(e => e.includes('@')))]

export async function POST(req: Request, ctx?: unknown) {
  void ctx
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let b: { assoc?: string; unit?: string; name?: string; email?: string; lang?: string; ccOwner?: boolean; ccBoard?: boolean }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const assoc = String(b.assoc ?? '').trim().toUpperCase()
  const unit = String(b.unit ?? '').trim()
  const name = String(b.name ?? '').trim()
  const email = String(b.email ?? '').trim()
  const lang = String(b.lang ?? '').trim()
  if (!assoc) return NextResponse.json({ error: 'Association is required.' }, { status: 400 })
  if (!email.includes('@')) return NextResponse.json({ error: 'Enter the applicant\'s email.' }, { status: 400 })

  const qs = [unit ? `unit=${encodeURIComponent(unit)}` : '', lang ? `lang=${lang}` : ''].filter(Boolean).join('&')
  const link = `${APP}/pre-apply/${encodeURIComponent(assoc)}${qs ? `?${qs}` : ''}`

  const [{ data: a }, { data: owners }, { data: board }] = await Promise.all([
    supabaseAdmin.from('associations').select('legal_name, association_name, principal_address, city, state, zip').eq('association_code', assoc).maybeSingle(),
    b.ccOwner && unit ? supabaseAdmin.from('owners').select('emails').eq('association_code', assoc).or(`unit_number.eq.${unit},account_number.eq.${assoc}${unit}`).or('status.neq.previous,status.is.null') : Promise.resolve({ data: [] }),
    b.ccBoard ? supabaseAdmin.from('association_board_members').select('email').eq('association_code', assoc).eq('active', true) : Promise.resolve({ data: [] }),
  ])
  const legal = (a?.legal_name as string | null) || (a?.association_name as string | null) || assoc
  const address = [a?.principal_address, unit ? `Unit ${unit}` : null, [a?.city, [a?.state, a?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') || null
  const cc = [
    ...(owners ?? []).flatMap(o => splitEmails(o.emails as string | null)),
    ...(board ?? []).map(m => String(m.email ?? '').trim()).filter(e => e.includes('@')),
  ].filter(e => e.toLowerCase() !== email.toLowerCase())
  const ccUniq = [...new Set(cc)]

  await sendEmail({
    to: [email], cc: ccUniq.length ? ccUniq : undefined, replyTo: SUPPORT,
    subject: `Start your application — ${legal}${unit ? `, Unit ${unit}` : ''}`,
    html: renderMaiaEmail({
      associationName: legal, associationCode: assoc, propertyAddress: address, applicantNames: name ? [name] : [],
      heading: 'Start your application',
      intro: `Hello${name ? ` ${name}` : ''} — you can complete your application right here. Click below to start; it takes a few minutes and needs no login.`,
      ctaUrl: link, ctaLabel: 'Start my application →',
      footerReason: `You're receiving this to complete your application${unit ? ` for Unit ${unit}` : ''}.`,
    }),
  })
  return NextResponse.json({ ok: true, sentTo: email, cc: ccUniq })
}
