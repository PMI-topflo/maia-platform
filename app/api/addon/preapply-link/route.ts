// POST /api/addon/preapply-link
//   { association_code, type, unit?, to_name? }
// Builds the public pre-apply start link for an association (optionally
// pre-filling the application type + unit so whoever opens it skips typing
// them), wraps it in a ready-to-paste reply email (same voice as
// lib/application-standard-reply.ts's drafts), and stashes the text via the
// same addon-draft-views mechanism the other draft-reply copy pages already
// use, so the Gmail add-on can hand staff a real "open to copy" page.
//
// Real gap this closes: an agent emails asking for "the rental application"
// for a unit nobody has an application for yet -- MAIA's own self-serve
// /pre-apply/[code] portal is the actual first step (the agent, or better
// their client, self-identifies and MAIA takes it from there), but staff had
// no quick way to hand that back without leaving Gmail to compose it by
// hand. Auth: add-on bearer token.

import { NextResponse } from 'next/server'
import { addonStaffEmail } from '@/lib/addon-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isApplicationType } from '@/lib/intake-documents'
import { saveDraftView } from '@/lib/addon-draft-views'

export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

const TYPE_WORD: Record<string, string> = { lease: 'lease/rental', purchase: 'purchase', lease_renewal: 'lease renewal', additional_occupant: 'additional occupant' }

export async function POST(req: Request) {
  const staff = await addonStaffEmail(req)
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let b: { association_code?: string; type?: string; unit?: string; to_name?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const code = String(b.association_code ?? '').trim().toUpperCase()
  const type = String(b.type ?? '').trim()
  const unit = String(b.unit ?? '').trim()
  const toName = String(b.to_name ?? '').trim()
  if (!code) return NextResponse.json({ error: 'Choose an association first.' }, { status: 400 })
  if (!isApplicationType(type)) return NextResponse.json({ error: 'Choose an application type.' }, { status: 400 })

  const { data: assoc } = await supabaseAdmin.from('associations')
    .select('association_code, association_name, legal_name, active').eq('association_code', code).maybeSingle()
  if (!assoc || assoc.active === false) return NextResponse.json({ error: 'This association is not accepting applications online.' }, { status: 404 })
  const assocName = (assoc.legal_name as string | null) || (assoc.association_name as string | null) || code

  const params = new URLSearchParams({ type })
  if (unit) params.set('unit', unit)
  const url = `${APP}/pre-apply/${encodeURIComponent(code)}?${params.toString()}`

  const unitLine = unit ? ` for Unit ${unit}` : ''
  const draftText = [
    `Hello${toName ? ` ${toName}` : ''},`,
    '',
    `Thank you for reaching out about the ${TYPE_WORD[type] ?? type} application${unitLine} at ${assocName}.`,
    '',
    'Everything is self-service through our secure application portal — no PDF to fill out or fax. Please open the link below and follow the steps: confirm the unit, upload the required documents, sign the association acknowledgment, and pay the one-time application fee, which also covers the background/credit/eviction check.',
    '',
    url,
    '',
    'A note on who should open it: the actual applicant (your client) should complete their own part with their own email address, since the background check consent link can only go to them. You\'re welcome to start the application yourself and add your client — and the other agent, if there is one — as collaborators from there; each person gets their own secure link by email to fill in their part in parallel.',
    '',
    'Please let us know if you have any questions.',
    '',
    'Thank you,',
    'PMI Top Florida Properties',
  ].join('\n')

  const viewToken = await saveDraftView(draftText)
  return NextResponse.json({ url, draftText, viewToken })
}
