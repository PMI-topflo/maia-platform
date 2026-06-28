// =====================================================================
// GET /api/owner/ach-form/[token]
//
// Login-free, MAIA-generated ACH authorization form (PDF) for an owner. The
// token (HMAC, 30-day TTL) encodes { assoc, account }; the form itself holds
// no sensitive data — it's blank for the owner to complete and return to
// ar@topfloridaproperties.com. Replaces handing out a Google Drive folder.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyAchToken } from '@/lib/owner-portal-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { renderAchAuthorizationPdf } from '@/lib/ach-form'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const data = await verifyAchToken(token)
  if (!data) {
    return new NextResponse('This ACH form link has expired or is invalid. Please request a new one.', { status: 401 })
  }

  const { data: o } = await supabaseAdmin.from('owners')
    .select('first_name, last_name, entity_name, unit_number, address, association_name, emails')
    .eq('association_code', data.assoc).eq('account_number', data.account).limit(1).maybeSingle()

  const ownerName = (o?.entity_name as string)
    || [o?.first_name, o?.last_name].filter(Boolean).join(' ').trim()
    || 'Owner'
  const email = String(o?.emails ?? '').split(/[,;\s]+/).map(s => s.trim()).find(s => s.includes('@')) ?? null

  const pdf = await renderAchAuthorizationPdf({
    ownerName,
    unit:        (o?.unit_number as string) ?? null,
    address:     (o?.address as string) ?? null,
    association: (o?.association_name as string) ?? data.assoc,
    email,
    account:     data.account,
    generatedOn: new Date().toISOString().slice(0, 10),
  })

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="ACH-Authorization-${data.account}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
