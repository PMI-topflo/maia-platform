// =====================================================================
// GET /api/admin/cinc/document/[imageId]
// Streams a CINC document (invoice scan / attachment) by ImageID so the
// invoice-detail page can preview it inline. Staff-only.
// =====================================================================

import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getCincDocument } from '@/lib/integrations/cinc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ imageId: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return new Response('Unauthorized', { status: 401 })

  const { imageId } = await ctx.params
  const id = parseInt(imageId, 10)
  if (!Number.isFinite(id)) return new Response('bad id', { status: 400 })

  const doc = await getCincDocument(id).catch(() => null)
  if (!doc) return new Response('Document not found in CINC', { status: 404 })

  return new Response(new Uint8Array(doc.bytes), {
    headers: {
      'Content-Type': doc.contentType,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=300',
    },
  })
}
