// GET   /api/admin/documents/inbox/[id]/file? (via ?file=1) — preview redirect
// PATCH /api/admin/documents/inbox/[id] — apply (file the doc → write ONE
// compliance_records row per checked item, all pointing at the same
// undivided document — a single upload can satisfy several items at once)
// or dismiss. Staff-only.
// Body (apply):   { action:'apply', association_code, scope, unit_ref?, items: [{item_key, effective_date?, expiration_date?}] }
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

  const assoc = String(body.association_code ?? '').trim().toUpperCase()
  const scope = body.scope === 'unit' ? 'unit' : 'association'
  const unitRef = scope === 'unit' ? String(body.unit_ref ?? '').trim() : ''
  const rawItems = Array.isArray(body.items) ? body.items : []
  if (!assoc) return NextResponse.json({ error: 'association_code is required to apply' }, { status: 400 })
  if (rawItems.length === 0) return NextResponse.json({ error: 'check at least one item this document satisfies' }, { status: 400 })
  if (scope === 'unit' && !unitRef) return NextResponse.json({ error: 'pick the owner/unit this document belongs to' }, { status: 400 })

  const items: { itemKey: string; expiry: string | null }[] = []
  for (const raw of rawItems) {
    const r = raw as Record<string, unknown>
    const itemKey = String(r.item_key ?? '').trim()
    if (!VALID_ITEMS.has(itemKey)) {
      // Not a fixed taxonomy item — check it's an active custom requirement
      // (/admin/association-document-setup) for this association.
      const { data: custom } = await supabaseAdmin.from('association_document_requirements')
        .select('id').eq('association_code', assoc).eq('item_key', itemKey).eq('active', true).maybeSingle()
      if (!custom) return NextResponse.json({ error: `"${itemKey}" is not a valid compliance item` }, { status: 400 })
    }
    items.push({ itemKey, expiry: dateOrNull(r.expiration_date) })
  }

  const { data: doc, error: docErr } = await supabaseAdmin.from('document_intake').select('storage_path, status').eq('id', id).single()
  if (docErr || !doc) return NextResponse.json({ error: 'intake row not found' }, { status: 404 })

  for (const it of items) {
    const newStatus = statusFromExpiry(it.expiry)
    const { error: upErr } = await supabaseAdmin.from('compliance_records').upsert({
      scope, association_code: assoc, unit_ref: unitRef, item_key: it.itemKey,
      applicable: true, status: newStatus, expiry_date: it.expiry,
      source_path: doc.storage_path, updated_by: actor(session),
    }, { onConflict: 'scope,association_code,unit_ref,item_key' })
    if (upErr) return NextResponse.json({ error: `could not write compliance record for ${it.itemKey}: ${upErr.message}` }, { status: 500 })

    // Filing a satisfying association doc closes the matching compliance task
    // right away (the daily sync would too). Expired/pending docs leave it open.
    if (scope === 'association' && (newStatus === 'current' || newStatus === 'expiring')) {
      await supabaseAdmin.from('staff_tasks').update({ active: false })
        .eq('source', 'maia').eq('source_ref', `compliance:${assoc}:${it.itemKey}`)
    }
  }

  const { error } = await supabaseAdmin.from('document_intake').update({
    status: 'applied', applied_association_code: assoc, applied_item_key: items[0]?.itemKey ?? null,
    applied_scope: scope, applied_unit_ref: unitRef || null, applied_items: rawItems,
    applied_at: new Date().toISOString(), applied_by: actor(session),
  }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
