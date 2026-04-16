// ============================================================
// app/api/webhook/route.ts
// Unified Twilio Webhook — SMS + WhatsApp + Voice
// + Feedback system fully wired at every flow completion
// Stack: Next.js · Supabase · Claude API · Twilio · Rentvine
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createClient } from '@supabase/supabase-js'

// ─── Clients ────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
)

// ─── Types ───────────────────────────────────────────────────

type Channel      = 'sms' | 'whatsapp' | 'voice'
type Division     = 'association' | 'residential' | 'unknown'
type FeedbackType = 'thumbs' | 'stars'

type PersonaType =
  | 'homeowner' | 'association_tenant' | 'board_member'
  | 'vendor' | 'real_estate_agent' | 'potential_tenant'
  | 'potential_buyer' | 'guest' | 'residential_owner'
  | 'residential_tenant' | 'residential_vendor' | 'unknown'

interface CallerContext {
  phone:              string
  channel:            Channel
  division:           Division
  persona:            PersonaType
  language:           string
  name:               string
  unitId?:            string
  associationId?:     string
  rentvineContactId?: string
}

interface ConversationState {
  id:                  string
  phone_number:        string
  owner_id:            string | null
  current_flow:        string
  current_step:        string
  temporary_data_json: Record<string, unknown>
  updated_at:          string
}

// ── Which flows get feedback + rating type ───────────────────
// thumbs  = quick interactions (2–4 messages)
// stars   = complex flows (5+ messages, escalations, disputes)
const FEEDBACK_CONFIG: Record<string, { type: FeedbackType }> = {
  sticker_register:        { type: 'thumbs' },
  maintenance_rentvine:    { type: 'stars'  },
  maintenance_association: { type: 'stars'  },
  documents:               { type: 'stars'  },
  payment:                 { type: 'thumbs' },
  schedule:                { type: 'thumbs' },
  staff_handoff:           { type: 'stars'  },
  lease_approval:          { type: 'stars'  },
  board_approval:          { type: 'stars'  },
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', pt: 'Portuguese',
  fr: 'French',  he: 'Hebrew',  ru: 'Russian',
}

// ============================================================
// FEEDBACK TEMPLATES  (6 languages)
// ============================================================

const FEEDBACK_MSG = {

  thumbs: (flow: string, lang: string): string => {
    const label = flow.replace(/_/g, ' ')
    return ({
      en: `How was our support with your ${label}?\n\n👍 Reply UP — great\n👎 Reply DOWN — needs improvement\n\nOptional: add a short note after your reply.`,
      es: `¿Cómo fue nuestro apoyo con ${label}?\n\n👍 Responde BIEN — excelente\n👎 Responde MAL — necesita mejorar\n\nOpcional: añade una nota corta.`,
      pt: `Como foi nosso suporte com ${label}?\n\n👍 Responda BOM — ótimo\n👎 Responda RUIM — precisa melhorar\n\nOpcional: adicione uma nota curta.`,
      fr: `Comment s'est passé notre support pour ${label}?\n\n👍 BIEN — excellent\n👎 MAL — à améliorer`,
      he: `כיצד היה השירות שלנו?\n\n👍 השב טוב — מצוין\n👎 השב רע — צריך שיפור`,
      ru: `Как вам наша поддержка?\n\n👍 ХОРОШО — отлично\n👎 ПЛОХО — нужно улучшение`,
    } as Record<string, string>)[lang] ?? `Rate our support: reply UP 👍 or DOWN 👎.`
  },

  stars: (flow: string, lang: string): string => {
    const label = flow.replace(/_/g, ' ')
    return ({
      en: `We completed your ${label}. How would you rate our support?\n\n1 ⭐ Very poor\n2 ⭐⭐ Poor\n3 ⭐⭐⭐ OK\n4 ⭐⭐⭐⭐ Good\n5 ⭐⭐⭐⭐⭐ Excellent\n\nReply with a number. Optional: add a comment after.`,
      es: `Completamos tu ${label}. ¿Cómo calificarías nuestro servicio?\n\n1 ⭐ Muy malo\n2 ⭐⭐ Malo\n3 ⭐⭐⭐ Regular\n4 ⭐⭐⭐⭐ Bueno\n5 ⭐⭐⭐⭐⭐ Excelente\n\nResponde con un número.`,
      pt: `Concluímos sua ${label}. Como avalia nosso atendimento?\n\n1 ⭐ Muito ruim\n2 ⭐⭐ Ruim\n3 ⭐⭐⭐ Regular\n4 ⭐⭐⭐⭐ Bom\n5 ⭐⭐⭐⭐⭐ Excelente\n\nResponda com um número.`,
      fr: `Traitement terminé pour ${label}.\n1 ⭐ Très mauvais  2 ⭐⭐ Mauvais  3 ⭐⭐⭐ Correct  4 ⭐⭐⭐⭐ Bon  5 ⭐⭐⭐⭐⭐ Excellent`,
      he: `כיצד תדרג את חוויית השירות?\n1 ⭐ גרוע  2 ⭐⭐ רע  3 ⭐⭐⭐ בסדר  4 ⭐⭐⭐⭐ טוב  5 ⭐⭐⭐⭐⭐ מצוין`,
      ru: `Оцените качество поддержки:\n1 ⭐ Очень плохо  2 ⭐⭐ Плохо  3 ⭐⭐⭐ Нормально  4 ⭐⭐⭐⭐ Хорошо  5 ⭐⭐⭐⭐⭐ Отлично`,
    } as Record<string, string>)[lang] ?? `Rate our support 1–5.`
  },

  thanks: (lang: string, score: number | null): string => {
    const good = score === null || score >= 4
    return ({
      en: good
        ? `🙏 Thank you so much! It was my pleasure to help — Maia 🌸`
        : `🙏 Thank you for letting us know. I'll make sure the team looks into this. — Maia 🌸`,
      es: good
        ? `🙏 ¡Muchas gracias! Fue un placer ayudarte — Maia 🌸`
        : `🙏 Gracias por avisarnos. Me aseguraré de que el equipo lo revise. — Maia 🌸`,
      pt: good
        ? `🙏 Muito obrigada! Foi um prazer te ajudar — Maia 🌸`
        : `🙏 Obrigada por nos avisar. Vou garantir que a equipe revise isso. — Maia 🌸`,
      fr: `🙏 Merci beaucoup! C'était un plaisir — Maia 🌸`,
      he: `🙏 תודה רבה! היה לי תענוג לעזור — מאיה 🌸`,
      ru: `🙏 Спасибо за отзыв!`,
    } as Record<string, string>)[lang] ?? `🙏 Thank you for your feedback!`
  },

  invalid: (lang: string, type: FeedbackType): string => ({
    en: type === 'stars' ? `Please reply with a number from 1 to 5.` : `Please reply UP 👍 or DOWN 👎.`,
    es: type === 'stars' ? `Por favor responde con un número del 1 al 5.` : `Por favor responde BIEN 👍 o MAL 👎.`,
    pt: type === 'stars' ? `Por favor responda com um número de 1 a 5.` : `Por favor responda BOM 👍 ou RUIM 👎.`,
    fr: type === 'stars' ? `Répondez avec un chiffre de 1 à 5.` : `Répondez BIEN ou MAL.`,
    he: type === 'stars' ? `השב עם מספר בין 1 ל-5.` : `השב טוב או רע.`,
    ru: type === 'stars' ? `Ответьте числом от 1 до 5.` : `Ответьте ХОРОШО или ПЛОХО.`,
  } as Record<string, string>)[lang] ?? (type === 'stars' ? `Reply 1–5.` : `Reply UP or DOWN.`),
}

// ============================================================
// MAIN WEBHOOK HANDLER
// ============================================================

export async function POST(req: NextRequest) {
  const body = await req.formData()

  const from:    string = (body.get('From') as string) ?? ''
  const msgBody: string = (body.get('Body') as string) ?? ''
  const callStatus      = body.get('CallStatus') as string | null

  const channel: Channel = from.startsWith('whatsapp:')
    ? 'whatsapp'
    : callStatus !== null
    ? 'voice'
    : 'sms'

  const cleanPhone = from.replace('whatsapp:', '').trim()

  console.log(`[WEBHOOK] ${channel.toUpperCase()} | ${cleanPhone} | "${msgBody}"`)

  if (channel === 'voice') return handleVoice(cleanPhone, body)
  return handleTextChannel(cleanPhone, msgBody, channel)
}

// ============================================================
// VOICE HANDLER
// ============================================================

