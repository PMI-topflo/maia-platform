// =====================================================================
// POST /api/pre-register/<token>
//
// Public (token-gated, no login). An unknown caller/contact fills the
// pre-registration form; we store the request and email PMI + Jonathan so
// a staff member can follow up and add them to the system if needed.
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyPreregisterToken } from '@/lib/preregister-token'
import { sendEmail } from '@/lib/gmail'
import { JONATHAN_EMAIL } from '@/lib/notify-recipients'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Who gets the "new pre-registration" alert.
const PREREG_NOTIFY: string[] = [
  process.env.MAIA_PREREG_NOTIFY ?? 'PMI@topfloridaproperties.com',
  JONATHAN_EMAIL,
]

const PERSONA_LABEL: Record<string, string> = {
  owner: 'Homeowner / Owner', tenant: 'Tenant / Renter', buyer: 'Buyer',
  board: 'Board Member', vendor: 'Vendor / Contractor', agent: 'Real Estate Agent', other: 'Other',
}
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const claims = await verifyPreregisterToken(token)
  if (!claims) return NextResponse.json({ error: 'This link is invalid or has expired. Please call us again.' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const persona   = String(body.persona ?? '').trim().toLowerCase()
  const fullName  = String(body.fullName ?? '').trim()
  const email     = String(body.email ?? '').trim()
  const association = String(body.association ?? '').trim()
  const unit      = String(body.unit ?? '').trim()
  const request   = String(body.request ?? '').trim()

  if (!fullName) return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 })
  if (!email.includes('@')) return NextResponse.json({ error: 'Please enter a valid email so our team can reply.' }, { status: 400 })
  if (!request)  return NextResponse.json({ error: 'Please tell us how we can help.' }, { status: 400 })

  const { error } = await supabaseAdmin.from('pre_registrations').insert({
    phone: claims.phone, persona: persona || null, full_name: fullName,
    email: email || null, association: association || null, unit: unit || null,
    request, source: claims.source, language: claims.lang, status: 'new',
  })
  if (error) return NextResponse.json({ error: 'Could not save your request. Please try again.' }, { status: 500 })

  // Notify PMI + Jonathan so a staffer can follow up.
  const roleLabel = PERSONA_LABEL[persona] ?? (persona || 'Not specified')
  const rows: [string, string][] = [
    ['Name', fullName], ['Role', roleLabel], ['Phone', claims.phone],
    ['Email', email || '—'], ['Property / Association', association || '—'],
    ['Unit', unit || '—'], ['Reached us via', claims.source],
  ]
  const html =
    `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
      <p>A new contact pre-registered through MAIA — they were not found in the system when they reached out.</p>
      <table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#6b7280">${k}</td><td style="padding:2px 0"><strong>${esc(v)}</strong></td></tr>`).join('')}</table>
      <p style="margin-top:12px"><strong>Their request:</strong><br>${esc(request).replace(/\n/g, '<br>')}</p>
      <p style="color:#6b7280;font-size:12px;margin-top:16px">Follow up and add them to the system if appropriate.</p>
    </div>`
  const text = `New pre-registration via MAIA.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nRequest:\n${request}`

  try {
    await sendEmail({ to: PREREG_NOTIFY, subject: `New pre-registration — ${fullName} (${roleLabel})`, html, text })
  } catch { /* the row is saved either way; don't fail the submission on email */ }

  return NextResponse.json({ ok: true })
}
