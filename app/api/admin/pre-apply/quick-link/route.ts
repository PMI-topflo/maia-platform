// POST /api/admin/pre-apply/quick-link   { associationCode, unit }
//
// Staff says an association + unit in the MAIA widget chat; the widget shows
// a "Create a link" button instead of routing that message through the AI
// chat loop. This is what the button calls. User direction, 2026-08-21:
// "when I say the name of the association and number in the widget, a
// button - create a link. - I will copy and paste in the email response."
//
// Reuses draftStandardReply() (lib/application-standard-reply.ts) — the SAME
// function the Gmail add-on's "Draft: ask them to upload" button already
// calls — rather than a third implementation of "what's missing + make a
// link". Nothing is emailed here: forms (Rules Ack etc.) still send
// immediately, same as every other caller of that function, but the upload
// link itself is only ever returned as text for staff to paste themselves.
//
// Auth: staff session (cookie), not the add-on bearer token — this is the
// in-app widget, not Gmail.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { draftStandardReply } from '@/lib/application-standard-reply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let b: { associationCode?: string; unit?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const code = String(b.associationCode ?? '').trim().toUpperCase()
  const unit = String(b.unit ?? '').trim()
  if (!code || !unit) return NextResponse.json({ error: 'associationCode and unit are required' }, { status: 400 })

  // Most recent OPEN application on this unit — "ask again" only makes sense
  // for one that's still in flight. Decided ones are deliberately excluded:
  // there's nothing left to request from an approved or declined applicant.
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, unit_label')
    .eq('association_code', code).eq('unit_label', unit)
    .in('status', ['started', 'submitted', 'under_review', 'approval_sent'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!app) return NextResponse.json({ error: `No open application found for ${code} Unit ${unit}.` }, { status: 404 })

  const { data: primary } = await supabaseAdmin.from('application_stakeholders')
    .select('name, email').eq('application_id', app.id).eq('role', 'applicant').eq('is_primary', true).maybeSingle()
  const email = (primary?.email as string | null)?.trim().toLowerCase() ?? ''
  if (!email.includes('@')) return NextResponse.json({ error: `No applicant email on file for ${code} Unit ${unit} — add one first.` }, { status: 400 })

  const result = await draftStandardReply({
    applicationId: String(app.id), senderEmail: email, senderName: (primary?.name as string | null) ?? null,
    createdBy: `staff:${session.displayName}`,
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ ok: true, associationCode: code, unit, ...result })
}