async function handleVoice(phone: string, body: FormData): Promise<NextResponse> {
  const callStatus = body.get('CallStatus') as string
  if (callStatus === 'ringing' || callStatus === 'in-progress') {
    const ctx      = await buildCallerContext(phone, 'voice')
    const greeting = await getVoiceGreeting(ctx)
    const twiml    = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.${getVoiceForLanguage(ctx.language)}">${greeting}</Say>
  <Gather input="speech" speechTimeout="3" action="/api/webhook/voice-input" method="POST">
    <Say voice="Google.${getVoiceForLanguage(ctx.language)}">${getListenPrompt(ctx.language)}</Say>
  </Gather>
</Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }
  return new NextResponse('OK')
}

// ============================================================
// SMS + WHATSAPP HANDLER
// ============================================================

async function handleTextChannel(
  phone:   string,
  message: string,
  channel: Channel
): Promise<NextResponse> {

  const ctx   = await buildCallerContext(phone, channel)
  const state = await getConversationState(phone)

  let replyText: string

  if (state?.current_flow && state.current_flow !== 'idle') {

    // ── Awaiting feedback reply ──────────────────────────
    if (state.current_flow === 'awaiting_feedback') {
      replyText = await processFeedbackReply(phone, message, ctx, state)

    // ── Agent identification flow ────────────────────────
    } else if (state.current_flow === 'agent_identification') {
      replyText = await continueAgentFlow(ctx, state, message)

    // ── Any other active flow ────────────────────────────
    } else {
      replyText = await continueFlow(ctx, state, message)
    }

  } else {
    const menuTrigger = detectMenuTrigger(message)
    replyText = menuTrigger
      ? await handleMenuOption(ctx, menuTrigger)
      : await getAIResponse(ctx, message)
  }

  await sendReply(phone, replyText, channel)
  await logConversation(phone, message, replyText, ctx)

  return NextResponse.json({ status: 'ok' })
}

// ============================================================
// FEEDBACK — request sender
// Called with void so it fires AFTER the completion message
// The 3s delay ensures completion message arrives first
// ============================================================

async function maybeRequestFeedback(
  phone:    string,
  ctx:      CallerContext,
  flowType: string,
  channel:  Channel
): Promise<void> {

  const config = FEEDBACK_CONFIG[flowType]
  if (!config) return

  // Upgrade to stars if conversation was long (5+ messages)
  const { count } = await supabase
    .from('general_conversations')
    .select('*', { count: 'exact', head: true })
    .eq('phone_number', phone)

  const feedbackType: FeedbackType =
    (count ?? 0) >= 5 ? 'stars' : config.type

  // Save state so next incoming message is treated as feedback
  await saveConversationState(phone, 'awaiting_feedback', 'pending', {
    flowType,
    feedbackType,
    persona:  ctx.persona,
    language: ctx.language,
    channel,
    sentAt:   new Date().toISOString(),
  })

  // Small delay so flow completion message arrives first
  await new Promise(r => setTimeout(r, 3000))

  const msgText = feedbackType === 'stars'
    ? FEEDBACK_MSG.stars(flowType, ctx.language)
    : FEEDBACK_MSG.thumbs(flowType, ctx.language)

  await sendReply(phone, msgText, channel)
}

// ============================================================
// FEEDBACK — reply processor
// ============================================================

async function processFeedbackReply(
  phone:   string,
  message: string,
  ctx:     CallerContext,
  state:   ConversationState
): Promise<string> {

  const data = state.temporary_data_json as {
    flowType:     string
    feedbackType: FeedbackType
    persona:      string
    language:     string
    channel:      string
    sentAt:       string
  }

  const lang         = data.language ?? ctx.language
  const feedbackType = data.feedbackType ?? 'thumbs'
  const msg          = message.trim().toLowerCase()

  let thumbsValue: 'up' | 'down' | null = null
  let starsValue:  number | null         = null
  let comment:     string | null         = null

  // ── Parse thumbs ──────────────────────────────────────────
  if (feedbackType === 'thumbs') {
    const positives = ['up','bien','bom','good','хорошо','טוב','👍','si','sim','yes','great','1']
    const negatives = ['down','mal','ruim','bad','плохо','רע','👎','no','nao','não','poor','2']
    const isPos     = positives.some(p => msg.startsWith(p))
    const isNeg     = negatives.some(n => msg.startsWith(n))

    if (!isPos && !isNeg) return FEEDBACK_MSG.invalid(lang, 'thumbs')

    thumbsValue = isPos ? 'up' : 'down'
    const keyword = [...positives, ...negatives].find(k => msg.startsWith(k)) ?? ''
    comment = message.slice(keyword.length).trim() || null
  }

  // ── Parse stars ───────────────────────────────────────────
  if (feedbackType === 'stars') {
    const num = parseInt(msg.charAt(0))
    if (isNaN(num) || num < 1 || num > 5) return FEEDBACK_MSG.invalid(lang, 'stars')
    starsValue = num
    comment    = message.slice(1).trim() || null
  }

  // ── Claude analysis ───────────────────────────────────────
  const analysis = await analyzeFeedback({
    comment, starsValue, thumbsValue,
    flowType: data.flowType, persona: data.persona, language: lang,
  })

  // ── Save to Supabase ──────────────────────────────────────
  await supabase.from('conversation_feedback').insert({
    conversation_id:   phone + '_' + data.sentAt,
    phone_number:      phone,
    persona:           data.persona,
    language:          lang,
    division:          ctx.division,
    channel:           data.channel,
    rating_type:       feedbackType,
    thumbs_value:      thumbsValue,
    stars_value:       starsValue,
    comment,
    flow_type:         data.flowType,
    handled_by:        'ai',
    ai_sentiment:      analysis.sentiment,
    ai_tags:           analysis.tags,
    ai_improvement:    analysis.improvement,
    reviewed_by_staff: false,
    created_at:        new Date().toISOString(),
  })

  // ── Auto-ticket for low ratings ───────────────────────────
  const isNegative =
    (starsValue !== null && starsValue <= 2) || thumbsValue === 'down'

  if (isNegative) {
    await supabase.from('board_tickets').insert({
      ticket_type:    'feedback_review',
      subject:        `⚠️ Low Rating — ${data.flowType.replace(/_/g, ' ')} (${starsValue ? starsValue + '★' : '👎'})`,
      description:    `Phone: ${phone}\nPersona: ${data.persona}\nFlow: ${data.flowType}\nComment: ${comment ?? 'None'}\nAI Suggestion: ${analysis.improvement}`,
      priority:       starsValue === 1 ? 'urgent' : 'high',
      status:         'open',
      channel_source: 'feedback',
      created_at:     new Date().toISOString(),
    })

    // Immediate email for 1-star ratings
    if (starsValue === 1) {
      await notifyTeamByEmail(
        process.env.STAFF_EMAIL!,
        `🚨 1-Star Rating — ${data.flowType.replace(/_/g, ' ')} — immediate review needed`,
        `Contact: ${phone}\nPersona: ${data.persona}\nComment: ${comment ?? 'None'}\nAI: ${analysis.improvement}`
      )
    }
  }

  await clearConversationState(phone)
  return FEEDBACK_MSG.thanks(lang, starsValue)
}

// ============================================================
// CLAUDE AI — feedback analysis
// ============================================================

async function analyzeFeedback(params: {
  comment:     string | null
  starsValue:  number | null
  thumbsValue: 'up' | 'down' | null
  flowType:    string
  persona:     string
  language:    string
}): Promise<{ sentiment: string; tags: string[]; improvement: string }> {

  if (!params.comment && !params.starsValue) {
    return {
      sentiment:   params.thumbsValue === 'up' ? 'positive' : 'negative',
      tags:        [],
      improvement: '',
    }
  }

  const ratingStr = params.starsValue
    ? `${params.starsValue}/5 stars`
    : params.thumbsValue === 'up' ? 'thumbs up' : 'thumbs down'

  const prompt = `Analyze this property management support feedback. Return ONLY valid JSON, no markdown.

Flow: ${params.flowType} | Persona: ${params.persona} | Rating: ${ratingStr}
Comment: "${params.comment ?? 'no comment'}"

{
  "sentiment": "positive" | "neutral" | "negative",
  "tags": ["tag1","tag2"],
  "improvement": "one concise actionable sentence"
}

Tags only from: slow_response, wrong_information, language_barrier, very_helpful, fast_resolution,
unclear_instructions, payment_issue, escalation_needed, great_ai_response, needs_human_agent,
follow_up_missing, resolved_well, friendly_tone, confusing_menu, technical_issue`

  try {
    const res  = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    return JSON.parse(data.content?.[0]?.text?.replace(/```json|```/g, '').trim() ?? '{}')
  } catch {
    return {
      sentiment:   params.starsValue && params.starsValue >= 4 ? 'positive' : 'negative',
      tags:        [],
      improvement: 'Review this interaction for potential improvements.',
    }
  }
}

