// POST /api/admin/documents/drive/organize/request-insurance
//   { associationCode, unitRef, recommendation?, namedInsured? }
// Email the unit OWNER (cc Jonathan/AR + PMI) to request a proper HO-6
// declarations page, when the insurance on file is only a liability policy.
// Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Who gets cc'd — Jonathan (AR) + PMI. Configurable via env.
const CC = (process.env.INSURANCE_REQUEST_CC ?? 'ar@topfloridaproperties.com,PMI@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { associationCode?: string; unitRef?: string; recommendation?: string; namedInsured?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const association = String(body.associationCode ?? '').trim().toUpperCase()
  const unitRef = String(body.unitRef ?? '').trim()
  if (!association || !unitRef) return NextResponse.json({ error: 'associationCode and unitRef required' }, { status: 400 })

  const [{ data: owners }, { data: assoc }] = await Promise.all([
    supabaseAdmin.from('owners')
      .select('first_name, last_name, entity_name, emails')
      .eq('association_code', association).eq('account_number', unitRef)
      .or('status.neq.previous,status.is.null'),
    supabaseAdmin.from('associations').select('association_name').eq('association_code', association).maybeSingle(),
  ])
  const ownerRow = (owners ?? [])[0]
  const ownerEmail = String(ownerRow?.emails ?? '').split(',').map(s => s.trim()).filter(Boolean)[0]
  if (!ownerEmail) return NextResponse.json({ error: `No owner email on file for ${unitRef}. Send it manually.` }, { status: 200 })

  const ownerName = ownerRow?.entity_name || [ownerRow?.first_name, ownerRow?.last_name].filter(Boolean).join(' ') || 'Owner'
  const assocName = assoc?.association_name ?? association
  const rec = body.recommendation
    || 'Please provide your HO-6 condominium unit-owner declarations page showing dwelling/building (Coverage A), personal property (Coverage C), and loss-assessment (Coverage F) coverage.'

  try {
    await sendEmail({
      to: ownerEmail, cc: CC,
      subject: `Action needed: valid HO-6 insurance for unit ${unitRef} — ${assocName}`,
      html: `<p>Hello ${ownerName},</p>
             <p>Thank you for the insurance document you provided for your unit at <strong>${assocName}</strong> (unit ${unitRef})${body.namedInsured ? ` (named insured: ${body.namedInsured})` : ''}. On review, it is a <strong>liability-only policy</strong> and does not satisfy the condominium's requirement to insure the unit itself.</p>
             <p>${rec}</p>
             <p>A valid <strong>HO-6</strong> declarations page should show, at minimum: building/dwelling (Coverage A) or improvements &amp; betterments, personal property, loss assessment, water damage, and personal liability — with the unit owner as the named insured.</p>
             <p>Please reply to this email with the correct declarations page at your earliest convenience.</p>
             <p style="color:#6b7280;font-size:13px">— ${assocName} management (PMI Top Florida Properties)</p>`,
    })
    return NextResponse.json({ ok: true, sentTo: ownerEmail, cc: CC })
  } catch (e) {
    return NextResponse.json({ error: `Could not send: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 })
  }
}
