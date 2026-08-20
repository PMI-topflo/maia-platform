// POST /api/admin/pre-apply/[id]/decision-page
//   { decision?, conditions?, leaseStart?, leaseEnd?, occupants?, signers?[] }
// Creates the Board Decision Page. The number of signers follows the
// association's required_signatures (e.g. MANXI needs 2). Signers default to the
// top board officers (President first); any with an on-file signature are signed
// immediately, the rest get a signing link. Staff-only.
// GET → prefill (default signers, full address, applicant, lease term, occupants).
//
// Context-loading + letter-creation are shared with the automatic
// under_review → approval_sent transition (lib/board-decision-letter.ts) — a
// staff-created letter and an auto-created one can never diverge.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { signEsignToken } from '@/lib/esign-token'
import { loadDecisionContext, createBoardDecisionLetter } from '@/lib/board-decision-letter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const c = await loadDecisionContext(id)
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The letter already out for signature (if any), with FRESH signing links — so
  // staff can copy a signer's link any time, not only right after creating it.
  const { data: openDoc } = await supabaseAdmin.from('esign_documents')
    .select('id, status, signers, created_at').eq('kind', 'board_decision')
    .eq('association_code', c.code).eq('unit_ref', String(c.unitLabel ?? ''))
    .neq('status', 'void').order('created_at', { ascending: false }).limit(1).maybeSingle()
  const pending = openDoc ? {
    docId: String(openDoc.id), status: String(openDoc.status), createdAt: openDoc.created_at,
    pdfUrl: `${APP}/api/esign/${await signEsignToken(String(openDoc.id), (openDoc.signers as { role: string }[])[0]?.role ?? 'approver_1')}/pdf`,
    signers: await Promise.all(((openDoc.signers ?? []) as { role: string; name?: string | null; email?: string | null; signed_at?: string }[]).map(async sg => ({
      name: sg.name ?? null, email: sg.email ?? null, signed: !!sg.signed_at,
      link: sg.signed_at ? null : `${APP}/esign/${await signEsignToken(String(openDoc.id), sg.role)}`,
    }))),
  } : null

  return NextResponse.json({
    pending,
    applicationType: c.applicationType, propertyAddress: c.propertyAddress, applicant: c.applicant,
    requiredSignatures: c.required,
    defaultSigners: c.board.slice(0, c.required).map(m => ({ name: m.name, email: m.email, role: m.role, hasSignature: !!m.signature_image })),
    allBoard: c.board.map(m => ({ name: m.name, email: m.email, role: m.role, hasSignature: !!m.signature_image })),
    leaseStart: c.leaseStart, leaseEnd: c.leaseEnd,
    occupants: c.occupants, applicantAsOccupant: c.applicant,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let b: { decision?: string; conditions?: string; leaseStart?: string; leaseEnd?: string; occupants?: string[]; signers?: { name?: string; email?: string }[] }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const c = await loadDecisionContext(id)
  if (!c) return NextResponse.json({ error: 'Application not found' }, { status: 404 })

  // Preview: render the letter PDF from the current form values without creating
  // the e-sign document or emailing anyone. Returns the PDF inline.
  if (new URL(req.url).searchParams.get('preview')) {
    const occ = (b.occupants ?? []).map(o => String(o).trim()).filter(Boolean)
    const payload = {
      associationLegalName: c.legal, propertyAddress: c.propertyAddress, applicant: c.applicant,
      occupants: occ.length ? occ : (c.applicant ? [c.applicant] : []),
      unit: c.unitLabel, applicationType: c.applicationType,
      decision: b.decision?.trim() || 'Approved', conditions: b.conditions?.trim() || null,
      leaseStart: b.leaseStart || c.leaseStart || null, leaseEnd: b.leaseEnd || c.leaseEnd || null,
    }
    const previewSigners = (b.signers && b.signers.length ? b.signers : c.board.slice(0, c.required).map(m => ({ name: m.name as string | null, email: m.email as string | null })))
      .map((x, i) => ({ role: `approver_${i + 1}`, name: x.name?.trim() || null, email: (x.email ?? '').trim(), phone: null as string | null }))
    const doc = { id: 'preview', kind: 'board_decision' as const, association_code: c.code, unit_ref: c.unitLabel as string | null,
      title: 'Board Decision (preview)', payload, signers: previewSigners, status: 'sent' as const, compliance_item: null as string | null, created_at: new Date().toISOString(), application_id: null as string | null }
    const { renderToBuffer } = await import('@react-pdf/renderer')
    const { renderFormPdf } = await import('@/lib/esign-forms')
    const el = renderFormPdf(doc)
    if (!el) return NextResponse.json({ error: 'Could not render the letter.' }, { status: 400 })
    const pdf = await renderToBuffer(el)
    return new Response(pdf as unknown as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="board-approval-letter-preview.pdf"', 'Cache-Control': 'no-store' } })
  }

  const chosen = b.signers && b.signers.length ? b.signers : c.board.slice(0, c.required).map(m => ({ name: m.name as string | null, email: m.email as string | null }))
  const created = await createBoardDecisionLetter(c, {
    decision: b.decision, conditions: b.conditions, leaseStart: b.leaseStart, leaseEnd: b.leaseEnd, occupants: b.occupants,
    signers: chosen, createdBy: `staff:${session.displayName}`,
  })
  if ('error' in created) return NextResponse.json({ error: created.error }, { status: created.error.startsWith('No signer') ? 400 : 500 })

  const result = await Promise.all(created.signers.map(async (sg) => ({
    name: sg.name, email: sg.email, signed: false,
    link: `${APP}/esign/${await signEsignToken(created.docId, sg.role)}`,
  })))
  // A signer already signed (on-file signature) doesn't need a link — mirror
  // that here since createBoardDecisionLetter doesn't expose signed_at itself.
  const { data: doc } = await supabaseAdmin.from('esign_documents').select('signers').eq('id', created.docId).maybeSingle()
  const signedEmails = new Set((((doc?.signers ?? []) as { email?: string; signed_at?: string }[]).filter(sg => sg.signed_at)).map(sg => (sg.email ?? '').toLowerCase()))
  const signersOut = result.map(r => signedEmails.has((r.email ?? '').toLowerCase()) ? { ...r, signed: true, link: null } : r)

  return NextResponse.json({ ok: true, docId: created.docId, allSigned: created.allSigned, pdfUrl: `${APP}/api/esign/${await signEsignToken(created.docId, created.signers[0].role)}/pdf`, signers: signersOut })
}
