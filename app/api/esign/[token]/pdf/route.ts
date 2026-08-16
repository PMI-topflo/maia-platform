// GET /api/esign/[token]/pdf
// The document PDF for the shared e-sign engine, reached from the signer's
// link. Blank signature blocks before signing; captured signatures + the
// verification certificate after. Read-only.

import { renderToBuffer } from '@react-pdf/renderer'
import { verifyEsignToken } from '@/lib/esign-token'
import { getEsignDoc } from '@/lib/esign'
import { renderFormPdf } from '@/lib/esign-forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyEsignToken(token)
  if (!t) return new Response('This link has expired or is invalid.', { status: 401 })
  const doc = await getEsignDoc(t.docId)
  if (!doc) return new Response('Not found.', { status: 404 })
  // No ?blank=1 printable copy: every form here is completed online, and the
  // animal questionnaire BRANCHES — a printed blank shows the pet questions
  // only, so anyone who filled one in would never reach the service-animal or
  // assistance-animal path.
  const el = renderFormPdf(doc)
  if (!el) return new Response('This form type is not available.', { status: 400 })

  // The acknowledgment is ASSEMBLED, not just rendered: the association's own
  // Rules pages sit between the cover and the signatures. Serving the bare
  // wrapper here would show a signer a document whose rules are missing.
  if (doc.kind === 'rules_knowledge_ack') {
    const { assembleRulesAckPdf } = await import('@/lib/rules-ack-content')
    const full = await assembleRulesAckPdf(doc)
    return new Response(full as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="rules-acknowledgment-${doc.id.slice(0, 8)}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const pdf = await renderToBuffer(el)
  return new Response(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${doc.kind}-${doc.id.slice(0, 8)}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
