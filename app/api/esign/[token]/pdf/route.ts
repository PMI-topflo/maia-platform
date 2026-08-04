// GET /api/esign/[token]/pdf
// The document PDF for the shared e-sign engine, reached from the signer's
// link. Blank signature blocks before signing; captured signatures + the
// verification certificate after. Read-only.

import { renderToBuffer } from '@react-pdf/renderer'
import { verifyEsignToken } from '@/lib/esign-token'
import { getEsignDoc } from '@/lib/esign'
import { renderFormPdf, renderFormBlank } from '@/lib/esign-forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyEsignToken(token)
  if (!t) return new Response('This link has expired or is invalid.', { status: 401 })
  const doc = await getEsignDoc(t.docId)
  if (!doc) return new Response('Not found.', { status: 404 })
  // ?blank=1 → a printable empty copy of a fillable form.
  const blank = new URL(req.url).searchParams.get('blank') === '1'
  const el = blank ? (renderFormBlank(doc) ?? renderFormPdf(doc)) : renderFormPdf(doc)
  if (!el) return new Response('This form type is not available.', { status: 400 })

  const pdf = await renderToBuffer(el)
  return new Response(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${doc.kind}-${doc.id.slice(0, 8)}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
