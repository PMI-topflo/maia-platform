// =====================================================================
// GET /api/apply/application-guide/[assoc]
// Public, unauthenticated — a downloadable PDF spelling out an
// association's eligibility rules, application process, and document
// checklist BEFORE anyone starts an application. Data is built live from
// association_application_rules / association_intake_documents (see
// lib/application-guide-data.ts), so it can never show a rule or checklist
// item that's been changed since the last associate's guide content module
// was written.
//
// 404 (JSON, not a broken PDF) for any association with no guide content
// module registered yet — see GUIDE_CONTENT in application-guide-data.ts.
// =====================================================================

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { buildApplicationGuideData } from '@/lib/application-guide-data'
import { ApplicationGuidePdf } from '@/lib/application-guide-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ assoc: string }> }) {
  const { assoc } = await ctx.params
  const data = await buildApplicationGuideData(assoc)
  if (!data) {
    return NextResponse.json({ error: `An Application Guide isn't available for ${assoc.toUpperCase()} yet.` }, { status: 404 })
  }

  let pdf: Buffer
  try {
    pdf = await renderToBuffer(ApplicationGuidePdf({ data }))
  } catch (err) {
    return NextResponse.json({ error: `PDF generation failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${data.associationCode} Application Guide.pdf"`,
      // Short cache — the whole point is this stays in sync with live rules
      // and checklist rows, unlike the intl-cpa-guide's static content.
      'Cache-Control': 'public, max-age=1800',
    },
  })
}