// ============================================================
// PERSONA & CONTEXT BUILDER
// ============================================================

async function buildCallerContext(phone: string, channel: Channel): Promise<CallerContext> {

  const { data: o } = await supabase.from('owners')
    .select('first_name, last_name, language, unit_number, association_id')
    .or(`phone.eq.${phone},phone_2.eq.${phone}`).single()
  if (o) return { phone, channel, division: 'association', persona: 'homeowner',
    language: o.language ?? 'en', name: `${o.first_name} ${o.last_name}`,
    unitId: o.unit_number, associationId: o.association_id }

  const { data: t } = await supabase.from('association_tenants')
    .select('first_name, last_name, language, unit_number, association_id')
    .or(`phone.eq.${phone},phone_2.eq.${phone}`).single()
  if (t) return { phone, channel, division: 'association', persona: 'association_tenant',
    language: t.language ?? 'en', name: `${t.first_name} ${t.last_name}`,
    unitId: t.unit_number, associationId: t.association_id }

  const { data: b } = await supabase.from('board_members')
    .select('first_name, last_name, language, association_id')
    .or(`phone.eq.${phone},phone_2.eq.${phone}`).single()
  if (b) return { phone, channel, division: 'association', persona: 'board_member',
    language: b.language ?? 'en', name: `${b.first_name} ${b.last_name}`,
    associationId: b.association_id }

  const { data: v } = await supabase.from('vendor_directory')
    .select('name, language, association_id').eq('phone', phone).single()
  if (v) return { phone, channel, division: 'association', persona: 'vendor',
    language: v.language ?? 'en', name: v.name, associationId: v.association_id }

  // ── 5. Check Real Estate Agents ───────────────────────────
  const { data: ag } = await supabase.from('real_estate_agents')
    .select('id, first_name, last_name, language')
    .eq('phone', phone).single()
  if (ag) return { phone, channel, division: 'association', persona: 'real_estate_agent',
    language: ag.language ?? 'en', name: `${ag.first_name} ${ag.last_name}` }

  const rv = await lookupRentvineByPhone(phone)
  if (rv) return { phone, channel, division: 'residential',
    persona: rv.type, language: 'pt', name: rv.name, rentvineContactId: rv.id }

  return { phone, channel, division: 'unknown', persona: 'unknown', language: 'en', name: 'there' }
}

// ============================================================
// RENTVINE API LOOKUP
// ============================================================

