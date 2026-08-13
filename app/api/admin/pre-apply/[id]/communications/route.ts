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
  const { data: app } = await supabaseAdmin.from('listing_applications').select('association_code, unit_label').eq('id', id).maybeSingle()

  const [{ data: reqs }, { data: letters }, { data: filed }] = await Promise.all([
    supabaseAdmin.from('document_requests')
      .select('id, created_at, created_by, owner_email, tenant_email, items, message, owner_note, tenant_note')
      .eq('application_id', id),
    // Approval letter shows in the timeline ONLY once the board has signed it.
    app ? supabaseAdmin.from('esign_documents')
      .select('id, updated_at, created_at, signers, title, payload')
      .eq('kind', 'board_decision').eq('association_code', String(app.association_code)).eq('unit_ref', String(app.unit_label ?? ''))
      .eq('status', 'completed')
      : Promise.resolve({ data: [] as unknown[] }),
    // Correspondence staff filed by forwarding it to maia@ ("@maia upapp …").
    // The table is new, so tolerate its absence rather than 500 the whole
    // timeline on an environment where the migration hasn't been applied.
    supabaseAdmin.from('application_communications')
      .select('id, occurred_at, created_at, subject, body, from_email, from_name, to_emails, cc_emails, attachment_names, direction, logged_by')
      .eq('application_id', id)
      .then(r => r, () => ({ data: [] as unknown[] })),
  ])

  const communications = [
    ...(reqs ?? []).map(r => {
      const items = (Array.isArray(r.items) ? r.items : []) as Item[]
      return {
        type: 'document_request' as const, id: String(r.id), at: String(r.created_at), by: (r.created_by as string | null) ?? null,
        ownerEmail: (r.owner_email as string | null) ?? null, tenantEmail: (r.tenant_email as string | null) ?? null,
        ownerItems: items.filter(i => i.recipient === 'owner' || i.recipient === 'both').map(i => i.label),
        tenantItems: items.filter(i => i.recipient === 'tenant' || i.recipient === 'both').map(i => i.label),
        message: (r.message as string | null) ?? null,
        ownerNote: (r.owner_note as string | null) ?? null, tenantNote: (r.tenant_note as string | null) ?? null,
      }
    }),
    ...((letters ?? []) as { id: string; updated_at: string; created_at: string; signers: unknown; payload: unknown }[]).flatMap(l => {
      const signers = (Array.isArray(l.signers) ? l.signers : []) as { name?: string | null; signed_at?: string }[]
      const dist = (l.payload as { distribution?: { at?: string; recipients?: { role?: string; name?: string | null }[] } } | null)?.distribution
      const out: Record<string, unknown>[] = [{
        type: 'approval_letter' as const, id: String(l.id), at: String(l.updated_at || l.created_at), by: null,
        signers: signers.filter(s => s.signed_at).map(s => String(s.name ?? 'Board member')),
      }]
      // The signed letter being emailed to every party is its own timeline entry.
      if (dist?.at) out.push({
        type: 'approval_sent' as const, id: `${l.id}-dist`, at: String(dist.at), by: null,
        recipients: (dist.recipients ?? []).map(r => `${r.name ?? '—'} (${r.role ?? 'party'})`),
      })
      return out
    }),
    ...((filed ?? []) as Record<string, unknown>[]).map(f => ({
      type: 'filed_email' as const, id: String(f.id), at: String(f.occurred_at ?? f.created_at),
      by: (f.logged_by as string | null) ?? null,
      subject: (f.subject as string | null) ?? null,
      body: (f.body as string | null) ?? '',
      fromEmail: (f.from_email as string | null) ?? null,
      fromName: (f.from_name as string | null) ?? null,
      toEmails: (f.to_emails as string[] | null) ?? [],
      ccEmails: (f.cc_emails as string[] | null) ?? [],
      attachmentNames: (f.attachment_names as string[] | null) ?? [],
      direction: (f.direction as string | null) ?? 'inbound',
    })),
  ].sort((a, b) => new Date(String(b.at)).getTime() - new Date(String(a.at)).getTime())

  return NextResponse.json({ communications })
}
