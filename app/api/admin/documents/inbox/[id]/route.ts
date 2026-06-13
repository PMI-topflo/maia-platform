// GET   /api/admin/documents/inbox/[id]/file? (via ?file=1) — preview redirect
// PATCH /api/admin/documents/inbox/[id] — apply (file the doc → write the
// compliance_records item) or dismiss. Staff-only.
// Body (apply):   { action:'apply', association_code, item_key, effective_date?, expiration_date? }
// Body (dismiss): { action:'dismiss' }
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { COMPLIANCE_TAXONOMY } from '@/lib/compliance-taxonomy'

export const dynamic = 'force-dynamic'

const BUCKET = 'association-documents'
const VALID_ITEMS = new Set(COMPLIANCE_TAXONOMY.flatMap(c => c.items.map(i => i.key)))
const dateOrNull = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null

async function requireStaff() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}

// Preview the staged document (the split per-policy file when MAIA split a
// packet) — redirect to a short-lived signed URL. Used by the review card's
// inline preview so staff can SEE the document before filing it.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaff()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: doc } = await supabaseAdmin.from('document_intake').select('storage_path').eq('id', id).maybeSingle()
  if (!doc?.storage_path) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(doc.storage_path as string, 60 * 10)
  if (!signed?.signedUrl) return NextResponse.json({ error: 'could not sign' }, { status: 502 })
  return NextResponse.redirect(signed.signedUrl)
}
const actor = (s: { userId: string | number }) => typeof s.userId === 'string' && s.userId.includes('@') ? s.userId.toLowerCase() : null

/** Status for an on-file item from its expiration: expired → pending
 *  renewal, within 60 days → expiring, else current. No expiry → current. */
function statusFromExpiry(exp: string | null): string {
  if (!exp) return 'current'
  const d = new Date(exp); d.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return 'pending'
  if (days <= 60) return 'expiring'
  return 'current'
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  if (body.action === 'dismiss') {
    const { error } = await supabaseAdmin.from('document_intake').update({ status: 'dismissed' }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action !== 'apply') return NextResponse.json({ error: 'action must be apply or dismiss' }, { status: 400 })

  const assoc   = String(body.association_code ?? '').trim().toUpperCase()
  const itemKey = String(body.item_key ?? '').trim()
  const scope   = body.scope === 'unit' ? 'unit' : 'association'
  const unitRef = scope === 'unit' ? String(body.unit_ref ?? '').trim() : ''
  if (!assoc) return NextResponse.json({ error: 'association_code is required to apply' }, { status: 400 })
  if (!VALID_ITEMS.has(itemKey)) return NextResponse.json({ error: 'a valid compliance item_key is required' }, { status: 400 })
  if (scope === 'unit' && !unitRef) return NextResponse.json({ error: 'pick the owner/unit this document belongs to' }, { status: 400 })

  const { data: doc, error: docErr } = await supabaseAdmin.from('document_intake').select('storage_path, status').eq('id', id).single()
  if (docErr || !doc) return NextResponse.json({ error: 'intake row not found' }, { status: 404 })

  const expiry = dateOrNull(body.expiration_date)
  const newStatus = statusFromExpiry(expiry)
  const { error: upErr } = await supabaseAdmin.from('compliance_records').upsert({
    scope, association_code: assoc, unit_ref: unitRef, item_key: itemKey,
    applicable: true, status: newStatus, expiry_date: expiry,
    source_path: doc.storage_path, updated_by: actor(session),
  }, { onConflict: 'scope,association_code,unit_ref,item_key' })
  if (upErr) return NextResponse.json({ error: `could not write compliance record: ${upErr.message}` }, { status: 500 })

  // Filing a satisfying association doc closes the matching compliance task
  // right away (the daily sync would too). Expired/pending docs leave it open.
  if (scope === 'association' && (newStatus === 'current' || newStatus === 'expiring')) {
    await supabaseAdmin.from('staff_tasks').update({ active: false })
      .eq('source', 'maia').eq('source_ref', `compliance:${assoc}:${itemKey}`)
  }

  const { error } = await supabaseAdmin.from('document_intake').update({
    status: 'applied', applied_association_code: assoc, applied_item_key: itemKey,
    applied_scope: scope, applied_unit_ref: unitRef || null,
    applied_at: new Date().toISOString(), applied_by: actor(session),
  }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