async function lookupRentvineByPhone(phone: string): Promise<{
  id: string; name: string; type: PersonaType
} | null> {
  const creds = Buffer.from(`${process.env.RENTVINE_ACCESS_KEY}:${process.env.RENTVINE_SECRET}`).toString('base64')
  const h     = { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' }
  const clean = (p: string) => p.replace(/\D/g, '')
  try {
    for (const [ep, type] of [
      ['contacts/owners',  'residential_owner'],
      ['contacts/tenants', 'residential_tenant'],
      ['contacts/vendors', 'residential_vendor'],
    ] as [string, PersonaType][]) {
      const res   = await fetch(`${process.env.RENTVINE_BASE_URL}/${ep}`, { headers: h })
      const json  = await res.json()
      const match = json?.data?.find((c: { phone?: string; name: string; contactID: number }) =>
        clean(c.phone ?? '') === clean(phone))
      if (match) return { id: String(match.contactID), name: match.name, type }
    }
  } catch (err) { console.error('[RENTVINE]', err) }
  return null
}

// ============================================================
// MENU DETECTION
// ============================================================

function detectMenuTrigger(message: string): string | null {
  const m = message.trim().toLowerCase()
  const greetings = ['hi','hello','hola','oi','olá','hey','menu','start','0','bom dia','buenos dias','good morning']
  if (greetings.includes(m)) return 'main_menu'
  return ({ '1':'parking_sticker','2':'maintenance','3':'payment',
    '4':'documents','5':'schedule','6':'my_account','7':'emergency','8':'staff',
    '9':'agent_portal',
  } as Record<string,string>)[m] ?? null
}

// ============================================================
// MENU HANDLER
// ============================================================

async function handleMenuOption(ctx: CallerContext, option: string): Promise<string> {
  // ── Known RE agents always go straight to agent portal ───
  if (ctx.persona === 'real_estate_agent' && option === 'main_menu') {
    return startAgentFlow(ctx)
  }

  if (option === 'main_menu') return buildMainMenu(ctx)

  await saveConversationState(ctx.phone, option, 'start', {})
  const { language: lang } = ctx

  switch (option) {
    case 'parking_sticker':
      return translate(lang, {
        en: `🚗 *Parking Sticker*\n\n1 - Check my sticker status\n2 - Register a new vehicle\n3 - Request a new sticker\n\nReply with a number.`,
        es: `🚗 *Calcomanía*\n\n1 - Ver estado\n2 - Registrar vehículo\n3 - Solicitar calcomanía`,
        pt: `🚗 *Adesivo*\n\n1 - Ver status\n2 - Registrar veículo\n3 - Solicitar adesivo`,
      })

    case 'maintenance':
      if (ctx.division === 'residential') {
        await saveConversationState(ctx.phone, 'maintenance_rentvine', 'awaiting_description', {})
        return translate(lang, {
          en: `🔧 *Maintenance Request*\n\nDescribe the issue in your unit.`,
          es: `🔧 Describe el problema en tu unidad.`,
          pt: `🔧 Descreva o problema na sua unidade.`,
        })
      }
      await saveConversationState(ctx.phone, 'maintenance_association', 'awaiting_description', {})
      return translate(lang, {
        en: `🔧 *Maintenance Request*\n\nDescribe the issue. Include unit number if not yet verified.`,
        es: `🔧 Describe el problema e incluye tu número de unidad.`,
        pt: `🔧 Descreva o problema e inclua o número da unidade.`,
      })

    case 'payment':
      return await handlePaymentInquiry(ctx)

    case 'documents':
      await saveConversationState(ctx.phone, 'documents', 'awaiting_question', { msgCount: 0 })
      return translate(lang, {
        en: `📄 *Documents & Lease Info*\n\nWhat would you like to know? Ask about your lease, rules, or policies.`,
        es: `📄 ¿Qué deseas saber? Contrato, reglamento o políticas.`,
        pt: `📄 O que deseja saber? Contrato, regras ou políticas.`,
      })

    case 'schedule':
      await saveConversationState(ctx.phone, 'schedule', 'awaiting_type', {})
      return translate(lang, {
        en: `📅 *Schedule Appointment*\n\n1 - Unit inspection\n2 - Move-in walkthrough\n3 - Meeting with management\n4 - Other`,
        es: `📅 *Agendar Cita*\n\n1 - Inspección  2 - Recorrido  3 - Reunión  4 - Otro`,
        pt: `📅 *Agendar Visita*\n\n1 - Inspeção  2 - Vistoria  3 - Reunião  4 - Outro`,
      })

    case 'my_account':
      return await handleAccountInfo(ctx)

    case 'emergency':
      await alertEmergencyTeam(ctx)
      return translate(lang, {
        en: `🚨 *EMERGENCY — Maia here*\n\nI've alerted our team right away.\n\nImmediate danger? Please call 911 now.\n📞 Emergency line: ${process.env.EMERGENCY_PHONE}`,
        es: `🚨 *EMERGENCIA — Soy Maia*\n\nYa alerté a nuestro equipo.\n\nPeligro inmediato: llama al 911.\n📞 ${process.env.EMERGENCY_PHONE}`,
        pt: `🚨 *EMERGÊNCIA — Aqui é a Maia*\n\nJá avisei nossa equipe.\n\nPerigo imediato: ligue para o 911.\n📞 ${process.env.EMERGENCY_PHONE}`,
      })

    case 'staff':
      await saveConversationState(ctx.phone, 'staff_handoff', 'waiting', { msgCount: 0 })
      await notifyStaff(ctx, 'Resident requested to speak with staff')
      return translate(lang, {
        en: `💬 Of course! I'm connecting you with our team right now 🌸\n\nExpect a reply within ~2 business hours.\nOr call us: ${process.env.OFFICE_PHONE}`,
        es: `💬 ¡Claro! Te estoy conectando con nuestro equipo ahora 🌸\n\nRespuesta en ~2 horas hábiles.`,
        pt: `💬 Claro! Estou te conectando com nossa equipe agora 🌸\n\nResposta em ~2 horas úteis.`,
      })

    case 'agent_portal':
      return startAgentFlow(ctx)

    default:
      return buildMainMenu(ctx)
  }
}

// ============================================================
// CONTINUE FLOW  — feedback wired at every completion point
// ============================================================

async function continueFlow(
  ctx:     CallerContext,
  state:   ConversationState,
  message: string
): Promise<string> {

  const { current_flow: flow, current_step: step, temporary_data_json: data } = state

  // ── Sticker menu selection ───────────────────────────────
  if (flow === 'parking_sticker') {
    if (message === '1') {
      const status = await getStickerStatus(ctx)
      await clearConversationState(ctx.phone)
      void maybeRequestFeedback(ctx.phone, ctx, 'parking_sticker', ctx.channel)
      return status
    }
    if (message === '2' || message === '3') {
      await saveConversationState(ctx.phone, 'sticker_register', 'awaiting_plate', data)
      return translate(ctx.language, {
        en: `Please enter your vehicle's license plate number:`,
        es: `Ingresa el número de placa:`,
        pt: `Informe a placa do veículo:`,
      })
    }
  }

  // ── Sticker registration ─────────────────────────────────
  if (flow === 'sticker_register') {
    if (step === 'awaiting_plate') {
      await saveConversationState(ctx.phone, 'sticker_register', 'awaiting_make',
        { ...data, plate: message.toUpperCase() })
      return translate(ctx.language, {
        en: `Vehicle make (e.g. Toyota):`, es: `Marca (ej. Toyota):`, pt: `Marca (ex: Toyota):` })
    }
    if (step === 'awaiting_make') {
      await saveConversationState(ctx.phone, 'sticker_register', 'awaiting_model',
        { ...data, make: message })
      return translate(ctx.language, {
        en: `Model (e.g. Corolla):`, es: `Modelo (ej. Corolla):`, pt: `Modelo (ex: Corolla):` })
    }
    if (step === 'awaiting_model') {
      await saveConversationState(ctx.phone, 'sticker_register', 'awaiting_color',
        { ...data, model: message })
      return translate(ctx.language, {
        en: `Vehicle color:`, es: `Color del vehículo:`, pt: `Cor do veículo:` })
    }
    if (step === 'awaiting_color') {
      const vehicle = { ...data, color: message } as Record<string, string>
      await createStickerRequest(ctx, vehicle as Record<string, string>)
      await clearConversationState(ctx.phone)
      // ✅ FEEDBACK — sticker registered
      void maybeRequestFeedback(ctx.phone, ctx, 'sticker_register', ctx.channel)
      return translate(ctx.language, {
        en: `✅ Sticker request submitted!\n\n${vehicle.make} ${vehicle.model} (${vehicle.color})\nPlate: ${vehicle.plate}\n\nPayment link coming shortly.`,
        es: `✅ ¡Solicitud enviada!\n\n${vehicle.make} ${vehicle.model} (${vehicle.color}) — Placa: ${vehicle.plate}`,
        pt: `✅ Solicitação enviada!\n\n${vehicle.make} ${vehicle.model} (${vehicle.color}) — Placa: ${vehicle.plate}`,
      })
    }
  }

  // ── Maintenance — Rentvine ───────────────────────────────
  if (flow === 'maintenance_rentvine' && step === 'awaiting_description') {
    const workOrderId = await createRentvineWorkOrder(ctx, message)
    await clearConversationState(ctx.phone)
    // ✅ FEEDBACK — maintenance submitted
    void maybeRequestFeedback(ctx.phone, ctx, 'maintenance_rentvine', ctx.channel)
    return translate(ctx.language, {
      en: `✅ Maintenance submitted!\n\nWork Order #${workOrderId}\n"${message}"\n\nOur team will contact you to schedule.`,
      es: `✅ ¡Solicitud enviada!\n\nOrden #${workOrderId}: "${message}"`,
      pt: `✅ Solicitação enviada!\n\nOrdem #${workOrderId}: "${message}"`,
    })
  }

  // ── Maintenance — Association ────────────────────────────
  if (flow === 'maintenance_association' && step === 'awaiting_description') {
    await createAssociationMaintenanceRequest(ctx, message)
    await clearConversationState(ctx.phone)
    // ✅ FEEDBACK — maintenance submitted
    void maybeRequestFeedback(ctx.phone, ctx, 'maintenance_association', ctx.channel)
    return translate(ctx.language, {
      en: `✅ Maintenance request received!\n\n"${message}"\n\nForwarded to our maintenance team. You'll receive updates here.`,
      es: `✅ ¡Solicitud recibida!\n\n"${message}"\n\nEnviada al equipo de mantenimiento.`,
      pt: `✅ Solicitação recebida!\n\n"${message}"\n\nEncaminhada para a equipe de manutenção.`,
    })
  }

  // ── Documents Q&A ────────────────────────────────────────
  if (flow === 'documents' && step === 'awaiting_question') {
    const answer   = await getAIResponse(ctx, message, 'documents')
    const msgCount = ((data.msgCount as number) ?? 0) + 1

    if (msgCount >= 3) {
      // ✅ FEEDBACK — extended document session ends
      void maybeRequestFeedback(ctx.phone, ctx, 'documents', ctx.channel)
      await clearConversationState(ctx.phone)
      return answer + translate(ctx.language, {
        en: `\n\n_Reply *menu* for more options._`,
        es: `\n\n_Escribe *menú* para más opciones._`,
        pt: `\n\n_Escreva *menu* para mais opções._`,
      })
    }

    await saveConversationState(ctx.phone, 'documents', 'awaiting_question', { msgCount })
    return answer + translate(ctx.language, {
      en: `\n\n📄 Ask another question or reply *menu* to go back.`,
      es: `\n\n📄 Haz otra pregunta o escribe *menú* para volver.`,
      pt: `\n\n📄 Faça outra pergunta ou escreva *menu* para voltar.`,
    })
  }

  // ── Schedule appointment ─────────────────────────────────
  if (flow === 'schedule' && step === 'awaiting_type') {
    const types: Record<string, string> = {
      '1': 'unit inspection', '2': 'move-in walkthrough',
      '3': 'management meeting', '4': 'other appointment',
    }
    const apptType = types[message] ?? 'appointment'
    await notifyStaff(ctx, `Appointment request: ${apptType}`)
    await clearConversationState(ctx.phone)
    // ✅ FEEDBACK — appointment scheduled
    void maybeRequestFeedback(ctx.phone, ctx, 'schedule', ctx.channel)
    return translate(ctx.language, {
      en: `📅 Your ${apptType} request has been sent to our team. We'll confirm date and time shortly.`,
      es: `📅 Solicitud de ${apptType} enviada. Confirmaremos fecha y hora pronto.`,
      pt: `📅 Solicitação de ${apptType} enviada. Confirmaremos data e horário em breve.`,
    })
  }

  // ── Staff handoff ────────────────────────────────────────
  if (flow === 'staff_handoff') {
    const msgCount = ((data.msgCount as number) ?? 0) + 1
    await notifyStaff(ctx, message)

    if (msgCount >= 3) {
      // ✅ FEEDBACK — after extended staff handoff
      void maybeRequestFeedback(ctx.phone, ctx, 'staff_handoff', ctx.channel)
      await clearConversationState(ctx.phone)
    } else {
      await saveConversationState(ctx.phone, 'staff_handoff', 'waiting', { msgCount })
    }

    return translate(ctx.language, {
      en: `✉️ Got it! I've passed your message to our team. They'll be in touch soon 🌸`,
      es: `✉️ ¡Listo! Le pasé tu mensaje al equipo. Te responderán pronto 🌸`,
      pt: `✉️ Pronto! Repassei sua mensagem para a equipe. Eles entrarão em contato em breve 🌸`,
    })
  }

  // Default
  await clearConversationState(ctx.phone)
  return buildMainMenu(ctx)
}

// ============================================================
// AI FREE-FORM RESPONSE
// ============================================================

async function getAIResponse(ctx: CallerContext, message: string, mode = 'general'): Promise<string> {
  const langName = LANGUAGE_NAMES[ctx.language] ?? 'English'
  const system   = mode === 'documents'
    ? `You are Maia, a warm and caring virtual assistant for PMI Top Florida Properties. Respond in ${langName}. Answer questions about leases, rules, and policies concisely. If unsure, warmly offer to connect them with the team.`
    : `You are Maia, a warm and caring virtual assistant for PMI Top Florida Properties, a professional property management company in South Florida. Respond in ${langName}. You are speaking with ${ctx.name}, a ${ctx.persona.replace(/_/g, ' ')}. Be warm, friendly and concise like a helpful neighbor who knows their community. Never say you are an AI unless directly asked.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: message }],
    }),
  })
  const d = await res.json()
  return d.content?.[0]?.text ?? buildMainMenu(ctx)
}

// ============================================================
// PAYMENT INQUIRY
// ============================================================

async function handlePaymentInquiry(ctx: CallerContext): Promise<string> {
  if (ctx.division === 'residential' && ctx.rentvineContactId) {
    try {
      const creds  = Buffer.from(`${process.env.RENTVINE_ACCESS_KEY}:${process.env.RENTVINE_SECRET}`).toString('base64')
      const res    = await fetch(`${process.env.RENTVINE_BASE_URL}/leases/export`,
        { headers: { Authorization: `Basic ${creds}` } })
      const leases = await res.json()
      const lease  = leases?.find((l: {
        lease: { tenants: { contactID: number }[] }
        balances: { unpaidTotalAmount: number; pastDueTotalAmount: number }
      }) => l.lease?.tenants?.some((t: { contactID: number }) =>
        String(t.contactID) === ctx.rentvineContactId))

      if (lease) {
        const { unpaidTotalAmount, pastDueTotalAmount } = lease.balances
        void maybeRequestFeedback(ctx.phone, ctx, 'payment', ctx.channel)
        return translate(ctx.language, {
          en: `💰 *Your Balance*\n\nUnpaid: $${unpaidTotalAmount?.toFixed(2)}\nPast due: $${pastDueTotalAmount?.toFixed(2)}\n\nContact office to pay or reply *menu*.`,
          es: `💰 Pendiente: $${unpaidTotalAmount?.toFixed(2)} — Vencido: $${pastDueTotalAmount?.toFixed(2)}`,
          pt: `💰 Pendente: $${unpaidTotalAmount?.toFixed(2)} — Vencido: $${pastDueTotalAmount?.toFixed(2)}`,
        })
      }
    } catch (err) { console.error('[RENTVINE payment]', err) }
  }

  const { data: req } = await supabase.from('sticker_requests')
    .select('id, status, payment_status').eq('owner_id', ctx.phone)
    .order('created_at', { ascending: false }).limit(1).single()

  void maybeRequestFeedback(ctx.phone, ctx, 'payment', ctx.channel)

  if (req) return translate(ctx.language, {
    en: `💰 Request ${req.id.slice(0, 8)} — ${req.status} — Payment: ${req.payment_status}\n\nReply *menu* for options.`,
    es: `💰 Solicitud ${req.id.slice(0, 8)} — ${req.status} — Pago: ${req.payment_status}`,
    pt: `💰 Solicitação ${req.id.slice(0, 8)} — ${req.status} — Pagamento: ${req.payment_status}`,
  })

  return translate(ctx.language, {
    en: `💰 No open balance found. Reply *8* to speak with our team.`,
    es: `💰 Sin saldo pendiente. Responde *8* para contactarnos.`,
    pt: `💰 Nenhum saldo pendente. Responda *8* para falar conosco.`,
  })
}

// ============================================================
// ACCOUNT INFO
// ============================================================

async function handleAccountInfo(ctx: CallerContext): Promise<string> {
  const [{ data: reqs }, { data: vehicles }] = await Promise.all([
    supabase.from('sticker_requests').select('id, status').eq('owner_id', ctx.phone)
      .order('created_at', { ascending: false }).limit(3),
    supabase.from('vehicles').select('make, model, plate').eq('owner_id', ctx.phone).eq('active', true),
  ])
  const vList = vehicles?.map(v => `• ${v.make} ${v.model} — ${v.plate}`).join('\n') ?? 'None registered'
  const rList = reqs?.map(r => `• ${r.id.slice(0, 8)} — ${r.status}`).join('\n') ?? 'None'
  return translate(ctx.language, {
    en: `🏠 *Your Account*\n\nUnit: ${ctx.unitId ?? 'N/A'}\n\nVehicles:\n${vList}\n\nRequests:\n${rList}`,
    es: `🏠 *Tu Cuenta*\n\nUnidad: ${ctx.unitId}\n\nVehículos:\n${vList}`,
    pt: `🏠 *Sua Conta*\n\nUnidade: ${ctx.unitId}\n\nVeículos:\n${vList}`,
  })
}

// ============================================================
// REAL ESTATE AGENT FLOW
// ============================================================

// ── Agent messages (6 languages) ────────────────────────────
const AGENT_MSG = {

  identify: (lang: string, name: string): string => ({
    en: `👋 Hello ${name}! Welcome to our Real Estate Agent portal.\n\nWho do you represent in this transaction?\n\n1 - 🏠 Owner / Seller\n2 - 🔑 Buyer\n3 - 📋 Tenant / Renter`,
    es: `👋 ¡Hola ${name}! Bienvenido al portal de Agentes Inmobiliarios.\n\n¿A quién representa?\n\n1 - 🏠 Propietario / Vendedor\n2 - 🔑 Comprador\n3 - 📋 Inquilino / Arrendatario`,
    pt: `👋 Olá ${name}! Bem-vindo ao portal de Corretores.\n\nQuem você representa?\n\n1 - 🏠 Proprietário / Vendedor\n2 - 🔑 Comprador\n3 - 📋 Inquilino / Locatário`,
    fr: `👋 Bonjour ${name}! Bienvenue sur le portail Agent Immobilier.\n\nQui représentez-vous?\n\n1 - 🏠 Propriétaire\n2 - 🔑 Acheteur\n3 - 📋 Locataire`,
    he: `👋 שלום ${name}! ברוך הבא לפורטל סוכני הנדל"ן.\n\nאת מי אתה מייצג?\n\n1 - 🏠 בעלים / מוכר\n2 - 🔑 קונה\n3 - 📋 שוכר`,
    ru: `👋 Здравствуйте, ${name}! Добро пожаловать на портал агентов.\n\nКого вы представляете?\n\n1 - 🏠 Владелец / Продавец\n2 - 🔑 Покупатель\n3 - 📋 Арендатор`,
  } as Record<string,string>)[lang] ?? `Who do you represent? Reply 1 (Owner), 2 (Buyer), or 3 (Tenant).`,

  ownerSelected: (lang: string): string => ({
    en: `🏠 *Owner / Seller Representation*\n\nTo proceed as listing agent, we require your signed listing agreement.\n\n📎 Upload securely at:\n${process.env.NEXT_PUBLIC_URL}/agents/upload\n\nOr reply with the unit/property address to begin.`,
    es: `🏠 *Representación del Propietario*\n\nNecesitamos el acuerdo de listado firmado.\n\n📎 Súbelo en:\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
    pt: `🏠 *Representação do Proprietário*\n\nPrecisamos do contrato de listagem assinado.\n\n📎 Envie em:\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
    fr: `🏠 *Représentation du Propriétaire*\n\nNous avons besoin de votre contrat de mandat signé.\n\n📎 Téléchargez sur:\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
    he: `🏠 *ייצוג בעלים*\n\nנדרש הסכם הרישום החתום.\n\n📎 העלה ב:\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
    ru: `🏠 *Представление владельца*\n\nТребуется подписанное соглашение о листинге.\n\n📎 Загрузите по адресу:\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
  } as Record<string,string>)[lang] ?? `Please upload your listing agreement at ${process.env.NEXT_PUBLIC_URL}/agents/upload`,

  buyerSelected: (lang: string): string => ({
    en: `🔑 *Buyer Representation*\n\nPlease provide:\n• Buyer's full name\n• Unit or property of interest\n• What you need (forms, HOA docs, showing, procedures)\n\nOr complete your request at:\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
    es: `🔑 *Representación del Comprador*\n\nProporcione:\n• Nombre del comprador\n• Unidad de interés\n• Qué necesita\n\nO visita:\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
    pt: `🔑 *Representação do Comprador*\n\nInforme:\n• Nome do comprador\n• Unidade de interesse\n• O que você precisa\n\nOu acesse:\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
    fr: `🔑 *Représentation de l'Acheteur*\n\nFournissez:\n• Nom de l'acheteur\n• Unité souhaitée\n• Ce dont vous avez besoin\n\nOu visitez:\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
    he: `🔑 *ייצוג קונה*\n\nספק:\n• שם הקונה\n• יחידה מבוקשת\n• מה אתה צריך`,
    ru: `🔑 *Представление покупателя*\n\nПредоставьте:\n• Имя покупателя\n• Интересующий объект\n• Что вам нужно`,
  } as Record<string,string>)[lang] ?? `Please provide buyer details at ${process.env.NEXT_PUBLIC_URL}/agents/upload`,

  tenantSelected: (lang: string): string => ({
    en: `📋 *Tenant Representation*\n\nPlease provide:\n• Tenant's full name\n• Unit of interest\n• What you need (application forms, approval process, procedures)\n\nOr complete your request at:\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
    es: `📋 *Representación del Inquilino*\n\nProporcione:\n• Nombre del inquilino\n• Unidad de interés\n• Qué necesita\n\nO visita:\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
    pt: `📋 *Representação do Inquilino*\n\nInforme:\n• Nome do inquilino\n• Unidade de interesse\n• O que você precisa\n\nOu acesse:\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
    fr: `📋 *Représentation du Locataire*\n\nFournissez:\n• Nom du locataire\n• Unité souhaitée\n• Ce dont vous avez besoin`,
    he: `📋 *ייצוג שוכר*\n\nספק:\n• שם השוכר\n• יחידה מבוקשת\n• מה אתה צריך`,
    ru: `📋 *Представление арендатора*\n\nПредоставьте:\n• Имя арендатора\n• Интересующий объект\n• Что вам нужно`,
  } as Record<string,string>)[lang] ?? `Please provide tenant details at ${process.env.NEXT_PUBLIC_URL}/agents/upload`,

  notRegistered: (lang: string): string => ({
    en: `👤 We don't have your number on file as a registered agent yet.\n\nPlease register at:\n🔗 ${process.env.NEXT_PUBLIC_URL}/agents/register\n\nOr reply with your full name, license number, and brokerage.`,
    es: `👤 Tu número no está registrado como agente.\n\nRegístrate en:\n🔗 ${process.env.NEXT_PUBLIC_URL}/agents/register`,
    pt: `👤 Seu número não está cadastrado como corretor.\n\nCadastre-se em:\n🔗 ${process.env.NEXT_PUBLIC_URL}/agents/register`,
    fr: `👤 Votre numéro n'est pas enregistré comme agent.\n\nInscrivez-vous sur:\n🔗 ${process.env.NEXT_PUBLIC_URL}/agents/register`,
    he: `👤 מספרך לא רשום כסוכן. הירשם ב:\n🔗 ${process.env.NEXT_PUBLIC_URL}/agents/register`,
    ru: `👤 Ваш номер не зарегистрирован как агент. Зарегистрируйтесь:\n🔗 ${process.env.NEXT_PUBLIC_URL}/agents/register`,
  } as Record<string,string>)[lang] ?? `Please register at ${process.env.NEXT_PUBLIC_URL}/agents/register`,

  uploadReminder: (lang: string, name: string): string => ({
    en: `📎 Hi ${name}, we're still waiting for your listing agreement.\n\nUpload it here:\n${process.env.NEXT_PUBLIC_URL}/agents/upload\n\nYour request cannot proceed without it.`,
    es: `📎 Hola ${name}, aún esperamos el acuerdo de listado.\n\nSúbelo aquí:\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
    pt: `📎 Olá ${name}, ainda aguardamos o contrato de listagem.\n\nEnvie aqui:\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
    fr: `📎 Bonjour ${name}, nous attendons votre contrat de mandat.\n\nTéléchargez-le:\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
    he: `📎 שלום ${name}, אנחנו עדיין מחכים להסכם הרישום.\n\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
    ru: `📎 Здравствуйте, ${name}. Ожидаем соглашение о листинге.\n\n${process.env.NEXT_PUBLIC_URL}/agents/upload`,
  } as Record<string,string>)[lang] ?? `Please upload your listing agreement.`,

  requestLogged: (lang: string, reqId: string): string => ({
    en: `✅ Request logged!\n\nRef: ${reqId.slice(0,8)}\n\nOur team will send you the relevant forms and procedures within 1 business day.\n\nReply *menu* for other options.`,
    es: `✅ ¡Solicitud registrada!\n\nRef: ${reqId.slice(0,8)}\n\nNuestro equipo te enviará los formularios en 1 día hábil.`,
    pt: `✅ Solicitação registrada!\n\nRef: ${reqId.slice(0,8)}\n\nNossa equipe enviará os formulários em 1 dia útil.`,
    fr: `✅ Demande enregistrée! Réf: ${reqId.slice(0,8)}\n\nNotre équipe vous enverra les formulaires sous 1 jour ouvrable.`,
    he: `✅ הבקשה נרשמה! מזהה: ${reqId.slice(0,8)}\n\nהצוות יישלח את הטפסים תוך יום עסקים.`,
    ru: `✅ Запрос зарегистрирован! Реф: ${reqId.slice(0,8)}\n\nКоманда отправит формы в течение 1 рабочего дня.`,
  } as Record<string,string>)[lang] ?? `✅ Request logged. We'll be in touch within 1 business day.`,

  agreementReceived: (lang: string): string => ({
    en: `✅ Thank you! Your listing agreement has been received and is under review.\n\nOur team will confirm within 1 business day.`,
    es: `✅ ¡Gracias! El acuerdo de listado fue recibido y está en revisión.\n\nConfirmaremos en 1 día hábil.`,
    pt: `✅ Obrigado! O contrato de listagem foi recebido e está em análise.\n\nConfirmaremos em 1 dia útil.`,
    fr: `✅ Merci! Votre contrat de mandat a été reçu et est en cours d'examen.`,
    he: `✅ תודה! הסכם הרישום התקבל ונמצא בבדיקה.`,
    ru: `✅ Спасибо! Соглашение о листинге получено и находится на рассмотрении.`,
  } as Record<string,string>)[lang] ?? `✅ Listing agreement received. Under review.`,
}

