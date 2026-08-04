// POST /api/admin/pre-apply/[id]/tax-check
// Runs MAIA's tax-return-vs-W-2 check on the application's uploaded tax document
// (the one real validation in the intake). Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { INTAKE_BUCKET } from '@/lib/preapply'
import { classifyTaxDoc } from '@/lib/tax-doc-check'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  // Find the tax document among the uploads (doc_key contains "tax").
  const { data: docs } = await supabaseAdmin.from('application_documents')
    .select('doc_key, doc_label, storage_path, mime_type').eq('application_id', id)
  const tax = (docs ?? []).find(d => /tax/i.test(String(d.doc_key ?? '')) || /tax/i.test(String(d.doc_label ?? '')))
  if (!tax) return NextResponse.json({ error: 'No tax document uploaded on this application.' }, { status: 404 })

  const { data: blob } = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(String(tax.storage_path))
  if (!blob) return NextResponse.json({ error: 'Could not read the tax document.' }, { status: 500 })

  const result = await classifyTaxDoc(Buffer.from(await blob.arrayBuffer()), String(tax.mime_type ?? null))
  const verdict = result.kind === 'tax_return' ? 'ok' : result.kind === 'w2' ? 'w2' : result.kind === 'unknown' ? 'unknown' : 'other'
  return NextResponse.json({ ok: true, docLabel: tax.doc_label ?? tax.doc_key, kind: result.kind, confidence: result.confidence, verdict })
}
