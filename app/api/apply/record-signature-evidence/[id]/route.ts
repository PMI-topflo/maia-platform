// =====================================================================
// /api/apply/record-signature-evidence/[id]
//
// Called by the apply form immediately after the application row is
// inserted. Updates the row with the signature evidence the browser
// can't write directly (server-captured IP, user agent) plus the
// browser-captured drawn signature, photo, and geolocation.
//
// Why a follow-up POST rather than putting this into the original
// insert: the current submit flow writes the application row from the
// browser via the anon supabase client. The browser can't read its
// own request IP. Splitting evidence into a separate, IP-aware
// server endpoint keeps the rest of the flow unchanged.
//
// Public — no session required. The applicant submitted the row
// seconds ago and has its UUID. We only ALLOW UPDATES TO THE SIGNATURE
// EVIDENCE COLUMNS, never the financial or status fields, so an
// attacker guessing an application UUID can't tamper with anything
// meaningful.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  rules_signature_image?:    string | null
  rules_applicant_photo?:    string | null
  rules_signed_geolocation?: { lat: number; lon: number; accuracy_meters: number; timestamp_ms: number } | null
}

// Hard cap on the inline-encoded images we'll accept. PNG dataURLs
// for a 400x150 signature run ~10 KB; a 320x240 JPEG photo runs
// ~30-100 KB. 500 KB per image is generous and stops abuse.
const MAX_IMAGE_BYTES = 500 * 1024

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim() ?? null
  return req.headers.get('x-real-ip') ?? null
}

function tooBig(dataUrl: string | null | undefined): boolean {
  return !!dataUrl && dataUrl.length > MAX_IMAGE_BYTES
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  let body: Body
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  if (tooBig(body.rules_signature_image) || tooBig(body.rules_applicant_photo)) {
    return NextResponse.json({ error: 'Image data too large' }, { status: 413 })
  }

  // Geo shape guard — if the field is present it must be the documented
  // shape, otherwise we drop it. Don't fail the request because of
  // garbled geo; the signature itself is more important.
  let geo: Body['rules_signed_geolocation'] = null
  const g = body.rules_signed_geolocation
  if (g && typeof g.lat === 'number' && typeof g.lon === 'number') {
    geo = {
      lat:               g.lat,
      lon:               g.lon,
      accuracy_meters:   typeof g.accuracy_meters === 'number' ? g.accuracy_meters : 0,
      timestamp_ms:      typeof g.timestamp_ms === 'number' ? g.timestamp_ms : Date.now(),
    }
  }

  const patch: Record<string, string | object | null> = {
    rules_signed_ip:          clientIp(req),
    rules_signed_user_agent:  req.headers.get('user-agent'),
  }
  if (body.rules_signature_image !== undefined) patch.rules_signature_image = body.rules_signature_image ?? null
  if (body.rules_applicant_photo !== undefined) patch.rules_applicant_photo = body.rules_applicant_photo ?? null
  if (geo) patch.rules_signed_geolocation = geo

  const { error } = await supabaseAdmin
    .from('applications')
    .update(patch)
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