// ── Start agent flow — entry point ───────────────────────────
async function startAgentFlow(ctx: CallerContext): Promise<string> {
  const lang = ctx.language
  const firstName = ctx.name !== 'there' ? ctx.name.split(' ')[0] : ''

  // Unknown contact texting in — not registered yet
  if (ctx.persona !== 'real_estate_agent') {
    return AGENT_MSG.notRegistered(lang)
  }

  // Known agent — ask who they represent
  await saveConversationState(ctx.phone, 'agent_identification', 'awaiting_representation', {
    lang, agentName: firstName,
  })

  return AGENT_MSG.identify(lang, firstName)
}

// ── Continue agent flow — processes their replies ────────────
async function continueAgentFlow(
  ctx:     CallerContext,
  state:   ConversationState,
  message: string
): Promise<string> {

  const { current_step: step, temporary_data_json: data } = state
  const lang      = (data.lang as string) ?? ctx.language
  const agentName = (data.agentName as string) ?? ctx.name.split(' ')[0]
  const msg       = message.trim()

  // ── Step 1: Which side? ──────────────────────────────────
  if (step === 'awaiting_representation') {

    if (msg === '1') {
      // Owner → create request, require listing agreement upload
      const { data: req } = await supabase
        .from('agent_requests')
        .insert({
          agent_id:            await getAgentId(ctx.phone),
          representation_type: 'owner',
          status:              'awaiting_documents',
          channel:             ctx.channel,
          created_at:          new Date().toISOString(),
        })
        .select('id').single()

      await saveConversationState(ctx.phone, 'agent_identification', 'awaiting_address', {
        lang, agentName, repType: 'owner', requestId: req?.id,
      })

      await notifyAgentTeam(ctx, 'owner', req?.id ?? '')
      return AGENT_MSG.ownerSelected(lang)
    }

    if (msg === '2') {
      // Buyer → collect details
      const { data: req } = await supabase
        .from('agent_requests')
        .insert({
          agent_id:            await getAgentId(ctx.phone),
          representation_type: 'buyer',
          status:              'new',
          channel:             ctx.channel,
          created_at:          new Date().toISOString(),
        })
        .select('id').single()

      await saveConversationState(ctx.phone, 'agent_identification', 'awaiting_buyer_details', {
        lang, agentName, repType: 'buyer', requestId: req?.id,
      })

      await notifyAgentTeam(ctx, 'buyer', req?.id ?? '')
      return AGENT_MSG.buyerSelected(lang)
    }

    if (msg === '3') {
      // Tenant → collect details
      const { data: req } = await supabase
        .from('agent_requests')
        .insert({
          agent_id:            await getAgentId(ctx.phone),
          representation_type: 'tenant',
          status:              'new',
          channel:             ctx.channel,
          created_at:          new Date().toISOString(),
        })
        .select('id').single()

      await saveConversationState(ctx.phone, 'agent_identification', 'awaiting_tenant_details', {
        lang, agentName, repType: 'tenant', requestId: req?.id,
      })

      await notifyAgentTeam(ctx, 'tenant', req?.id ?? '')
      return AGENT_MSG.tenantSelected(lang)
    }

    // Invalid choice — re-prompt
    return AGENT_MSG.identify(lang, agentName)
  }

  // ── Step 2a: Owner — collect property address ────────────
  if (step === 'awaiting_address' && (data.repType as string) === 'owner') {
    // Save the address they typed
    await supabase.from('agent_requests')
      .update({ property_address: msg })
      .eq('id', data.requestId)

    // Check if they already uploaded (web portal may have fired first)
    const { data: req } = await supabase
      .from('agent_requests')
      .select('listing_agreement_status')
      .eq('id', data.requestId)
      .single()

    if (req?.listing_agreement_status === 'uploaded' ||
        req?.listing_agreement_status === 'approved') {
      await clearConversationState(ctx.phone)
      void maybeRequestFeedback(ctx.phone, ctx, 'agent_identification', ctx.channel)
      return AGENT_MSG.agreementReceived(lang)
    }

    // Still pending upload
    await saveConversationState(ctx.phone, 'agent_identification', 'awaiting_listing_upload', {
      ...data, propertyAddress: msg,
    })
    return AGENT_MSG.uploadReminder(lang, agentName)
  }

  // ── Step 2b: Awaiting listing upload confirmation ────────
  if (step === 'awaiting_listing_upload') {
    const { data: req } = await supabase
      .from('agent_requests')
      .select('listing_agreement_status')
      .eq('id', data.requestId)
      .single()

    if (req?.listing_agreement_status === 'uploaded' ||
        req?.listing_agreement_status === 'approved') {
      await clearConversationState(ctx.phone)
      void maybeRequestFeedback(ctx.phone, ctx, 'agent_identification', ctx.channel)
      return AGENT_MSG.agreementReceived(lang)
    }

    // Still not uploaded — resend link
    return AGENT_MSG.uploadReminder(lang, agentName)
  }

  // ── Step 3a: Buyer details collected ────────────────────
  if (step === 'awaiting_buyer_details') {
    await supabase.from('agent_requests')
      .update({ request_notes: msg, status: 'documents_received' })
      .eq('id', data.requestId)

    await clearConversationState(ctx.phone)
    void maybeRequestFeedback(ctx.phone, ctx, 'agent_identification', ctx.channel)
    return AGENT_MSG.requestLogged(lang, data.requestId as string)
  }

  // ── Step 3b: Tenant details collected ───────────────────
  if (step === 'awaiting_tenant_details') {
    await supabase.from('agent_requests')
      .update({ request_notes: msg, status: 'documents_received' })
      .eq('id', data.requestId)

    await clearConversationState(ctx.phone)
    void maybeRequestFeedback(ctx.phone, ctx, 'agent_identification', ctx.channel)
    return AGENT_MSG.requestLogged(lang, data.requestId as string)
  }

  // Default — restart
  await clearConversationState(ctx.phone)
  return startAgentFlow(ctx)
}

