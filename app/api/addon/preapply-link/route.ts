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
import { guideAvailable } from '@/lib/application-guide-data'

export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

const TYPE_WORD: Record<string, string> = { lease: 'lease/rental', purchase: 'purchase', lease_renewal: 'lease renewal', additional_occupant: 'additional occupant' }

// A brand-new application at this unit still routes through this SAME link
// even when one is already open -- /api/pre-apply/start's own dedupe (see
// its findOpenUnitApplication) folds a second self-identified person into
// the existing application as a collaborator instead of spawning a
// duplicate. This check exists so STAFF know that before sending, not to
// pick a different URL -- there isn't a different one to pick.
const PRIMARY_TYPES = ['lease', 'purchase', 'lease_renewal']

export async function POST(req: Request) {
  const staff = await addonStaffEmail(req)
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let b: { association_code?: string; type?: string; unit?: string; to_name?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const code = String(b.association_code ?? '').trim().toUpperCase()
  // No type picker in the Gmail add-on's consolidated "Create → Application
  // Link" flow -- defaults to the overwhelmingly common case (a rental).
  // It's only a UI preselect on the pre-apply page itself, changeable there.
  const rawType = String(b.type ?? '').trim()
  const type = isApplicationType(rawType) ? rawType : 'lease'
  const unit = String(b.unit ?? '').trim()
  const toName = String(b.to_name ?? '').trim()
  if (!code) return NextResponse.json({ error: 'Choose an association first.' }, { status: 400 })

  const { data: assoc } = await supabaseAdmin.from('associations')
    .select('association_code, association_name, legal_name, active').eq('association_code', code).maybeSingle()
  if (!assoc || assoc.active === false) return NextResponse.json({ error: 'This association is not accepting applications online.' }, { status: 404 })
  const assocName = (assoc.legal_name as string | null) || (assoc.association_name as string | null) || code

  // Real case this surfaces: a SECOND agent asking for "the application" on
  // a unit where one is already in progress (started by a different agent's
  // client, or the owner). Staff should know before sending, even though
  // the link itself is safe to send either way.
  let openLeadName: string | null = null
  if (unit) {
    const { data: openApps } = await supabaseAdmin.from('listing_applications')
      .select('id').eq('association_code', code).eq('unit_label', unit)
      .in('application_type', PRIMARY_TYPES).not('status', 'in', '("approved","declined","withdrawn")')
      .order('created_at', { ascending: true }).limit(1)
    const openApp = (openApps ?? [])[0]
    if (openApp) {
      const { data: lead } = await supabaseAdmin.from('application_stakeholders')
        .select('name, role').eq('application_id', openApp.id).eq('is_primary', true).maybeSingle()
      openLeadName = (lead?.name as string | null) ?? 'someone'
    }
  }

  const params = new URLSearchParams({ type })
  if (unit) params.set('unit', unit)
  const url = `${APP}/pre-apply/${encodeURIComponent(code)}?${params.toString()}`

  // Real gap this closes: staff manually appended a second link (the
  // Application Guide — eligibility rules, fees, full document checklist,
  // move-in procedures) onto the composed reply by hand when an agent asked
  // for "the requirements" alongside the application itself (agent report,
  // 2026-09-03: Lucely Coral, MANXI Unit 513). guideAvailable() gates it —
  // only MANXI has a guide content module registered so far (see
  // lib/application-guide-data.ts's GUIDE_CONTENT); every other association
  // just gets the application-link paragraph, same as before.
  const guideParagraphs = guideAvailable(code) ? [
    '',
    'Association requirements & move-in procedures: our full Application Guide covers eligibility rules, the step-by-step process and fees, and the complete document checklist, plus what\'s registered separately after approval (gate access, club ID, etc.):',
    '',
    `${APP}/apply/${encodeURIComponent(code)}/guide`,
  ] : []

  const unitLine = unit ? ` for Unit ${unit}` : ''
  const draftText = [
    `Hello${toName ? ` ${toName}` : ''},`,
    '',
    `Thank you for reaching out about the ${TYPE_WORD[type] ?? type} application${unitLine} at ${assocName}.`,
    '',
    'Everything is self-service through our secure application portal. Please open the link below and follow the steps: confirm the unit, upload the required documents, sign the association acknowledgment, and pay the one-time application fee, which also covers the background/credit/eviction check.',
    '',
    url,
    ...guideParagraphs,
    '',
    'A note on who should open it: the actual applicant (your client) should complete their own part with their own email address, since the background check consent link can only go to them. You\'re welcome to start the application yourself and add your client — and the other agent, if there is one — as collaborators from there; each person gets their own secure link by email to fill in their part in parallel.',
    '',
    'Please let us know if you have any questions.',
    '',
    'Thank you,',
    'PMI Top Florida Properties',
  ].join('\n')

  const viewToken = await saveDraftView(draftText)
  return NextResponse.json({
    url, draftText, viewToken,
    openApplication: openLeadName ? { leadName: openLeadName } : null,
  })
}
