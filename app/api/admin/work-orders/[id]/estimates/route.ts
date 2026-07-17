// GET /api/admin/work-orders/[id]/estimates
// The latest estimate request on a work order + each vendor's status and
// (for submitted) amount + a signed link to their estimate PDF. Powers the
// side-by-side comparison. Staff-only.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const ticketId = parseInt(id, 10)
  if (!Number.isFinite(ticketId)) return NextResponse.json({ error: 'bad id' }, { status: 400 })

  const { data: reqRow } = await supabaseAdmin.from('estimate_requests')
    .select('id, scope, status, created_at, association_code').eq('ticket_id', ticketId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!reqRow) return NextResponse.json({ request: null, vendors: [] })

  // Committee members for the signer picker are fetched independently by
  // the shared BoardMemberPicker component (purpose='estimate').

  const { data: vrows } = await supabaseAdmin.from('estimate_request_vendors')
    .select('id, vendor_name, status, respond_by, submitted_at, extracted_amount, estimate_summary, estimate_path')
    .eq('request_id', reqRow.id).order('extracted_amount', { ascending: true, nullsFirst: false })

  // Resolve estimate PDFs (estimate_path = work_order_attachments id) → signed URL.
  const attIds = (vrows ?? []).map(v => v.estimate_path).filter((p): p is string => !!p)
  const urlByAtt = new Map<string, string>()
  if (attIds.length) {
    const { data: atts } = await supabaseAdmin.from('work_order_attachments').select('id, storage_path').in('id', attIds)
    const paths = (atts ?? []).map(a => a.storage_path).filter(Boolean) as string[]
    if (paths.length) {
      const { data: signed } = await supabaseAdmin.storage.from('work-order-photos').createSignedUrls(paths, 3600)
      const byPath = new Map<string, string>((signed ?? []).map((s, i) => [paths[i], s.signedUrl]))
      for (const a of atts ?? []) if (a.storage_path && byPath.get(a.storage_path)) urlByAtt.set(a.id, byPath.get(a.storage_path)!)
    }
  }

  const vendors = (vrows ?? []).map(v => ({
    id: v.id, vendor_name: v.vendor_name, status: v.status, respond_by: v.respond_by, submitted_at: v.submitted_at,
    amount: v.extracted_amount != null ? Number(v.extracted_amount) : null, summary: v.estimate_summary,
    estimate_url: v.estimate_path ? urlByAtt.get(v.estimate_path) ?? null : null,
  }))

  // Latest board approval (if any) for this work order.
  const { data: appr } = await supabaseAdmin.from('estimate_approvals')
    .select('id, vendor_name, amount, status, required, created_at').eq('ticket_id', ticketId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  let approval = null as null | { vendor_name: string | null; amount: number | null; status: string; required: number; approvals: number }
  if (appr) {
    const { count } = await supabaseAdmin.from('estimate_approval_reviews').select('id', { count: 'exact', head: true }).eq('approval_id', appr.id).eq('decision', 'approve').eq('member_type', 'decider')
    approval = { vendor_name: appr.vendor_name, amount: appr.amount != null ? Number(appr.amount) : null, status: appr.status, required: appr.required, approvals: count ?? 0 }
  }

  return NextResponse.json({ request: { id: reqRow.id, scope: reqRow.scope, status: reqRow.status, association_code: reqRow.association_code }, vendors, approval })
}
