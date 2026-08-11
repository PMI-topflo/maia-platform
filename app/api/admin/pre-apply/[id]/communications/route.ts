// GET /api/admin/pre-apply/[id]/communications
// The document-request communication history for an application: each request
// sent, to whom, what was asked, and any message the owner/tenant sent back.
// Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Item { doc_key: string; label: string; recipient: 'owner' | 'tenant' | 'both' }

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data } = await supabaseAdmin.from('document_requests')
    .select('id, created_at, created_by, owner_email, tenant_email, items, message, owner_note, tenant_note')
    .eq('application_id', id).order('created_at', { ascending: false })

  return NextResponse.json({
    communications: (data ?? []).map(r => {
      const items = (Array.isArray(r.items) ? r.items : []) as Item[]
      return {
        id: String(r.id), at: r.created_at, by: (r.created_by as string | null) ?? null,
        ownerEmail: (r.owner_email as string | null) ?? null, tenantEmail: (r.tenant_email as string | null) ?? null,
        ownerItems: items.filter(i => i.recipient === 'owner' || i.recipient === 'both').map(i => i.label),
        tenantItems: items.filter(i => i.recipient === 'tenant' || i.recipient === 'both').map(i => i.label),
        message: (r.message as string | null) ?? null,
        ownerNote: (r.owner_note as string | null) ?? null, tenantNote: (r.tenant_note as string | null) ?? null,
      }
    }),
  })
}