// ── Helper: get agent UUID from phone ────────────────────────
async function getAgentId(phone: string): Promise<string | null> {
  const { data } = await supabase
    .from('real_estate_agents')
    .select('id')
    .eq('phone', phone)
    .single()
  return data?.id ?? null
}

// ── Notify leasing team of new agent request ─────────────────
async function notifyAgentTeam(
  ctx:     CallerContext,
  repType: string,
  reqId:   string
): Promise<void> {
  const labels: Record<string,string> = {
    owner: 'Owner / Listing Agent', buyer: 'Buyer Agent', tenant: 'Tenant Agent',
  }
  await notifyTeamByEmail(
    process.env.LEASING_EMAIL!,
    `🏡 Agent Request — ${labels[repType]} — ${ctx.name}`,
    `Agent: ${ctx.name}\nPhone: ${ctx.phone}\nRepresenting: ${labels[repType]}\nRequest ID: ${reqId}\n\nView:\n${process.env.NEXT_PUBLIC_URL}/admin/agents/${reqId}`
  )
}

// ── Add agent_identification to feedback config ───────────────
// (this extends the existing FEEDBACK_CONFIG object at runtime)
;(FEEDBACK_CONFIG as Record<string,{type:FeedbackType}>)['agent_identification'] = { type: 'stars' }



