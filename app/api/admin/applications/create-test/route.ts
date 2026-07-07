// =====================================================================
// POST /api/admin/applications/create-test
//
// Staff-only. Creates a real applications row (marked is_test=true,
// stripe_payment_status='paid' -- bypasses Stripe entirely) and triggers
// a real order against Checkr's sandbox, so staff can exercise the whole
// pipeline (order -> webhook -> report PDF -> dashboard badges) without
// waiting for a real applicant.
//
// Only two Checkr test-mode scenarios are real and known to work here --
// confirmed live 2026-07-06 against the actual Tenant sandbox:
//   'auto'         -- any other applicant data; auto-completes to
//                     "pending" -> "completed" in seconds, generic clear
//                     results, no email sent.
//   'hudson_green' -- the exact documented canned tuple (first_name
//                     Hudson, last_name Green, dob 1996-04-27, ssn
//                     555-55-5555) that instead returns
//                     "waiting_for_applicant" and genuinely emails a
//                     hosted consent link, same as a real order would.
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
type Scenario = 'auto' | 'hudson_green'

const HUDSON_GREEN = { firstName: 'Hudson', lastName: 'Green', dob: '1996-04-27', ssn: '555-55-5555' }
const ASSOCIATION_NAME = 'Venetian Park Condominium I Association, Inc.'

function genericApplicant(i: number) {
  return { firstName: 'Test', lastName: `Applicant${i}`, email: 'PMI@topfloridaproperties.com', dob: '1985-06-15', ssn: '333-33-3333', unitApplying: '101' }
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
  const scenario: Scenario = body.scenario === 'hudson_green' && appType !== 'commercial' ? 'hudson_green' : 'auto'
  const lang = body.lang ?? 'en'
  const customEmail = body.customEmail?.trim() || 'PMI@topfloridaproperties.com'
  // Hudson Green's first/last name is a fixed tuple Checkr recognizes --
  // only the email can be customized for that scenario. For 'auto', the
  // whole name is free to override.
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
    if (scenario === 'hudson_green') return { ...HUDSON_GREEN, email: customEmail, unitApplying: '101' }
    if (customFirst) return { firstName: customFirst, lastName: customLast || customFirst, email: customEmail, dob: '1985-06-15', ssn: '333-33-3333', unitApplying: '101' }
    return { ...genericApplicant(1), email: customEmail }
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
