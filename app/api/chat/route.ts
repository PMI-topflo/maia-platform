import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'

const client = new Anthropic()

const PERSONA_PROMPTS: Record<string, string> = {
  homeowner: 'You are helping a homeowner or unit owner. They may ask about HOA dues, assessments, maintenance requests, violations, amenity access, community rules, governing documents, and association events.',
  tenant: 'You are helping a tenant renting in a PMI-managed property. They may ask about maintenance requests, lease procedures, amenity access, move-in/out procedures, noise complaints, and community rules.',
  buyer: 'You are helping someone purchasing a property in a PMI-managed community. They may ask about HOA due diligence, the buyer application process, approval timelines, estoppel letters, transfer fees, and what to expect as a new owner.',
  agent: 'You are helping a real estate agent or realtor. They may ask about listing procedures, buyer application requirements, HOA rules and monthly fees, approval timelines, showing requests, and who to contact on the management team.',
  vendor: 'You are helping a vendor or contractor. They may ask about Certificate of Insurance (COI) requirements, ACH payment setup, work order procedures, scope approvals, and billing contacts.',
  board: 'You are helping an HOA board member. They may ask about governance procedures, meeting requirements, financial reports, violations enforcement, reserve funding, contractor bids, and coordinating with the management team.',
  title: 'You are helping a title company. They may ask about estoppel letters, HOA account balances, open violations, transfer fees, closing procedures, and the correct contacts for documentation requests.',
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', he: 'Hebrew', ru: 'Russian',
}

export async function POST(req: NextRequest) {
  const { messages, persona, associationCode, language, sessionId } = await req.json()

  if (!messages?.length) {
    return NextResponse.json({ reply: '' }, { status: 400 })
  }

  let faqContext = ''
  if (associationCode) {
    const [faqRes, assocRes] = await Promise.all([
      supabaseAdmin
        .from('association_faq')
        .select('category, question, answer, important_note')
        .eq('association_code', associationCode)
        .eq('active', true)
        .limit(20),
      supabaseAdmin
        .from('associations')
        .select('association_name')
        .eq('association_code', associationCode)
        .single(),
    ])

    if (assocRes.data?.association_name) {
      faqContext += `\n\nASSOCIATION: ${assocRes.data.association_name} (${associationCode})`
    }

    if (faqRes.data?.length) {
      faqContext += '\n\nKNOWLEDGE BASE:\n' +
        faqRes.data.map(f =>
          `Q: ${f.question}\nA: ${f.answer}${f.important_note ? `\nNote: ${f.important_note}` : ''}`
        ).join('\n\n')
    }
  }

  const langName = LANGUAGE_NAMES[language ?? 'en'] ?? 'English'
  const personaContext = PERSONA_PROMPTS[persona ?? 'homeowner'] ?? PERSONA_PROMPTS.homeowner

  const systemPrompt = `You are MAIA (Management AI Assistant), the intelligent assistant for PMI Top Florida Properties — a professional HOA and condominium management company in South Florida.

${personaContext}

COMPANY INFO:
- Phone: (305) 900-5077
- Email: maia@pmitop.com
- Website: pmitop.com
- Service/Maintenance: service@topfloridaproperties.com
- Billing: billing@topfloridaproperties.com
${faqContext}

RESPONSE RULES:
- Always respond in ${langName}.
- Be helpful, concise, and professional. Keep responses under 150 words unless a longer explanation is truly needed.
- If you don't know the answer, say so honestly and direct them to call (305) 900-5077 or email maia@pmitop.com.
- Never invent specific dollar amounts, dates, or policy details you are not certain about.
- For urgent maintenance (flooding, no AC, safety hazards), always include the service email and phone number.`

  let reply = ''
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    })
    reply = response.content[0].type === 'text' ? response.content[0].text : ''
  } catch (err) {
    console.error('[chat]', err)
    return NextResponse.json({ reply: 'Sorry, I ran into an issue. Please contact us at maia@pmitop.com or (305) 900-5077.' })
  }

  if (sessionId) {
    void supabaseAdmin
      .from('general_conversations')
      .upsert(
        {
          session_id: sessionId,
          persona: persona ?? 'homeowner',
          language: language ?? 'en',
          association_code: associationCode ?? null,
          messages: [...messages, { role: 'assistant', content: reply }],
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'session_id' }
      )
  }

  return NextResponse.json({ reply })
}
