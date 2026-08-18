// POST /api/addon/applications/[id]/draft-reply   { senderEmail, senderName? }
//
// The standard reply: thank them, send them to the self-serve upload link,
// list what's still outstanding. Same shape every time — see
// lib/application-standard-reply.ts for why that's the point.
//
// Returns a DRAFT. Nothing is emailed by this endpoint itself — the add-on
// inserts the text into Gmail's own reply compose box (onComposeInsertDraft,
// the same mechanism the ticket add-on already uses) and a human sends it.
// The one exception is the three form-backed items (Rules Ack / Pet
// Registration / Emergency Contact): those go out immediately, same as the
// v1 one-click Send buttons — that was never the "let a human review it"
// concern, only the upload redirect was.
//
// Auth: add-on bearer token.

import { NextResponse } from 'next/server'
import { addonStaffEmail } from '@/lib/addon-token'
import { draftStandardReply } from '@/lib/application-standard-reply'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await addonStaffEmail(req)
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let body: { senderEmail?: string; senderName?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const senderEmail = String(body.senderEmail ?? '').trim().toLowerCase()
  if (!senderEmail.includes('@')) return NextResponse.json({ error: 'senderEmail is required' }, { status: 400 })

  const result = await draftStandardReply({
    applicationId: id, senderEmail, senderName: (body.senderName ?? '').trim() || null,
    createdBy: `staff:${staff}`,
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 404 })
  return NextResponse.json(result)
}
