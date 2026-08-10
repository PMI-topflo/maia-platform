// POST /api/admin/pre-apply/[id]/decision-page/send   { docId }
// Email each unsigned board signer their signing link for the Board Decision
// Page / approval letter (after PMI's review). Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { signEsignToken } from '@/lib/esign-token'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ctx.params
  let b: { docId?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const docId = String(b.docId ?? '').trim()
  if (!docId) return NextResponse.json({ error: 'docId required' }, { status: 400 })

  const { data: doc } = await supabaseAdmin.from('esign_documents').select('id, title, signers, payload').eq('id', docId).maybeSingle()
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const signers = Array.isArray(doc.signers) ? (doc.signers as Array<{ role: string; name: string | null; email: string | null; signed_at?: string }>) : []
  const pending = signers.filter(s => !s.signed_at && (s.email ?? '').includes('@'))
  if (pending.length === 0) return NextResponse.json({ ok: true, sent: 0, note: 'All signers have already signed.' })

  const address = (doc.payload as { propertyAddress?: string } | null)?.propertyAddress ?? ''
  let sent = 0
  for (const s of pending) {
    const link = `${APP}/esign/${await signEsignToken(docId, s.role)}`
    try {
      await sendEmail({
        to: [String(s.email)],
        subject: `Please sign — ${doc.title}`,
        html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px">
          <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f26a1b;font-weight:700;margin:0 0 4px">PMI Top Florida Properties</p>
          <h2 style="margin:0 0 8px;color:#1f2a44">Board approval letter — signature requested</h2>
          <p>Hello ${esc(s.name ?? 'Board Member')}, the approval letter${address ? ` for <strong>${esc(address)}</strong>` : ''} is ready for your signature.</p>
          <p><a href="${link}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px">Review &amp; sign the letter →</a></p>
          <p style="color:#9aa0ab;font-size:12px">You'll see the full letter before you sign. This link is unique to you.</p>
        </div>`,
      })
      sent++
    } catch { /* keep going; report count */ }
  }
  return NextResponse.json({ ok: true, sent })
}
