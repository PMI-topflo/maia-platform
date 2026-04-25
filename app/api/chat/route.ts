import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'

const client = new Anthropic()

const PERSONA_PROMPTS: Record<string, string> = {
  homeowner: 'You are helping a homeowner or unit owner. They may ask about HOA dues, assessments, maintenance requests, violations, amenity access, community rules, governing documents, and association events.',
  tenant: 'You are helping a tenant renting in a PMI-managed property. They may ask about maintenance requests, lease procedures, amenity access, move-in/out procedures, noise complaints, and community rules.',
  buyer: 'You are helping someone purchasing a property in a PMI-managed community. They may ask about HOA due diligence, the buyer application process, approval timelines, estoppel letters, transfer fees, and what to expect as a new owner.',
  agent: 'You are helping a real estate agent or realtor. They may ask about listing procedures, buyer application requirements, HOA rules and monthly fees, approval timelines, showing requests, and who to contact on the management team.',
  vendor: `You are helping a vendor or contractor working with PMI Top Florida Properties.

VENDOR KEYWORD RULES — follow these exactly:

1. ACH / PAYMENT SETUP
   Trigger words: "ACH", "bank", "payment setup", "direct deposit", "how do I get paid", "bank account", "electronic payment"
   Response: "To set up your ACH payment, please download our Vendor ACH Authorization Form here: https://www.pmitop.com/vendor-ach-form.pdf — Complete and return it to billing@topfloridaproperties.com"

2. COI / CERTIFICATE OF INSURANCE
   Trigger words: "COI", "certificate of insurance", "additional insured", "insurance requirements", "insurance certificate"
   Step 1 — If they haven't named an association yet, ask: "Which association are you working with?"
   Step 2 — Once they name an association, look it up in the ASSOCIATION LIST below (match by name or code, case-insensitive).
   If address IS available, respond with exactly:
     "Your Certificate of Insurance must list the following as Additional Insured:
     1. [Full Association Legal Name], [Principal Address], [City], [State] [Zip]
     2. PMI Top Florida Properties, 1031 Ives Dairy Road Suite 228, Miami, FL 33179
     Please forward these details to your insurance agent.
     Questions? Contact billing@topfloridaproperties.com or call 305.900.5077"
   If address IS NOT available (marked as NO ADDRESS), respond:
     "Please contact our billing team directly at billing@topfloridaproperties.com or call 305.900.5077 for the COI requirements for that association."

3. INVOICES / BILLING
   Trigger words: "invoice", "billing", "bill", "statement", "payment status"
   Response: "Please send invoices to billing@topfloridaproperties.com — our team processes payments on a regular schedule. For status updates call (305) 900-5077."

4. WORK ORDERS / APPROVALS
   They may ask about scope approvals, work orders, or getting started on a job.
   Direct them to: service@topfloridaproperties.com or (305) 900-5077`,
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

  const isVendor = (persona ?? 'homeowner') === 'vendor'

  let faqContext = ''
  let vendorAssocList = ''

  const contextQueries: Promise<unknown>[] = []

  if (associationCode) {
    contextQueries.push(
      Promise.all([
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
      ]).then(([faqRes, assocRes]) => {
        if (assocRes.data?.association_name) {
          faqContext += `\n\nASSOCIATION: ${assocRes.data.association_name} (${associationCode})`
        }
        if (faqRes.data?.length) {
          faqContext += '\n\nKNOWLEDGE BASE:\n' +
            faqRes.data.map((f: { question: string; answer: string; important_note?: string }) =>
              `Q: ${f.question}\nA: ${f.answer}${f.important_note ? `\nNote: ${f.important_note}` : ''}`
            ).join('\n\n')
        }
      })
    )
  }

  // For vendor persona, fetch all associations with addresses for COI lookups
  if (isVendor) {
    contextQueries.push(
      Promise.resolve(
        supabaseAdmin
          .from('associations')
          .select('association_code, association_name, principal_address, city, state, zip')
          .eq('active', true)
          .order('association_code')
      ).then(({ data }) => {
          if (!data?.length) return
          const lines = data.map((a: {
            association_code: string
            association_name: string
            principal_address: string | null
            city: string | null
            state: string | null
            zip: string | null
          }) => {
            const addr = (a.principal_address && a.city && a.zip)
              ? `${a.principal_address}, ${a.city}, ${a.state ?? 'FL'} ${a.zip}`
              : 'NO ADDRESS'
            return `- ${a.association_code} | ${a.association_name} | ${addr}`
          })
          vendorAssocList = '\n\nASSOCIATION LIST (for COI lookups):\n' + lines.join('\n')
        })
    )
  }

  await Promise.all(contextQueries)

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
${faqContext}${vendorAssocList}

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
    // Detect vendor topic from last user message
    const lastUserMsg = [...messages].reverse().find((m: { role: string }) => m.role === 'user')?.content?.toLowerCase() ?? ''
    const topic = isVendor
      ? /ach|bank|payment setup|direct deposit|how do i get paid/.test(lastUserMsg) ? 'vendor-ach'
        : /coi|certificate of insurance|additional insured|insurance/.test(lastUserMsg) ? 'vendor-coi'
        : /invoice|billing|bill|statement/.test(lastUserMsg) ? 'vendor-billing'
        : 'vendor-inquiry'
      : null

    void supabaseAdmin
      .from('general_conversations')
      .upsert(
        {
          session_id: sessionId,
          persona: persona ?? 'homeowner',
          language: language ?? 'en',
          association_code: associationCode ?? null,
          messages: [...messages, { role: 'assistant', content: reply }],
          topic: topic ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'session_id' }
      )
  }

  return NextResponse.json({ reply })
}
