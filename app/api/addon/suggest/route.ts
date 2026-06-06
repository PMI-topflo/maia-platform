// =====================================================================
// POST /api/addon/suggest   { subject, body }
//
// "Intelligence" for the Gmail add-on: given the open email's subject +
// body, suggest (a) the association — deterministically via MAIA's
// detectAssociationCode (aliases / #CODE / core-name) — and (b) what the
// email is: an invoice, a work order, or a general ticket — via a quick
// Haiku classification. Powers the "✨ Maia suggests" section and pre-fills
// the create form.
//
// Auth: add-on bearer token. Best-effort: any failure degrades to nulls.
// =====================================================================

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { assertClaudeBudget } from '@/lib/anthropic-guard'
import { addonStaffEmail } from '@/lib/addon-token'
import { detectAssociationCode } from '@/lib/maia-command-processor'

export const dynamic = 'force-dynamic'
const MODEL = 'claude-haiku-4-5-20251001'

type Kind = 'invoice' | 'work_order' | 'ticket'

export async function POST(req: Request) {
  const staff = await addonStaffEmail(req)
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let payload: Record<string, unknown> = {}
  try { payload = await req.json() } catch { /* empty */ }
  const subject = String(payload.subject ?? '').slice(0, 500)
  const text    = String(payload.body ?? '').slice(0, 6000)
  const combined = `${subject}\n${text}`.trim()

  // (a) Association — deterministic, no AI. Reads the full text so the
  //     common name / #CODE / alias is picked up (e.g. "Delvista" → DEL).
  let association: string | null = null
  try { association = await detectAssociationCode(combined, false) } catch { /* leave null */ }

  // (b) Kind — quick Haiku classification. Best-effort.
  let kind: Kind = 'ticket'
  let reason = ''
  if (process.env.ANTHROPIC_API_KEY && combined) {
    try {
      const anthropic = new Anthropic()
      await assertClaudeBudget('route')
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: `You triage inbound email for an HOA / condo property manager. Reply with ONLY a JSON object: {"kind":"invoice"|"work_order"|"ticket","reason":"<=12 words"}.
- invoice: a bill, balance due, or payment request from a vendor.
- work_order: a maintenance/repair job — roofing, plumbing, landscaping, pest, "job complete", inspection, scheduling a vendor.
- ticket: anything else (a question, a document, a general request).

Subject: ${subject}
Body: ${text.slice(0, 3000)}`,
        }],
      })
      const raw = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text).join('').trim().replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(raw) as { kind?: string; reason?: string }
      if (parsed.kind === 'invoice' || parsed.kind === 'work_order' || parsed.kind === 'ticket') kind = parsed.kind
      reason = String(parsed.reason ?? '').slice(0, 90)
    } catch { /* keep default 'ticket' */ }
  }

  return NextResponse.json({ association, kind, reason })
}
