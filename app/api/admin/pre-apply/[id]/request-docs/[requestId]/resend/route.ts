// POST /api/admin/pre-apply/[id]/request-docs/[requestId]/resend   { only?: 'owner' | 'tenant' }
//
// Re-send an existing document request. The email is REBUILT from the current
// checklist, so a request that went out before an example was attached picks
// the example up on the resend — staff attach the example once and press
// resend, rather than composing a fresh request and confusing the recipient
// with a second, different-looking ask.
//
// The upload tokens are unchanged, so any link the recipient already has keeps
// working and everything still files onto the same request. Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { sendDocumentRequestEmails } from '@/lib/document-request-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string; requestId: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, requestId } = await ctx.params

  // The request must belong to THIS application — the id is in the path, so
  // check it rather than trusting it.
  const { data: reqRow } = await supabaseAdmin.from('document_requests')
    .select('id, application_id, owner_email, tenant_email').eq('id', requestId).maybeSingle()
  if (!reqRow || String(reqRow.application_id) !== id) {
    return NextResponse.json({ error: 'That request does not belong to this application.' }, { status: 404 })
  }

  let b: { only?: unknown } = {}
  try { b = await req.json() } catch { /* body is optional */ }
  const only = b.only === 'owner' || b.only === 'tenant' ? b.only : undefined

  const { sentOwner, sentTenant } = await sendDocumentRequestEmails(requestId, only ? { only } : undefined)
  if (!sentOwner && !sentTenant) {
    return NextResponse.json({
      error: 'Nothing was re-sent — the request has no recipient address on file for that side.',
    }, { status: 400 })
  }

  await supabaseAdmin.from('document_requests')
    .update({ last_sent_at: new Date().toISOString(), last_sent_by: `staff:${session.displayName}` })
    .eq('id', requestId)
    // The columns are optional; a resend must not fail because the audit
    // stamp could not be written.
    .then(() => null, () => null)

  return NextResponse.json({ ok: true, sentOwner, sentTenant })
}
