// POST /api/addon/applications/[id]/send-form   { docKey: 'governing_docs_ack' | 'pet_registration' | 'emergency_contact' }
//
// One-click, from inside Gmail: send one of the three checklist items that
// are FORMS MAIA generates — the exact same code path as the staff request
// panel (lib/application-esign-forms.ts), just reachable without leaving the
// inbox. No new sending logic lives here; this is a thin wrapper so the
// add-on and the admin screen can never send these three documents two
// different ways.
//
// Auth: add-on bearer token. The signed-in staffer's email is recorded as
// who sent it, same attribution the admin screen uses.

import { NextResponse } from 'next/server'
import { addonStaffEmail } from '@/lib/addon-token'
import { sendEsignFormsForItems, isEsignItem, ESIGN_CHECKLIST_ITEMS } from '@/lib/application-esign-forms'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await addonStaffEmail(req)
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let body: { docKey?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const docKey = String(body.docKey ?? '').trim()
  if (!isEsignItem(docKey)) {
    return NextResponse.json({ error: `${docKey || '(none)'} is not a form MAIA sends — only ${Object.keys(ESIGN_CHECKLIST_ITEMS).join(', ')}.` }, { status: 400 })
  }

  const result = await sendEsignFormsForItems(id, [docKey], `staff:${staff}`)
  if (result.failed.length) return NextResponse.json({ ok: false, error: result.failed[0].reason }, { status: 422 })
  return NextResponse.json({ ok: true, sent: result.sent[0] ?? null })
}