function buildMainMenu(ctx: CallerContext): string {
  const first = ctx.name !== 'there' ? ` ${ctx.name.split(' ')[0]}` : ''

  // ── Dedicated menu for known real estate agents ───────────
  if (ctx.persona === 'real_estate_agent') {
    return translate(ctx.language, {
      en: `👋 Hi${first}! I'm Maia 🌸 Welcome to the PMI Agent Portal.\n\n1 - 🏠 I represent an Owner / Seller\n2 - 🔑 I represent a Buyer\n3 - 📋 I represent a Tenant / Renter\n8 - 💬 Speak with our team\n\nReply with a number.`,
      es: `👋 ¡Hola${first}! Soy Maia 🌸 Bienvenido al Portal de Agentes PMI.\n\n1 - 🏠 Represento a un Propietario\n2 - 🔑 Represento a un Comprador\n3 - 📋 Represento a un Inquilino\n8 - 💬 Hablar con el equipo`,
      pt: `👋 Olá${first}! Sou a Maia 🌸 Bem-vindo ao Portal de Corretores PMI.\n\n1 - 🏠 Represento um Proprietário\n2 - 🔑 Represento um Comprador\n3 - 📋 Represento um Inquilino\n8 - 💬 Falar com a equipe`,
      fr: `👋 Bonjour${first}! Je suis Maia 🌸 Bienvenue sur le Portail Agent PMI.\n\n1 - 🏠 Je représente un Propriétaire\n2 - 🔑 Je représente un Acheteur\n3 - 📋 Je représente un Locataire\n8 - 💬 Parler à l'équipe`,
      he: `👋 שלום${first}! אני מאיה 🌸 ברוך הבא לפורטל הסוכנים של PMI.\n\n1 - 🏠 אני מייצג בעלים\n2 - 🔑 אני מייצג קונה\n3 - 📋 אני מייצג שוכר\n8 - 💬 דבר עם הצוות`,
      ru: `👋 Привет${first}! Я Мая 🌸 Добро пожаловать на Портал Агентов PMI.\n\n1 - 🏠 Представляю владельца\n2 - 🔑 Представляю покупателя\n3 - 📋 Представляю арендатора\n8 - 💬 Команда`,
    })
  }

  // ── Standard menu for all other personas ─────────────────
  return translate(ctx.language, {
    en: `👋 Hi${first}! I'm Maia, your PMI assistant 🌸\n\n1 - 🚗 Parking Sticker\n2 - 🔧 Maintenance\n3 - 💰 Payment\n4 - 📄 Documents\n5 - 📅 Schedule\n6 - 🏠 My Account\n7 - 🚨 Emergency\n8 - 💬 Staff\n9 - 🏡 Real Estate Agent\n\nReply with a number.`,
    es: `👋 ¡Hola${first}! Soy Maia, tu asistente de PMI 🌸\n\n1 - 🚗 Calcomanía\n2 - 🔧 Mantenimiento\n3 - 💰 Pagos\n4 - 📄 Documentos\n5 - 📅 Cita\n6 - 🏠 Mi Cuenta\n7 - 🚨 Emergencia\n8 - 💬 Equipo\n9 - 🏡 Agente Inmobiliario`,
    pt: `👋 Olá${first}! Sou a Maia, sua assistente da PMI 🌸\n\n1 - 🚗 Adesivo\n2 - 🔧 Manutenção\n3 - 💰 Pagamentos\n4 - 📄 Documentos\n5 - 📅 Agendar\n6 - 🏠 Minha Conta\n7 - 🚨 Emergência\n8 - 💬 Equipe\n9 - 🏡 Corretor Imobiliário`,
    fr: `👋 Bonjour${first}! Je suis Maia, votre assistante PMI 🌸\n\n1 - 🚗 Vignette\n2 - 🔧 Maintenance\n3 - 💰 Paiements\n4 - 📄 Documents\n5 - 📅 Rendez-vous\n6 - 🏠 Mon Compte\n7 - 🚨 Urgence\n8 - 💬 Équipe\n9 - 🏡 Agent Immobilier`,
    he: `👋 שלום${first}! אני מאיה, העוזרת של PMI 🌸\n\n1-🚗 מדבקה  2-🔧 תחזוקה  3-💰 תשלומים\n4-📄 מסמכים  5-📅 פגישה  6-🏠 חשבון\n7-🚨 חירום  8-💬 צוות  9-🏡 סוכן`,
    ru: `👋 Привет${first}! Я Мая, ваш ассистент PMI 🌸\n\n1-🚗 Наклейка  2-🔧 Ремонт  3-💰 Платежи\n4-📄 Документы  5-📅 Запись  6-🏠 Аккаунт\n7-🚨 Экстренно  8-💬 Команда  9-🏡 Агент`,
  })
}

