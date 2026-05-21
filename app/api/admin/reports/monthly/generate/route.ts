// =====================================================================
// POST /api/admin/reports/monthly/generate
//
// Has MAIA write the monthly management report for the board from the
// month's real data — ticket / work-order volume, email volume, and the
// items staff flagged. The layout + tone come from the
// `association-communications-reporting` skill.
//
// Body: { assoc?: string; month?: string }  → { ok, report (markdown) }
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import Anthropic from '@anthropic-ai/sdk'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { gatherMonthlyReportData } from '@/lib/monthly-report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const REPORT_SKILL_SLUG = 'association-communications-reporting'

// Fallback layout instruction used only if the skill row is missing.
const FALLBACK_LAYOUT = `Write a monthly management report with these sections:
Executive summary, Open issues, Completed items, Maintenance updates,
Financial & administrative updates, Risk items, Owner & board communication
highlights, Recommendations, Next action plan. Tone: positive, transparent,
proactive. Output clean markdown only.`

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { assoc?: string; month?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 })
  }

  const data = await gatherMonthlyReportData(body.assoc ?? '', body.month ?? '')

  // The report layout + brand voice live in the skill.
  const { data: skill } = await supabaseAdmin
    .from('maia_skills')
    .select('body')
    .eq('slug', REPORT_SKILL_SLUG)
    .maybeSingle()
  const layoutGuide = (skill?.body as string | undefined) ?? FALLBACK_LAYOUT

  // ── Assemble the data the model writes from ──
  const scope = data.assoc
    ? `the association ${data.assoc}`
    : 'all PMI-managed associations'

  const activityLines = data.activity.length === 0
    ? '(no ticket, work-order, or email activity recorded this month)'
    : data.activity.map(a =>
        `- ${a.name} (${a.code}): tickets ${a.ticketsReceived} received / ${a.ticketsClosed} closed · ` +
        `work orders ${a.workOrdersReceived} received / ${a.workOrdersClosed} closed · ` +
        `${a.emailThreadsReceived} email threads received`,
      ).join('\n')

  const t = data.totals
  const totalsLine =
    `TOTALS: tickets ${t.ticketsReceived} received / ${t.ticketsClosed} closed · ` +
    `work orders ${t.workOrdersReceived} received / ${t.workOrdersClosed} closed · ` +
    `${t.emailThreadsReceived} email threads received`

  const flaggedLines = data.flaggedItems.length === 0
    ? '(staff did not flag any specific items for this report)'
    : data.flaggedItems.slice(0, 80).map(f => {
        const kind = f.type === 'work_order' ? 'Work order' : 'Ticket'
        const head = `- [${f.ticket_number}] ${kind} · ${f.association_code ?? 'no association'} · ` +
                     `status ${f.status ?? 'open'}${f.priority ? ` · ${f.priority} priority` : ''}`
        const subj = f.subject  ? `\n  Subject: ${f.subject}`   : ''
        const summ = f.summary  ? `\n  Detail: ${f.summary.slice(0, 400)}` : ''
        return head + subj + summ
      }).join('\n')

  const userPrompt =
`Generate the monthly management report for ${data.monthLabel}, covering ${scope}.

ACTIVITY THIS MONTH (per association):
${activityLines}

${totalsLine}

ITEMS STAFF FLAGGED FOR THIS REPORT:
${flaggedLines}

Write the complete report in clean markdown, following the "Monthly board report
layout" exactly. Use the real numbers above. Where a section has no data, say so
in one short line rather than omitting the section. Do not invent figures.`

  const anthropic = new Anthropic()
  let reportMarkdown: string
  try {
    const msg = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system:
        'You are MAIA, the operations assistant for PMI Top Florida Properties, ' +
        'writing a monthly management report for an association board. Apply the ' +
        'brand voice and use the report layout below. Output ONLY the report as ' +
        'clean markdown — no preamble, no sign-off about being an AI.\n\n' +
        layoutGuide,
      messages: [{ role: 'user', content: userPrompt }],
    })
    reportMarkdown = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()
  } catch (err) {
    return NextResponse.json(
      { error: `Report generation failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    )
  }

  if (!reportMarkdown) {
    return NextResponse.json({ error: 'The model returned an empty report' }, { status: 502 })
  }

  return NextResponse.json({
    ok:         true,
    report:     reportMarkdown,
    month:      data.month,
    monthLabel: data.monthLabel,
    assoc:      data.assoc,
  })
}
