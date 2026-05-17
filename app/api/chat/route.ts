import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildSkillsPromptBlock } from '@/lib/skills'
import { buildOfficeHoursBlock } from '@/lib/office-hours'
import { categoryLabel } from '@/lib/association-documents'

// Each per-document excerpt is capped so the system prompt stays under
// Claude Haiku 4.5's effective context window for cost. A typical
// association ends up with ~25 indexed PDFs; 4 KB each ≈ 100 KB total,
// well within budget. The truncation note tells Claude when it's
// looking at a partial doc so it doesn't pretend it has more context.
const DOC_EXCERPT_BUDGET_PER_DOC = 4000
const DOC_TOTAL_TEXT_BUDGET      = 120_000

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

function describeAssociationType(t: string): string {
  switch (t) {
    case 'condo':            return 'residential condominium (governed by Florida Statutes Chapter 718)'
    case 'commercial_condo': return 'commercial / non-residential condominium (governed by Florida Statutes Chapter 718; voting and assessments often weighted by square footage; tenants are commercial lessees, not residential tenants)'
    case 'coop':             return 'cooperative — owners hold shares + a proprietary lease (governed by Florida Statutes Chapter 719)'
    case 'hoa':              return 'homeowners association (governed by Florida Statutes Chapter 720)'
    case 'master_hoa':       return 'master HOA — governs community-wide common areas above one or more sub-associations (still Florida Statutes Chapter 720, but at the umbrella level; unit-level rules belong to the sub-association)'
    default:                 return t
  }
}

export async function POST(req: NextRequest) {
  const { messages, persona, associationCode, language, sessionId } = await req.json()

  if (!messages?.length) {
    return NextResponse.json({ reply: '' }, { status: 400 })
  }

  const isVendor = (persona ?? 'homeowner') === 'vendor'

  let faqContext = ''
  let docsContext = ''
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
          .select('association_name, association_type')
          .eq('association_code', associationCode)
          .single(),
      ]).then(([faqRes, assocRes]) => {
        if (assocRes.data?.association_name) {
          faqContext += `\n\nASSOCIATION: ${assocRes.data.association_name} (${associationCode})`
        }
        if (assocRes.data?.association_type) {
          faqContext += `\nASSOCIATION TYPE: ${describeAssociationType(assocRes.data.association_type)}`
        }
        if (faqRes.data?.length) {
          faqContext += '\n\nKNOWLEDGE BASE:\n' +
            faqRes.data.map((f: { question: string; answer: string; important_note?: string }) =>
              `Q: ${f.question}\nA: ${f.answer}${f.important_note ? `\nNote: ${f.important_note}` : ''}`
            ).join('\n\n')
        }
      })
    )

    // Pull association documents into context. We fetch extracted_text
    // here (the only place we do — the admin list endpoint strips it
    // to keep the listing lightweight). Excerpts are capped both
    // per-document and in total so the system prompt stays manageable
    // even for associations with 50+ uploaded PDFs.
    contextQueries.push(
      // Wrap the supabase chain in Promise.resolve so its PromiseLike
      // shape matches contextQueries' Promise<unknown>[] declared type.
      Promise.resolve(
        supabaseAdmin
          .from('association_documents')
          .select('category, subcategory, filename, extracted_text, notes, effective_date, expiry_date')
          .eq('association_code', associationCode)
          // Skip archived (superseded) versions so MAIA answers from
          // current docs only — citing an outdated Rules PDF would be
          // worse than not citing one at all.
          .is('archived_at', null)
          // Order: docs with real extracted content first (so they win
          // the budget), then notes / unsupported rows that only carry
          // the notes field.
          .order('extraction_status', { ascending: true })
          .order('updated_at', { ascending: false })
          .limit(60)
      ).then(({ data }) => {
          if (!data?.length) return
          let totalChars = 0
          const blocks: string[] = []
          for (const d of data as Array<{
            category:        string
            subcategory:     string | null
            filename:        string
            extracted_text:  string | null
            notes:           string | null
            effective_date:  string | null
            expiry_date:     string | null
          }>) {
            if (totalChars >= DOC_TOTAL_TEXT_BUDGET) break
            const body = (d.extracted_text ?? d.notes ?? '').trim()
            if (!body) continue
            const excerpt = body.length > DOC_EXCERPT_BUDGET_PER_DOC
              ? body.slice(0, DOC_EXCERPT_BUDGET_PER_DOC) + `\n[…truncated; full doc is ${body.length.toLocaleString()} chars]`
              : body
            const header = [
              `--- ${categoryLabel(d.category)}: ${d.filename}`,
              d.subcategory ? `(${d.subcategory})` : null,
              d.effective_date ? `effective ${d.effective_date}` : null,
              d.expiry_date ? `expires ${d.expiry_date}` : null,
            ].filter(Boolean).join(' ')
            blocks.push(`${header} ---\n${excerpt}`)
            totalChars += excerpt.length + header.length + 10
          }
          if (blocks.length > 0) {
            docsContext = `\n\nASSOCIATION DOCUMENTS (verbatim excerpts — cite filename when answering from these):\n${blocks.join('\n\n')}`
          }
        }),
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

  const [skillsBlock] = await Promise.all([
    buildSkillsPromptBlock('customer'),
    Promise.all(contextQueries),
  ])

  const langName = LANGUAGE_NAMES[language ?? 'en'] ?? 'English'
  const personaContext = PERSONA_PROMPTS[persona ?? 'homeowner'] ?? PERSONA_PROMPTS.homeowner

  const systemPrompt = `You are MAIA (Management AI Assistant), the intelligent assistant for PMI Top Florida Properties — a professional HOA and condominium management company in South Florida.

${personaContext}

COMPANY INFO:
- Office Phone: (305) 900-5077
- WhatsApp/SMS: (786) 686-3223
- Email: maia@pmitop.com
- Website: pmitop.com
- Service/Maintenance: service@topfloridaproperties.com
- Billing: billing@topfloridaproperties.com
${faqContext}${docsContext}${vendorAssocList}

RESPONSE RULES:
- Always respond in ${langName}.
- Be helpful, concise, and professional. Keep responses under 150 words unless a longer explanation is truly needed.
- If you don't know the answer, say so honestly and direct them to call (305) 900-5077, WhatsApp (786) 686-3223, or email maia@pmitop.com.
- Never invent specific dollar amounts, dates, or policy details you are not certain about.
- For urgent maintenance (flooding, no AC, safety hazards), always include the service email and phone number.${buildOfficeHoursBlock()}${skillsBlock}`

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
