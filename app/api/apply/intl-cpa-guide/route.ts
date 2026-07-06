// =====================================================================
// GET /api/apply/intl-cpa-guide?lang=xx
// Public, unauthenticated -- a downloadable PDF an international
// applicant hands to their own accountant, spelling out exactly what the
// CPA Financial Certification must contain, in the applicant's chosen
// /apply language. No applicant data involved, nothing to gate.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { IntlCpaGuidePdf } from '@/lib/intl-cpa-guide-pdf'
import { INTL_DOCS_CONTENT, type IntlDocsLang } from '@/lib/intl-applicant-docs-content'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_LANGS = Object.keys(INTL_DOCS_CONTENT) as IntlDocsLang[]

export async function GET(req: NextRequest) {
  const langParam = req.nextUrl.searchParams.get('lang') ?? 'en'
  const lang: IntlDocsLang = VALID_LANGS.includes(langParam as IntlDocsLang) ? (langParam as IntlDocsLang) : 'en'

  let pdf: Buffer
  try {
    pdf = await renderToBuffer(IntlCpaGuidePdf({ lang }))
  } catch (err) {
    return NextResponse.json(
      { error: `PDF generation failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="PMI CPA Financial Certification Requirements (${lang}).pdf"`,
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
