// =====================================================================
// GET /api/applications/[id]/rules-acknowledgment-pdf?token=XXX
// GET /api/applications/[id]/rules-acknowledgment-pdf            (staff)
//
// Renders the applicant's signed Rules & Regulations acknowledgment as a
// real PDF -- which governing documents they reviewed, their signature
// (drawn image if captured, else typed name), and the audit trail
// (IP/geolocation/photo) captured at signing.
//
// Two ways in, matching the existing /api/board/review dual-auth
// pattern: a real per-member board token (?token=, validated against
// application_board_reviews and must match this application), or a
// staff session cookie (no token -- the admin dashboard link).
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { renderToBuffer } from '@react-pdf/renderer'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { RulesAcknowledgmentPdf, type AckDocEntry } from '@/lib/rules-acknowledgment-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DOC_CATEGORY_LABELS: Record<string, string> = {
  condo_docs: 'Condo Docs / Declaration',
  rules_regs: 'Rules & Regulations',
}

interface Applicant { firstName?: string; lastName?: string; [k: string]: unknown }

function applicantNames(app: Record<string, unknown>): string[] {
  if (app.app_type === 'commercial') {
    if (app.entity_name) return [app.entity_name as string]
    const principals = (app.principals as { name?: string }[] | null) ?? []
    return principals.map(p => p.name).filter((n): n is string => !!n)
  }
  const applicants = (app.applicants as Applicant[] | null) ?? []
  return applicants
    .map(a => [a.firstName, a.lastName].filter(Boolean).join(' '))
    .filter(Boolean)
}

function unitOf(app: Record<string, unknown>): string | null {
  const applicants = (app.applicants as Record<string, unknown>[] | null) ?? []
  const principals = (app.principals as Record<string, unknown>[] | null) ?? []
  const first = applicants[0] ?? principals[0]
  return (first?.unitApplying as string) ?? (first?.unit as string) ?? null
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const token = req.nextUrl.searchParams.get('token')

  if (token) {
    const { data: review } = await supabaseAdmin
      .from('application_board_reviews')
      .select('application_id')
      .eq('token', token)
      .maybeSingle()
    if (!review || review.application_id !== id) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }
  } else {
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get(SESSION_COOKIE)?.value
    const session = sessionToken ? await verifySession(sessionToken) : null
    if (!session || session.persona !== 'staff') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const { data: app, error } = await supabaseAdmin.from('applications').select('*').eq('id', id).maybeSingle()
  if (error || !app) return NextResponse.json({ error: 'Application not found' }, { status: 404 })

  const ackIds = (app.acknowledged_document_ids as string[] | null) ?? []
  let ackDocs: AckDocEntry[] = []
  if (ackIds.length > 0) {
    const { data: docs } = await supabaseAdmin
      .from('association_documents')
      .select('category, filename, effective_date')
      .in('id', ackIds)
    ackDocs = (docs ?? []).map(d => ({
      category: d.category as string,
      categoryLabel: DOC_CATEGORY_LABELS[d.category as string] ?? (d.category as string),
      filename: d.filename as string | null,
      effectiveDate: d.effective_date as string | null,
    }))
  }

  const refId = `PMI-${(id as string).slice(0, 8).toUpperCase()}`

  let pdf: Buffer
  try {
    pdf = await renderToBuffer(
      RulesAcknowledgmentPdf({
        refId,
        association: (app.association as string) ?? '—',
        applicantNames: applicantNames(app),
        unit: unitOf(app),
        ackDocs,
        signatureTyped: (app.rules_signature as string | null) ?? null,
        signatureImageDataUrl: (app.rules_signature_image as string | null) ?? null,
        applicantPhotoDataUrl: (app.rules_applicant_photo as string | null) ?? null,
        agreedAt: (app.rules_agreed_at as string | null) ?? null,
        geolocation: (app.rules_signed_geolocation as { lat: number; lon: number; accuracy_meters: number } | null) ?? null,
        ip: (app.rules_signed_ip as string | null) ?? null,
      }),
    )
  } catch (err) {
    return NextResponse.json({ error: `PDF generation failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Rules Acknowledgment - ${refId}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
