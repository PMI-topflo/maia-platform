import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

type ConvSnippet = {
  date:          string
  channel:       string
  subject:       string | null
  summary:       string | null
  contact_name:  string | null
  contact_email: string | null
  status:        string | null
}

export async function POST(req: NextRequest) {
  let body: { query: string; conversations: ConvSnippet[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { query, conversations } = body
  if (!query || !conversations?.length) {
    return NextResponse.json({ error: 'Missing query or conversations' }, { status: 400 })
  }

  // Compile conversation text for Claude (newest first, cap at 60 items)
  const items = conversations.slice(0, 60)
  const lines = items.map(c => {
    const date    = new Date(c.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const who     = [c.contact_name, c.contact_email].filter(Boolean).join(' / ') || 'Unknown'
    const channel = c.channel.replace('email-in', 'email ↓').replace('email-out', 'email ↑')
    const status  = c.status ? ` [${c.status}]` : ''
    const subject = c.subject ? `"${c.subject}"` : ''
    const preview = c.summary ? c.summary.slice(0, 300) : ''
    return `[${date}] ${channel}${status} — ${who} — ${subject}\n${preview}`.trim()
  })

  const prompt = `You are reviewing all recorded interactions with the contact matching "${query}".

Here are the ${items.length} most recent interactions (newest first):

${lines.join('\n\n---\n\n')}

Please provide:
1. A concise 2-4 sentence summary of who this person is and the overall nature of their interactions.
2. A list of up to 5 actionable pending items or open questions that seem to need follow-up, based on the conversation history.

Respond in JSON with this exact shape:
{
  "summary": "...",
  "pending": ["item 1", "item 2", ...]
}

If there are no pending items, return an empty array. Be specific and actionable.`

  try {
    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages:   [{ role: 'user', content: prompt }],
    })

    const text = message.content.find((b: { type: string }) => b.type === 'text') as { type: 'text'; text: string } | undefined
    const responseText = text?.text ?? ''
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')

    const parsed = JSON.parse(jsonMatch[0]) as { summary: string; pending: string[] }
    return NextResponse.json({ ok: true, summary: parsed.summary, pending: parsed.pending ?? [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ai-summary] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
