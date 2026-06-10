// =====================================================================
// app/api/admin/invoices/intake/reprocess/route.ts
//
// POST — manually (re)run invoice intake for a single Gmail message.
// Debug / recovery tool for the "bulk PDF email created no (or only
// partial) drafts" class of problem.
//
//   body: { messageId: string, force?: boolean }
//
// Default (force=false): incremental — re-runs handleInvoiceIntake,
// which only creates drafts for attachments that don't already have one
// (the per-attachment dedupe key). Safe to run repeatedly; fills gaps
// left by a partial first pass.
//
// force=true: first deletes this message's existing drafts that are NOT
// yet pushed to CINC (pending_review / needs_vendor / duplicate_in_cinc /
// on_hold / ready_to_push / rejected), then re-extracts every attachment
// from scratch. Pushed drafts are never touched.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { fetchGmailMessage, fetchGmailAttachmentData } from '@/lib/gmail'
import { parseGmailMessage } from '@/lib/maia-command-processor'
import { handleInvoiceIntake } from '@/lib/invoice-intake'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { messageId?: string; force?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const messageId = (body.messageId ?? '').trim()
  if (!messageId) {
    return NextResponse.json({ error: 'messageId is required (the Gmail message id)' }, { status: 400 })
  }

  // FETCH FIRST — never delete before we've successfully pulled the message
  // from Gmail. (2026-06-09 incident: a force-reprocess deleted the drafts,
  // then the Gmail fetch failed on bad creds, dropping them with no
  // replacement. Validating the fetch up front makes that impossible.)
  let parsed: ReturnType<typeof parseGmailMessage>
  try {
    const msg = await fetchGmailMessage(messageId)
    parsed    = parseGmailMessage(msg)
  } catch (err) {
    return NextResponse.json(
      { error: `Gmail fetch failed — nothing was deleted: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    )
  }

  // force: only NOW (fetch succeeded) clear this message's not-yet-pushed
  // drafts so the whole email re-extracts. Never delete pushed drafts.
  let deleted = 0
  if (body.force) {
    const { data: del, error: delErr } = await supabaseAdmin
      .from('invoice_intake_drafts')
      .delete()
      .eq('gmail_message_id', messageId)
      .neq('status', 'pushed_to_cinc')
      .select('id')
    if (delErr) return NextResponse.json({ error: `delete failed: ${delErr.message}` }, { status: 500 })
    deleted = del?.length ?? 0
  }

  let result: Awaited<ReturnType<typeof handleInvoiceIntake>>
  try {
    result = await handleInvoiceIntake(
      parsed,
      (attId) => fetchGmailAttachmentData(messageId, attId),
    )
  } catch (err) {
    return NextResponse.json(
      { error: `reprocess failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, messageId, deleted, ...result })
}
