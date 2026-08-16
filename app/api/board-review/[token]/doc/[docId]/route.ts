// GET /api/board-review/[token]/doc/[docId]
//
// Streams one of the application's documents to the reviewer holding this
// round's link — so the board reads the document in the row before approving
// it, rather than approving a filename.
//
// The token is the capability, and it is scoped: the document must belong to
// THIS round's application. A reviewer cannot walk to another unit's files by
// changing the id.

import { supabaseAdmin } from '@/lib/supabase-admin'
import { INTAKE_BUCKET } from '@/lib/preapply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string; docId: string }> }) {
  const { token, docId } = await ctx.params

  const { data: round } = await supabaseAdmin.from('document_review_rounds')
    .select('application_id').eq('token', token).maybeSingle()
  if (!round) return new Response('This link has expired or is invalid.', { status: 401 })

  const { data: doc } = await supabaseAdmin.from('application_documents')
    .select('application_id, storage_path, filename, mime_type').eq('id', docId).maybeSingle()
  if (!doc || String(doc.application_id) !== String(round.application_id)) {
    return new Response('Not found.', { status: 404 })
  }

  const { data: blob, error } = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(String(doc.storage_path))
  if (error || !blob) return new Response('That file could not be opened.', { status: 404 })

  return new Response(await blob.arrayBuffer(), {
    headers: {
      'Content-Type': (doc.mime_type as string | null) || 'application/octet-stream',
      // inline: it renders inside the review row rather than downloading.
      'Content-Disposition': `inline; filename="${String(doc.filename ?? 'document').replace(/["\\]/g, '')}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