// ============================================================
// SUPABASE HELPERS
// ============================================================

async function getConversationState(phone: string): Promise<ConversationState | null> {
  const { data } = await supabase.from('conversation_state')
    .select('*').eq('phone_number', phone).single()
  return data
}

async function saveConversationState(
  phone: string, flow: string, step: string, tempData: Record<string, unknown>
) {
  await supabase.from('conversation_state').upsert({
    phone_number: phone, current_flow: flow,
    current_step: step, temporary_data_json: tempData,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'phone_number' })
}

async function clearConversationState(phone: string) {
  await supabase.from('conversation_state').upsert({
    phone_number: phone, current_flow: 'idle',
    current_step: 'idle', temporary_data_json: {},
    updated_at: new Date().toISOString(),
  }, { onConflict: 'phone_number' })
}

async function getStickerStatus(ctx: CallerContext): Promise<string> {
  const { data } = await supabase.from('sticker_requests')
    .select('id, status, payment_status').eq('owner_id', ctx.phone)
    .order('created_at', { ascending: false }).limit(1).single()
  if (!data) return translate(ctx.language, {
    en: `No sticker requests found. Reply *1* from the menu to start.`,
    es: `Sin solicitudes. Responde *1* para iniciar.`,
    pt: `Nenhuma solicitação. Responda *1* para iniciar.`,
  })
  return translate(ctx.language, {
    en: `🚗 Request ${data.id.slice(0, 8)} — ${data.status} — Payment: ${data.payment_status}`,
    es: `🚗 Solicitud ${data.id.slice(0, 8)} — ${data.status} — Pago: ${data.payment_status}`,
    pt: `🚗 Solicitação ${data.id.slice(0, 8)} — ${data.status} — Pagamento: ${data.payment_status}`,
  })
}

async function createStickerRequest(ctx: CallerContext, vehicle: Record<string, string>) {
  const { data: v } = await supabase.from('vehicles').upsert({
    owner_id: ctx.phone, make: vehicle.make, model: vehicle.model,
    color: vehicle.color, plate: vehicle.plate, active: true,
  }, { onConflict: 'owner_id,plate' }).select().single()

  await supabase.from('sticker_requests').insert({
    owner_id: ctx.phone, vehicle_id: v?.id,
    association_id: ctx.associationId, request_source: ctx.channel,
    status: 'pending', payment_status: 'unpaid',
    payment_required: true, created_at: new Date().toISOString(),
  })
}

async function createAssociationMaintenanceRequest(ctx: CallerContext, description: string) {
  await supabase.from('maintenance_requests').insert({
    owner_id: ctx.phone, unit_id: ctx.unitId,
    association_id: ctx.associationId, description,
    urgency: description.toLowerCase().includes('emergency') ? 'emergency' : 'medium',
    status: 'open', created_at: new Date().toISOString(),
  })
  await notifyTeamByEmail(
    process.env.MAINTENANCE_EMAIL!,
    `New Maintenance — Unit ${ctx.unitId ?? 'Unknown'}`,
    `From: ${ctx.name} (${ctx.phone})\nUnit: ${ctx.unitId}\nIssue: ${description}`
  )
}

async function createRentvineWorkOrder(ctx: CallerContext, description: string): Promise<string> {
  const creds = Buffer.from(`${process.env.RENTVINE_ACCESS_KEY}:${process.env.RENTVINE_SECRET}`).toString('base64')
  try {
    const res  = await fetch(`${process.env.RENTVINE_BASE_URL}/maintenance/work-orders`, {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        priority:  description.toLowerCase().includes('emergency') ? 'urgent' : 'normal',
        contactID: ctx.rentvineContactId ? parseInt(ctx.rentvineContactId) : undefined,
        source:    ctx.channel,
      }),
    })
    const data = await res.json()
    return data?.workOrderID ? String(data.workOrderID) : 'WO-' + Date.now()
  } catch { return 'WO-' + Date.now() }
}

async function logConversation(phone: string, inbound: string, outbound: string, ctx: CallerContext) {
  await supabase.from('general_conversations').insert({
    owner_id: phone, phone_number: phone, topic: ctx.persona,
    summary: `IN: ${inbound.slice(0, 100)} | OUT: ${outbound.slice(0, 100)}`,
    handled_by: 'ai', channel: ctx.channel,
    created_at: new Date().toISOString(),
  })
}

// ============================================================
// NOTIFICATIONS
// ============================================================

async function notifyStaff(ctx: CallerContext, message: string) {
  await notifyTeamByEmail(
    process.env.STAFF_EMAIL!,
    `Staff Request — ${ctx.persona} (${ctx.name})`,
    `Contact: ${ctx.name}\nPhone: ${ctx.phone}\nChannel: ${ctx.channel}\n\nMessage: ${message}`
  )
}

async function alertEmergencyTeam(ctx: CallerContext) {
  await notifyTeamByEmail(
    process.env.EMERGENCY_EMAIL!,
    `🚨 EMERGENCY — ${ctx.name} Unit ${ctx.unitId ?? 'Unknown'}`,
    `Contact: ${ctx.name}\nPhone: ${ctx.phone}\nUnit: ${ctx.unitId}`
  )
  try {
    await twilioClient.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER!,
      to:   process.env.EMERGENCY_PHONE!,
      body: `🚨 EMERGENCY: ${ctx.name} (${ctx.phone}) Unit ${ctx.unitId ?? 'Unknown'} — respond immediately`,
    })
  } catch (err) { console.error('[EMERGENCY SMS]', err) }
}

async function notifyTeamByEmail(to: string, subject: string, body: string) {
  await fetch(`${process.env.NEXT_PUBLIC_URL}/api/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, body }),
  }).catch(err => console.error('[EMAIL]', err))
}

// ============================================================
// SEND REPLY
// ============================================================

async function sendReply(phone: string, text: string, channel: Channel) {
  const from = channel === 'whatsapp'
    ? `whatsapp:+14155238886`
    : process.env.TWILIO_PHONE_NUMBER!
  const to = channel === 'whatsapp' ? `whatsapp:${phone}` : phone

  if (channel === 'sms' && text.length > 1500) {
    for (const chunk of text.match(/.{1,1500}/g) ?? [text])
      await twilioClient.messages.create({ from, to, body: chunk })
    return
  }
  await twilioClient.messages.create({ from, to, body: text })
}

// ============================================================
// VOICE HELPERS
// ============================================================

async function getVoiceGreeting(ctx: CallerContext): Promise<string> {
  const first = ctx.name !== 'there' ? ctx.name.split(' ')[0] : ''
  return ({
    en: `Hello ${first}! Thank you for calling. How can I help you today?`,
    es: `Hola ${first}! Gracias por llamar. ¿En qué puedo ayudarle?`,
    pt: `Olá ${first}! Obrigado por ligar. Como posso ajudar?`,
    fr: `Bonjour! Merci d'avoir appelé. Comment puis-je vous aider?`,
    he: `שלום! תודה על השיחה. איך אני יכול לעזור?`,
    ru: `Здравствуйте! Спасибо за звонок. Чем могу помочь?`,
  } as Record<string, string>)[ctx.language] ?? `Hello! How can I help?`
}

function getListenPrompt(lang: string): string {
  return ({
    en: 'Please describe how I can help you.',
    es: 'Por favor describa cómo puedo ayudarle.',
    pt: 'Por favor descreva como posso ajudar.',
    fr: 'Veuillez décrire comment je peux vous aider.',
    he: 'אנא תאר כיצד אוכל לעזור לך.',
    ru: 'Пожалуйста, опишите, как я могу вам помочь.',
  } as Record<string, string>)[lang] ?? 'How can I help?'
}

function getVoiceForLanguage(lang: string): string {
  return ({
    en: 'en-US-Neural2-F', es: 'es-US-Neural2-A',
    pt: 'pt-BR-Neural2-A', fr: 'fr-FR-Neural2-A',
    he: 'he-IL-Wavenet-A',  ru: 'ru-RU-Neural2-A',
  } as Record<string, string>)[lang] ?? 'en-US-Neural2-F'
}

// ============================================================
// TRANSLATION HELPER
// ============================================================

function translate(
  language: string,
  options: Partial<Record<'en' | 'es' | 'pt' | 'fr' | 'he' | 'ru', string>>
): string {
  return options[language as keyof typeof options]
    ?? options.en
    ?? Object.values(options)[0]
    ?? ''
}