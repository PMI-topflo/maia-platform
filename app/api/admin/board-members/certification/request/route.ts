// POST /api/admin/board-members/certification/request  { code, memberId? }
// Email a board member a login-free link to upload their DBPR board-education
// certificate. With memberId → just that member. Without → every active
// member with an email whose certificate isn't already on file. Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { signBoardCertToken } from '@/lib/board-cert-token'
import { getBoardCertOverview } from '@/lib/board-certification-data'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { code?: string; memberId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const code = String(body.code ?? '').trim().toUpperCase()
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })

  const [{ data: assoc }, overview] = await Promise.all([
    supabaseAdmin.from('associations').select('association_name').eq('association_code', code).maybeSingle(),
    getBoardCertOverview(code),
  ])
  const assocName = assoc?.association_name ?? code

  const targets = overview.members.filter(m => {
    if (!m.email) return false
    if (body.memberId) return m.id === body.memberId
    return m.summary.state !== 'on_file'          // "request from all" → only those not yet on file
  })
  if (targets.length === 0) return NextResponse.json({ error: 'no eligible board members (missing email, or all already on file)' }, { status: 400 })

  const sent: string[] = []
  const failed: string[] = []
  for (const m of targets) {
    try {
      const token = await signBoardCertToken(code, m.id)
      const link  = `${APP}/board-certification/${token}`
      await sendEmail({
        to: m.email!,
        subject: `Action needed: upload your board education certificate — ${assocName}`,
        html: `<p>Hello ${m.name ?? 'Board Member'},</p>
               <p>Florida law requires each association board member to have a current board-education certificate on file. Please upload yours — it takes a minute, no login required:</p>
               <p><a href="${link}" style="display:inline-block;background:#f26a1b;color:#fff;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none">Upload my certificate →</a></p>
               <p style="color:#6b7280;font-size:13px">This covers the DBPR board-education Certificate of Completion (and, if applicable, your signed Board Member Certification Form). If you have questions, just reply to this email.</p>
               <p style="color:#6b7280;font-size:13px">— ${assocName} management (PMI Top Florida Properties)</p>`,
      })
      sent.push(m.email!)
    } catch {
      failed.push(m.email!)
    }
  }

  return NextResponse.json({ ok: true, sent, failed, sentCount: sent.length })
}
