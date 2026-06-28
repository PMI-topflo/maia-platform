// =====================================================================
// GET /api/portal/documents/public?assoc=CODE
//
// PUBLIC (no login) association documents — only the documents a staff
// member has explicitly marked is_public. Board request: let the general
// public read public documents without identifying. Returns short-lived
// signed download URLs, same as the gated portal endpoint, but scoped to
// is_public = true so nothing private is ever exposed.
// =====================================================================

import { NextResponse } from 'next/server'
import { getPortalDocuments } from '@/lib/portal-documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const assoc = (new URL(req.url).searchParams.get('assoc') ?? '').trim().toUpperCase()
  if (!assoc) return NextResponse.json({ error: 'assoc is required' }, { status: 400 })

  const groups = await getPortalDocuments(assoc, { publicOnly: true })
  return NextResponse.json({ groups })
}
