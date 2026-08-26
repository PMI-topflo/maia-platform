// POST /api/admin/pre-apply/create
//   { associationCode, unit, applicationType, applicants?: [{name,email,phone}], note? }
//
// Staff open an application themselves, with its Drive folder, instead of only
// being able to generate a link and wait.
//
// This is the case the link flow never covered: documents that arrive BY EMAIL.
// Until now the only way to file them was to send the applicant a link and hope
// they used it, or to hold the attachments in a mailbox — so an application
// that existed in real life had nowhere to live in MAIA.
//
// The applicant is NOT emailed. Staff are recording something that already
// happened; the invite link is a separate, deliberate step.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { createIntake } from '@/lib/preapply'
import { isApplicationType, type ApplicationType } from '@/lib/intake-documents'
import { ensureOngoingUnitFolder } from '@/lib/drive-application-mirror'
import { normalizePhone } from '@/lib/cinc-sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface InPerson { name?: unknown; email?: unknown; phone?: unknown; isMinor?: unknown }

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let b: { associationCode?: unknown; unit?: unknown; applicationType?: unknown; applicants?: unknown; note?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const code = String(b.associationCode ?? '').trim().toUpperCase()
  const unit = String(b.unit ?? '').trim()
  const type = String(b.applicationType ?? '').trim()
  if (!code) return NextResponse.json({ error: 'Pick an association.' }, { status: 400 })
  if (!unit) return NextResponse.json({ error: 'Enter the unit.' }, { status: 400 })
  if (!isApplicationType(type)) return NextResponse.json({ error: 'Pick what the application is for.' }, { status: 400 })

  const { data: assoc } = await supabaseAdmin.from('associations')
    .select('association_code, ongoing_folder_id').eq('association_code', code).maybeSingle()
  if (!assoc) return NextResponse.json({ error: `${code} is not an association in MAIA.` }, { status: 400 })

  const people = (Array.isArray(b.applicants) ? b.applicants as InPerson[] : [])
    .map(p => ({
      name: String(p.name ?? '').trim(),
      email: (() => { const e = String(p.email ?? '').trim(); return e.includes('@') ? e : null })(),
      phone: (() => { const v = String(p.phone ?? '').trim(); return v ? (normalizePhone(v) ?? v) : null })(),
      isMinor: p.isMinor === true,
    }))
    .filter(p => p.name)

  // An application with nobody on it is the hole unit 1003 fell into — the
  // list had no name to show and no one to write to. A name is the minimum.
  if (people.length === 0) {
    return NextResponse.json({ error: 'Add at least one applicant — an application with no name cannot be chased or approved.' }, { status: 400 })
  }

  // A 'started' application must be chaseable from the moment it exists — user
  // direction, 2026-08-20: "started cannot exist until applicant places his
  // phone and email." Staff-created applications used to allow both blank,
  // which is exactly what let MANXI 605 sit untouched for six hours with no
  // way to reach anyone on it.
  //
  // Real case, 2026-08-20 (MANXI 110): a lease renewal forwarded by the
  // OWNER, tenant's own contact info not in the email at all. Two lifelines
  // before this is genuinely unreachable: (1) for lease/lease_renewal, the
  // signed lease about to be uploaded very likely has the tenant's own
  // email/phone printed on it — extracted right after upload (see
  // backfillPrimaryContactFromLease in the upload route), or (2) the unit's
  // owner is on file and can be looped in to complete it (loopInOwnerForMissingContact,
  // same fallback). Only block outright when NEITHER applies.
  if (!people[0].email || !people[0].phone) {
    const extractable = type === 'lease' || type === 'lease_renewal'
    let hasOwner = false
    if (!extractable) {
      const { data: ownerRows } = await supabaseAdmin.from('owners')
        .select('emails, status').eq('association_code', code).or(`unit_number.eq.${unit},account_number.eq.${code}${unit}`)
      hasOwner = (ownerRows ?? []).some(o => (o.status ?? null) !== 'previous' && String(o.emails ?? '').split(',').some(e => e.trim().includes('@')))
    }
    if (!extractable && !hasOwner) {
      if (!people[0].email) return NextResponse.json({ error: "Enter the lead applicant's email." }, { status: 400 })
      if (!people[0].phone) return NextResponse.json({ error: "Enter the lead applicant's phone." }, { status: 400 })
    }
  }

  // Don't quietly open a second application on a unit that already has one in
  // flight; staff almost always mean the existing one.
  const { data: existing } = await supabaseAdmin.from('listing_applications')
    .select('id, application_type, status').eq('association_code', code).eq('unit_label', unit)
    .not('status', 'in', '("approved","declined","withdrawn")')
  if ((existing ?? []).length > 0 && !(b as { force?: boolean }).force) {
    const e = (existing ?? [])[0]
    return NextResponse.json({
      error: `Unit ${unit} already has an application in progress (${e.application_type}, ${e.status}). Open that one, or confirm to start another.`,
      existingId: String(e.id), needsConfirm: true,
    }, { status: 409 })
  }

  const created = await createIntake({
    associationCode: code, type: type as ApplicationType, role: 'applicant', unitLabel: unit,
    applicant: { name: people[0].name, email: people[0].email ?? '', phone: people[0].phone },
  })
  if ('error' in created) return NextResponse.json({ error: created.error }, { status: 500 })

  // createIntake leaves applicant_role null, which shows as a blank role on the
  // per-applicant tabs. Set it from what the application actually is.
  //
  // 'minor_dependent' (staff-flagged via the "Minor" checkbox, additional-
  // occupant only) is checked BEFORE the type defaults below — a minor is
  // never adult_occupant regardless of type — so lib/board-review.ts's
  // deriveReviewState() (which already excludes minor_dependent from
  // per-applicant document gating) correctly skips the background-check
  // requirement for them. There is no DOB/age field anywhere in this intake;
  // this checkbox is the only signal.
  const roleFor = (isMinor: boolean, position: 'lead' | 'other') => isMinor ? 'minor_dependent'
    : type === 'additional_occupant' ? 'adult_occupant'
    : type === 'purchase' ? (position === 'lead' ? 'primary_applicant' : 'co_applicant') : 'tenant'
  const leadRole = roleFor(people[0].isMinor, 'lead')
  await supabaseAdmin.from('application_stakeholders')
    .update({ applicant_role: leadRole }).eq('id', created.stakeholderId)

  // Everyone else on the roster. Staff-added, so no invite is implied.
  if (people.length > 1) {
    await supabaseAdmin.from('application_stakeholders').insert(people.slice(1).map(p => ({
      application_id: created.applicationId, role: 'applicant', name: p.name, email: p.email, phone: p.phone,
      is_primary: false, status: 'active', added_by_role: 'staff',
      applicant_role: roleFor(p.isMinor, 'other'),
    })))
  }

  await supabaseAdmin.from('listing_applications').update({
    created_by_role: 'staff',
    review_note: `[${new Date().toISOString().slice(0, 10)}] Opened by ${session.displayName}${String(b.note ?? '').trim() ? ` — ${String(b.note).trim()}` : ''}`,
  }).eq('id', created.applicationId)

  // NOT carried over as copies. An additional occupant's application SHOWS the
  // approved lease, certificate of use and tenant of record (the "Current
  // lease on this unit" panel) and links through to the approved application's
  // own files. Copying produced two PDFs that drift apart, a duplicate in
  // Drive, and a carried expiry that then read as THIS application's expired
  // document.

  // The folder is the point of this route — somewhere to put the email
  // attachments. Drive is prod-only, so a failure here reports itself instead
  // of losing the application that was just created.
  let folderUrl: string | null = null
  let folderError: string | null = null
  try {
    const f = await ensureOngoingUnitFolder({
      unitLabel: unit, applicantName: people[0].name, associationCode: code,
    })
    folderUrl = f.webViewLink
    await supabaseAdmin.from('listing_applications')
      .update({ drive_folder_url: f.webViewLink, drive_folder_id: f.folderId })
      .eq('id', created.applicationId)
      .then(r => r, () => null)
  } catch (e) {
    folderError = e instanceof Error ? e.message : 'Could not create the Drive folder'
  }

  return NextResponse.json({
    ok: true, applicationId: created.applicationId, folderUrl, folderError,
    applicants: people.length,
  })
}
