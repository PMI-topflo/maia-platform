// POST /api/admin/pre-apply/[id]/remind-declaration
//   { key: 'vehicle' | 'animal' | 'taxReturns', stakeholderId?: string }
// Emails an applicant a link back to their own pre-apply page, asking them
// to answer the one yes/no declaration they haven't gotten to yet. The
// declaration questions only ever live on the applicant's own pre-apply page
// (app/pre-apply/[code]/page.tsx) -- staff can answer FOR her here
// (DeclarationsCard), but there was no way to actually ask HER to answer it
// herself. Staff-only.
//
// vehicle/taxReturns are answered per-applicant now -- stakeholderId picks
// WHICH applicant/buyer gets the email; omitted defaults to the primary,
// same as before this existed. animal has no stakeholderId (still a single,
// application-level question) and always goes to the primary.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { signPreApplyToken } from '@/lib/preapply-token'
import { sendEmail } from '@/lib/gmail'
import { logOutboundCommunication, DECLARATION_REMINDER_SUBJECT_PREFIX } from '@/lib/application-comm-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

const QUESTION: Record<string, string> = {
  vehicle: 'whether you keep a vehicle at the unit',
  animal: 'whether you have a pet, service animal, or emotional support animal',
  taxReturns: 'whether you have 2 years of U.S. tax returns',
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let b: { key?: string; stakeholderId?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const key = String(b.key ?? '')
  if (!QUESTION[key]) return NextResponse.json({ error: 'Unknown declaration.' }, { status: 400 })

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const code = String(app.association_code)
  const unit = (app.unit_label as string | null) ?? null

  // vehicle/taxReturns are answered per-applicant -- stakeholderId (from a
  // specific applicant's row on the DeclarationsCard) picks who gets asked.
  // animal has no per-person UI here, so it always targets the primary, same
  // as before this feature existed.
  const query = supabaseAdmin.from('application_stakeholders').select('id, name, email').eq('application_id', id).eq('role', 'applicant')
  const { data: sh } = await (typeof b.stakeholderId === 'string' && key !== 'animal' ? query.eq('id', b.stakeholderId) : query.eq('is_primary', true)).maybeSingle()
  if (!sh) return NextResponse.json({ error: 'No applicant on file for this application.' }, { status: 404 })
  if (!sh.email) return NextResponse.json({ error: `${sh.name ?? 'The applicant'} has no email on file — reach out directly to ask.` }, { status: 400 })

  const { data: assoc } = await supabaseAdmin.from('associations')
    .select('association_name, legal_name').eq('association_code', code).maybeSingle()
  const assocName = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || code

  const token = await signPreApplyToken(id, sh.id as string)
  const link = `${APP}/pre-apply/${encodeURIComponent(code)}?t=${encodeURIComponent(token)}`

  try {
    await sendEmail({
      to: sh.email as string,
      subject: `One quick question — your ${assocName} application${unit ? ` (Unit ${unit})` : ''}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px;margin:0 auto">
        <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f26a1b;font-weight:700;margin:0 0 4px">PMI Top Florida Properties</p>
        <h2 style="margin:0 0 8px;color:#1f2a44">One quick question</h2>
        <p>Hi${sh.name ? ` ${esc(String(sh.name))}` : ''}, we just need to know <strong>${esc(QUESTION[key])}</strong> to finish reviewing your application${unit ? ` for Unit ${esc(unit)}` : ''}. It only takes a moment.</p>
        <p style="text-align:center;margin:22px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px;display:inline-block">Answer now →</a></p>
        <p style="color:#9ca3af;font-size:12px">If the button doesn't work, copy this link:<br>${link}</p>
      </div>`,
    })
  } catch (err) {
    return NextResponse.json({ error: `Could not send the reminder: ${(err as Error).message}` }, { status: 502 })
  }

  // Logged key matches what DeclarationsCard looks reminders up by --
  // `${key}:${stakeholderId}` for vehicle/taxReturns (one reminder tracked
  // per applicant), bare `key` for animal (still one shared question).
  const reminderKey = key === 'animal' ? key : `${key}:${sh.id}`
  await logOutboundCommunication({
    applicationId: id, associationCode: code, unitLabel: unit,
    subject: `${DECLARATION_REMINDER_SUBJECT_PREFIX}${reminderKey}`,
    body: `Asked ${sh.name ?? 'the applicant'} to answer ${QUESTION[key]}.`,
    toEmails: [sh.email as string],
    loggedBy: `staff:${session.displayName}`,
  })

  return NextResponse.json({ ok: true })
}
