// =====================================================================
// POST /api/admin/applications/create-test
//
// Staff-only. Creates a real applications row (marked is_test=true,
// stripe_payment_status='paid' -- bypasses Stripe entirely) and triggers
// a real order against Checkr's sandbox, so staff can exercise the whole
// pipeline (order -> webhook -> report PDF -> dashboard badges) without
// waiting for a real applicant.
//
// Test-mode scenarios, per Checkr's documented "Canned Provider Scenarios"
// (checkr-tenant-api-docs.redocly.app/testing#canned-provider-scenarios,
// confirmed directly by Checkr support 2026-08-31). A scenario only fires
// on an EXACT match of first_name + last_name + dob + ssn together -- a
// partial match (e.g. reusing a documented ssn with a different name/dob,
// which the ORIGINAL version of this route did) is treated as a miss and
// silently falls through to an inert "clean scenario for every product",
// not the real canned data for that ssn. See lib/screening/checkr.ts's
// file header for the fuller writeup of that bug.
//   'auto'            -- the exact Norma Davies tuple: clear criminal
//                        history, clear credit report. The documented
//                        "golden path" clean result -- auto-completes to
//                        "pending" -> "completed" in seconds, no email sent.
//   'credit_consider' -- the exact Madelyn Webster tuple: clear criminal
//                        history, credit report flagged "consider". Use
//                        this to verify credit-report data actually comes
//                        back populated and non-clear.
//   'income_verification' -- the exact Ingrid Vance tuple (ssn
//                        666-66-6666): returns bank-sourced income data
//                        from three attached sample documents (paystub,
//                        W-2, bank statement), all low document-risk.
//   'hudson_green'     -- the exact documented canned tuple that instead
//                        returns "waiting_for_applicant" and genuinely
//                        emails a hosted consent link, same as a real
//                        order would.
// (Checkr's separate Workforce mock-candidate spreadsheet -- Nick Jonas,
// Bruce Ralph Clark, etc. -- does NOT apply to the Tenant API this
// integration uses; confirmed directly by Checkr 2026-07-06.)
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AppType = 'individual' | 'couple' | 'additionalResident' | 'commercial' | 'international'
type Scenario = 'auto' | 'credit_consider' | 'income_verification' | 'hudson_green'

const HUDSON_GREEN = { firstName: 'Hudson', lastName: 'Green', dob: '1996-04-27', ssn: '555-55-5555' }
const NORMA_DAVIES = { firstName: 'Norma', lastName: 'Davies', dob: '1996-04-27', ssn: '333-33-3333' }
const MADELYN_WEBSTER = { firstName: 'Madelyn', lastName: 'Webster', dob: '1996-04-27', ssn: '222-22-2222' }
const INGRID_VANCE = { firstName: 'Ingrid', lastName: 'Vance', dob: '1996-04-27', ssn: '666-66-6666' }
const ASSOCIATION_NAME = 'Venetian Park Condominium I Association, Inc.'

const FIXED_TUPLES: Partial<Record<Scenario, { firstName: string; lastName: string; dob: string; ssn: string }>> = {
  hudson_green: HUDSON_GREEN,
  auto: NORMA_DAVIES,
  credit_consider: MADELYN_WEBSTER,
  income_verification: INGRID_VANCE,
}

function genericApplicant(i: number) {
  // Deliberately does NOT match any documented canned tuple -- used only
  // for the second applicant on a couple, where a real scenario name is
  // rarely needed. Returns the inert "clean scenario for every product".
  return { firstName: 'Test', lastName: `Applicant${i}`, email: 'PMI@topfloridaproperties.com', dob: '1985-06-15', ssn: '999-99-9999', unitApplying: '101' }
}

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { appType?: AppType; scenario?: Scenario; lang?: string; customName?: string; customEmail?: string }
  const appType: AppType = body.appType ?? 'individual'
  const requestedScenario = body.scenario && body.scenario in FIXED_TUPLES ? body.scenario : 'auto'
  const scenario: Scenario = requestedScenario !== 'auto' && appType === 'commercial' ? 'auto' : requestedScenario
  const lang = body.lang ?? 'en'
  const customEmail = body.customEmail?.trim() || 'PMI@topfloridaproperties.com'
  // Every fixed-tuple scenario's first/last name is exactly what Checkr's
  // canned-scenario matcher requires -- only the email can be customized.
  // For 'auto' specifically, a custom name is allowed to override, but it
  // must NOT be paired with a documented canned ssn (that's the exact bug
  // this file used to have) -- use an inert one instead, same as
  // genericApplicant(), so an overridden name deliberately gets the clean
  // "any other tuple" result rather than an accidental partial match.
  const [customFirst, ...customLastParts] = (body.customName?.trim() || '').split(/\s+/)
  const customLast = customLastParts.join(' ')

  const insert: Record<string, unknown> = {
    association: ASSOCIATION_NAME,
    app_type: appType,
    total_charged: 150,
    stripe_payment_status: 'paid',
    stripe_amount_paid: 150,
    language: lang,
    is_test: true,
  }

  function firstApplicant() {
    if (scenario !== 'auto') return { ...FIXED_TUPLES[scenario]!, email: customEmail, unitApplying: '101' }
    if (customFirst) return { firstName: customFirst, lastName: customLast || customFirst, email: customEmail, dob: '1985-06-15', ssn: '999-99-9999', unitApplying: '101' }
    return { ...NORMA_DAVIES, email: customEmail, unitApplying: '101' }
  }

  if (appType === 'commercial') {
    insert.principals = [{ name: customFirst ? `${customFirst} ${customLast}`.trim() : 'Test Principal', dob: '1980-01-01', unit: '101' }]
  } else if (appType === 'couple') {
    insert.applicants = [firstApplicant(), genericApplicant(2)]
    insert.couple_has_cert = false
  } else {
    insert.applicants = [firstApplicant()]
  }

  const { data: app, error } = await supabaseAdmin.from('applications').insert(insert).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  let triggerResult: unknown = null
  try {
    const res = await fetch(`${base}/api/trigger-screening`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_API_SECRET || '' },
      body: JSON.stringify({ applicationId: app.id }),
    })
    triggerResult = await res.json().catch(() => null)
  } catch (e) {
    triggerResult = { error: e instanceof Error ? e.message : String(e) }
  }

  return NextResponse.json({ ok: true, applicationId: app.id, scenario, triggerResult })
}

/** Removes a test application (and its screening_subjects rows) --
 *  guarded to is_test=true so this can never touch a real applicant. */
export async function DELETE(req: Request) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await req.json().catch(() => ({})) as { id?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: app } = await supabaseAdmin.from('applications').select('id, is_test').eq('id', id).maybeSingle()
  if (!app || !app.is_test) return NextResponse.json({ error: 'Not a test application' }, { status: 400 })

  await supabaseAdmin.from('screening_subjects').delete().eq('application_id', id)
  await supabaseAdmin.from('applications').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
