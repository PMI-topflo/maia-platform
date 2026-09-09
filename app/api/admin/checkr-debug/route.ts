// =====================================================================
// GET /api/admin/checkr-debug?id=<listing_applications.id>
//
// Staff-only, read-only raw Checkr dumps. Built 2026-09-09 to diagnose
// unit 706's "Requested 0/2 orders. 2 failed" — both Checkr /orders calls
// rejected with:
//   422 {"errors":[{"code":"validation_error","detail":"Normalized name
//   has already been taken","source":{"pointer":"/property.normalized_name"}}]}
//
// app/api/trigger-screening/route.ts sends the EXACT SAME property object
// (name: association name, street/unit/city/state/zip) for every subject on
// an application — for a 2-applicant unit that's the same property payload
// POSTed twice. Checkr's own Orders API schema has no confirmed property_id/
// reuse mechanism in this codebase yet (only the inline object we already
// send), so before guessing at a fix: dump what Checkr's account already
// has on file for this unit (GET /properties, if it exists as a listable
// resource) and the raw response shape of any order that DID succeed
// elsewhere, so we can see what a normalized_name actually looks like and
// whether Checkr expects a property reference instead of resending fields.
//
// No terminal/probe-script access needed — just visit this URL while
// logged into /admin. Debug-only; nothing else reads from this route.
// =====================================================================

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const API_BASE = 'https://tenant.checkr.com/api'
function authHeader(): string {
  return `Bearer ${process.env.CHECKR_API_KEY ?? ''}`
}

async function checkrGet(path: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: authHeader() } })
  const json = await res.json().catch(() => ({ parseError: true }))
  return { status: res.status, json }
}

export async function GET(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const id = (url.searchParams.get('id') ?? '').trim()
  if (!id) return NextResponse.json({ error: 'id query param is required — the listing_applications.id from the admin pre-apply URL' }, { status: 400 })

  const { data: listingApp } = await supabaseAdmin.from('listing_applications')
    .select('id, association_code, unit_label, detailed_application_id').eq('id', id).maybeSingle()
  if (!listingApp) return NextResponse.json({ error: 'listing_applications row not found' }, { status: 404 })

  const detailedId = listingApp.detailed_application_id as string | null

  const { data: assocRow } = await supabaseAdmin.from('associations')
    .select('association_name, principal_address, city, state, zip')
    .eq('association_name', String(listingApp.association_code)).maybeSingle()

  const { data: subjects } = await supabaseAdmin.from('screening_subjects')
    .select('subject_index, name, checkr_order_id, status').eq('application_id', detailedId ?? '').order('subject_index')

  const orderDumps: Record<string, unknown>[] = []
  for (const s of subjects ?? []) {
    if (!s.checkr_order_id) continue
    const { status, json } = await checkrGet(`/orders/${s.checkr_order_id}`)
    orderDumps.push({ subject_index: s.subject_index, name: s.name, checkr_order_id: s.checkr_order_id, httpStatus: status, order: json })
  }

  // Best-effort — this endpoint may not exist at all; that's itself useful
  // signal (404/405 vs a real list), not an error worth failing the route over.
  const propertiesList = await checkrGet('/properties').catch(err => ({ status: 0, json: { fetchError: (err as Error).message } }))

  return NextResponse.json({
    ok: true,
    listingApp: { id: listingApp.id, association_code: listingApp.association_code, unit_label: listingApp.unit_label, detailed_application_id: detailedId },
    propertySentByUs: assocRow ? {
      name: assocRow.association_name, street: assocRow.principal_address,
      unit: listingApp.unit_label, city: assocRow.city, state: assocRow.state, zipcode: assocRow.zip,
    } : null,
    subjects: subjects ?? [],
    orderDumps,
    propertiesListEndpoint: propertiesList,
  })
}
