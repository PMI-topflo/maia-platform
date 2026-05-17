// ============================================================
// app/api/webhook/route.ts
// Unified Twilio Webhook — SMS + WhatsApp + Voice
// Stack: Next.js · Supabase · Claude API · Twilio · Rentvine
// CHANGES vs previous version:
//   FIX 1 — Added GET handler for Meta/Twilio webhook verification
//   FIX 2 — sendReply now uses TWILIO_WHATSAPP_NUMBER env var
//            instead of hardcoded sandbox number +14155238886
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createClient } from '@supabase/supabase-js'
import { findOrCreateTicket, appendMessage, createTicket } from '@/lib/tickets'
import { fetchStaffList, findStaffByPhone } from '@/lib/staff-list'
import { detectAssociationCode } from '@/lib/maia-command-processor'
import { buildSkillsPromptBlock } from '@/lib/skills'
import { buildOfficeHoursBlock } from '@/lib/office-hours'

function getSupabase() {
  const env = process.env;
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  return createClient(url, key);
}
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
)

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
// FEEDBACK TEMPLATES
// ============================================================

const FEEDBACK_MSG = {
  thumbs: (flow: string, lang: string): string => {
    const label = flow.replace(/_/g, ' ')
    return ({
      en: `How was our support with your ${label}?\n\n👍 Reply UP — great\n👎 Reply DOWN — needs improvement\n\nOptional: add a short note after your reply.`,
      es: `¿Cómo fue nuestro apoyo con ${label}?\n\n👍 Responde BIEN — excelente\n👎 Responde MAL — necesita mejorar`,
      pt: `Como foi nosso suporte com ${label}?\n\n👍 Responda BOM — ótimo\n👎 Responda RUIM — precisa melhorar`,
      fr: `Comment s'est passé notre support pour ${label}?\n\n👍 BIEN\n👎 MAL`,
      he: `כיצד היה השירות?\n\n👍 טוב\n👎 רע`,
      ru: `Как вам наша поддержка?\n\n👍 ХОРОШО\n👎 ПЛОХО`,
    } as Record<string, string>)[lang] ?? `Rate our support: reply UP 👍 or DOWN 👎.`
  },

  stars: (flow: string, lang: string): string => {
    const label = flow.replace(/_/g, ' ')
    return ({
      en: `We completed your ${label}. How would you rate our support?\n\n1 ⭐ Very poor\n2 ⭐⭐ Poor\n3 ⭐⭐⭐ OK\n4 ⭐⭐⭐⭐ Good\n5 ⭐⭐⭐⭐⭐ Excellent\n\nReply with a number.`,
      es: `Completamos tu ${label}.\n\n1⭐ Muy malo  2⭐⭐ Malo  3⭐⭐⭐ Regular  4⭐⭐⭐⭐ Bueno  5⭐⭐⭐⭐⭐ Excelente`,
      pt: `Concluímos sua ${label}.\n\n1⭐ Muito ruim  2⭐⭐ Ruim  3⭐⭐⭐ Regular  4⭐⭐⭐⭐ Bom  5⭐⭐⭐⭐⭐ Excelente`,
      fr: `${label} terminé.\n1⭐ Très mauvais  2⭐⭐ Mauvais  3⭐⭐⭐ Correct  4⭐⭐⭐⭐ Bon  5⭐⭐⭐⭐⭐ Excellent`,
      he: `1⭐ גרוע  2⭐⭐ רע  3⭐⭐⭐ בסדר  4⭐⭐⭐⭐ טוב  5⭐⭐⭐⭐⭐ מצוין`,
      ru: `1⭐ Плохо  2⭐⭐ Плохо  3⭐⭐⭐ Нормально  4⭐⭐⭐⭐ Хорошо  5⭐⭐⭐⭐⭐ Отлично`,
    } as Record<string, string>)[lang] ?? `Rate our support 1–5.`
  },

  thanks: (lang: string, score: number | null): string => {
    const good = score === null || score >= 4
    return ({
      en: good ? `🙏 Thank you so much! It was my pleasure to help — Maia 🌸` : `🙏 Thank you for letting us know. I'll make sure the team looks into this. — Maia 🌸`,
      es: good ? `🙏 ¡Muchas gracias! Fue un placer ayudarte — Maia 🌸` : `🙏 Gracias por avisarnos. Me aseguraré de que el equipo lo revise. — Maia 🌸`,
      pt: good ? `🙏 Muito obrigada! Foi um prazer te ajudar — Maia 🌸` : `🙏 Obrigada por nos avisar. Vou garantir que a equipe revise isso. — Maia 🌸`,
      fr: `🙏 Merci beaucoup! — Maia 🌸`,
      he: `🙏 תודה רבה! — מאיה 🌸`,
      ru: `🙏 Спасибо за отзыв!`,
    } as Record<string, string>)[lang] ?? `🙏 Thank you for your feedback!`
  },

  invalid: (lang: string, type: FeedbackType): string => ({
    en: type === 'stars' ? `Please reply with a number from 1 to 5.` : `Please reply UP 👍 or DOWN 👎.`,
    es: type === 'stars' ? `Responde con un número del 1 al 5.` : `Responde BIEN 👍 o MAL 👎.`,
    pt: type === 'stars' ? `Responda com um número de 1 a 5.` : `Responda BOM 👍 ou RUIM 👎.`,
    fr: type === 'stars' ? `Répondez 1 à 5.` : `Répondez BIEN ou MAL.`,
    he: type === 'stars' ? `השב 1 עד 5.` : `השב טוב או רע.`,
    ru: type === 'stars' ? `Ответьте 1–5.` : `Ответьте ХОРОШО или ПЛОХО.`,
  } as Record<string, string>)[lang] ?? (type === 'stars' ? `Reply 1–5.` : `Reply UP or DOWN.`),
}

// ============================================================
// ✅ FIX 1 — GET handler for Meta + Twilio webhook verification
// Without this, Meta's "Verify and save" button stays grayed out
// ============================================================

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  // Meta Cloud API verification handshake
  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('[WEBHOOK] Meta verification successful')
    return new NextResponse(challenge, { status: 200 })
  }

  // Twilio health check (no params) — just return 200
  if (!mode && !token) {
    return new NextResponse('OK', { status: 200 })
  }

  console.warn('[WEBHOOK] Verification failed — token mismatch')
  return new NextResponse('Forbidden', { status: 403 })
}

// ============================================================
// MAIN POST HANDLER
// ============================================================

export async function POST(req: NextRequest) {
  let body: FormData
  try { body = await req.formData() } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  const from:         string  = (body.get('From') as string) ?? ''
  const msgBody:      string  = (body.get('Body') as string) ?? ''
  const callStatus            = body.get('CallStatus') as string | null
  const speechResult          = body.get('SpeechResult') as string | null
  const dtmfDigits            = body.get('Digits') as string | null

  const channel: Channel = from.startsWith('whatsapp:')
    ? 'whatsapp'
    : callStatus !== null
    ? 'voice'
    : 'sms'

  const cleanPhone = from.replace('whatsapp:', '').trim()
  console.log(`[WEBHOOK] ${channel.toUpperCase()} | ${cleanPhone} | "${speechResult ?? dtmfDigits ?? msgBody ?? callStatus}"`)

  try {
    if (channel === 'voice') {
      const voiceInput = speechResult ?? (dtmfDigits ? `DTMF:${dtmfDigits}` : null)
      if (voiceInput) return await handleVoiceInput(cleanPhone, voiceInput)
      return await handleVoice(cleanPhone, body)
    }
    return await handleTextChannel(cleanPhone, msgBody, channel)
  } catch (err) {
    console.error('[WEBHOOK] Unhandled error:', err)
    if (channel === 'voice') {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">I'm sorry, I'm having a technical issue. Please call our office at 3 0 5 9 0 0 5 0 7 7. Thank you.</Say></Response>`
      return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
    }
    // SMS/WhatsApp: try to send a fallback message, then return 200 so Twilio doesn't retry
    try {
      const fallbackFrom = channel === 'whatsapp'
        ? `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`
        : process.env.TWILIO_PHONE_NUMBER!
      const fallbackTo = channel === 'whatsapp' ? `whatsapp:${cleanPhone}` : cleanPhone
      await twilioClient.messages.create({
        from: fallbackFrom, to: fallbackTo,
        body: `I'm having a technical issue right now. Please call (305) 900-5077 or WhatsApp (786) 686-3223 and our team will help you. — Maia 🌸`,
      })
    } catch { /* best-effort — don't cascade */ }
    return NextResponse.json({ status: 'error_handled' })
  }
}

// ============================================================
// VOICE HANDLER
// ============================================================

const VOICE_COMPLETED = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled'])

async function handleVoice(phone: string, body: FormData): Promise<NextResponse> {
  const callStatus = (body.get('CallStatus') as string) ?? ''
  if (VOICE_COMPLETED.has(callStatus)) return new NextResponse('OK')

  const ctx      = await buildCallerContext(phone, 'voice')
  const greeting = await getVoiceGreeting(ctx)
  const voice    = getVoiceForLanguage(ctx.language)
  const twiml    = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${escapeXml(greeting)}</Say>
  <Gather input="speech" speechTimeout="4" action="/api/webhook" method="POST">
    <Say voice="${voice}">${escapeXml(getListenPrompt(ctx.language))}</Say>
  </Gather>
  <Say voice="${voice}">I did not catch that. Please call our office at 3 0 5, 9 0 0, 5 0 7 7. Thank you for calling PMI Top Florida Properties!</Say>
  <Hangup/>
</Response>`
  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

async function handleVoiceInput(phone: string, voiceInput: string): Promise<NextResponse> {
  const ctx   = await buildCallerContext(phone, 'voice')
  const voice = getVoiceForLanguage(ctx.language)
  const state = await getConversationState(phone)

  // ── Resolve pending WhatsApp number ────────────────────────────────────────
  if (state?.current_flow === 'voice_awaiting_whatsapp') {
    return handleVoiceAwaitingWhatsAppNumber(phone, voiceInput, ctx, state, voice)
  }

  // Strip DTMF prefix if present (not in a WhatsApp-number-collection context)
  const speechText = voiceInput.startsWith('DTMF:') ? voiceInput.slice(5) : voiceInput

  // ── Detect "send to WhatsApp / text me" intent ─────────────────────────────
  if (detectWhatsAppSendIntent(speechText)) {
    return handleVoiceToWhatsApp(phone, speechText, ctx, voice)
  }

  // ── Normal intelligent response ────────────────────────────────────────────
  let responseText: string
  try {
    responseText = await getMaiaIntelligentResponse(ctx, speechText)
  } catch {
    responseText = 'I had trouble with that request. Please call our office at (305) 900-5077 and our team will assist you.'
  }

  return voiceTwiml(voice, stripForTTS(responseText), getFarewell(ctx.language))
}

// ── WhatsApp-send intent detection ────────────────────────────────────────────

function detectWhatsAppSendIntent(speech: string): boolean {
  return /send.*(whatsapp|text|message|sms|phone)|text\s+me|whatsapp\s+me|(send|message)\s+(me|this|that|it)|message\s+me|enviar.*(whatsapp|mensaje)|manda(me)?\s+(al|por|un)?\s*(whatsapp|texto|mensaje)|envia.*(whatsapp|mensagem)/i
    .test(speech)
}

// ── Orchestrate cross-channel WhatsApp send ───────────────────────────────────

async function handleVoiceToWhatsApp(
  phone: string, speechText: string, ctx: CallerContext, voice: string
): Promise<NextResponse> {
  // Generate rich content for WhatsApp (full emoji/markdown, not truncated for TTS)
  const contentRequest = speechText
    .replace(/(\s*(please|por favor))?\s*(send|text|message|whatsapp|enviar|manda|envia)\s*(this|me|it|that|to\s+my)?\s*(whatsapp|text|sms|phone|número)?.*/i, '')
    .trim() || speechText

  let whatsappContent: string
  try {
    whatsappContent = await getMaiaIntelligentResponse(ctx, contentRequest || speechText)
  } catch {
    whatsappContent = 'Here is the information from PMI Top Florida Properties. For further details please call (305) 900-5077.'
  }

  // ── Caller is known — send to calling number directly ─────────────────────
  if (ctx.persona !== 'unknown') {
    await sendWhatsAppFromVoice(phone, whatsappContent, ctx)
    const spoken = translate(ctx.language, {
      en: `Done! I've sent that information to your WhatsApp. Is there anything else I can help you with?`,
      es: `¡Listo! Envié esa información a tu WhatsApp. ¿Hay algo más en que pueda ayudarte?`,
      pt: `Pronto! Enviei essa informação para o seu WhatsApp. Posso ajudar em mais alguma coisa?`,
      fr: `Envoyé sur votre WhatsApp! Puis-je vous aider avec autre chose?`,
      he: `נשלח לוואטסאפ שלך! האם יש עוד שאוכל לעזור?`,
      ru: `Отправлено в ваш WhatsApp! Чем ещё я могу помочь?`,
    })
    return voiceTwiml(voice, stripForTTS(spoken), getFarewell(ctx.language))
  }

  // ── Caller is unknown — ask for their WhatsApp number ─────────────────────
  await saveConversationState(phone, 'voice_awaiting_whatsapp', 'pending', {
    pendingContent: whatsappContent,
    lang: ctx.language,
  })

  const ask = translate(ctx.language, {
    en: `Sure! What is your WhatsApp number? You can say each digit, or enter them on your keypad and press pound when done.`,
    es: `¡Claro! ¿Cuál es tu número de WhatsApp? Puedes decir cada dígito o ingresarlos en el teclado y presionar numeral al terminar.`,
    pt: `Claro! Qual é o seu número de WhatsApp? Você pode dizer cada dígito ou digitá-los e pressionar cerquilha ao terminar.`,
    fr: `Bien sûr! Quel est votre numéro WhatsApp? Dites chaque chiffre ou saisissez-les et appuyez sur dièse.`,
    he: `בטח! מה מספר הוואטסאפ שלך? אמור כל ספרה בנפרד.`,
    ru: `Конечно! Какой у вас номер WhatsApp? Назовите каждую цифру или введите их на клавиатуре.`,
  })

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${escapeXml(ask)}</Say>
  <Gather input="speech dtmf" speechTimeout="8" finishOnKey="#" action="/api/webhook" method="POST">
  </Gather>
  <Say voice="${voice}">I did not catch that. I will send the information to the number you called from instead.</Say>
</Response>`
  // Fallback: send to calling number if Gather times out/fails
  void sendWhatsAppFromVoice(phone, whatsappContent, ctx)
  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

// ── Process the WhatsApp number the caller provides ───────────────────────────

async function handleVoiceAwaitingWhatsAppNumber(
  phone: string, voiceInput: string, ctx: CallerContext, state: ConversationState, voice: string
): Promise<NextResponse> {
  const data    = state.temporary_data_json as { pendingContent: string; lang: string }
  const content = data.pendingContent ?? ''
  const lang    = data.lang ?? ctx.language

  // Extract digits from speech ("seven eight six...") or DTMF prefix ("DTMF:7866863223")
  const raw    = voiceInput.startsWith('DTMF:') ? voiceInput.slice(5) : speechToDigits(voiceInput)
  const digits = raw.replace(/\D/g, '')
  const e164   = digits.length === 10 ? `+1${digits}`
                : digits.length === 11 && digits[0] === '1' ? `+${digits}`
                : `+${digits}`

  await clearConversationState(phone)

  if (digits.length < 10) {
    // Can't parse a valid number — fall back to calling number
    await sendWhatsAppFromVoice(phone, content, ctx)
    const sorry = translate(lang, {
      en: `I had trouble understanding that number, so I sent the information to the number you called from. Is there anything else I can help you with?`,
      es: `No pude entender ese número, así que envié la información al número desde el que llamaste. ¿Hay algo más en que pueda ayudarte?`,
      pt: `Não entendi o número, então enviei para o número de onde você ligou. Posso ajudar em mais alguma coisa?`,
    })
    return voiceTwiml(voice, stripForTTS(sorry), getFarewell(lang))
  }

  await sendWhatsAppFromVoice(e164, content, ctx)
  const confirm = translate(lang, {
    en: `Done! I've sent that to WhatsApp at ${formatPhoneForSpeech(e164)}. Is there anything else I can help you with?`,
    es: `¡Listo! Envié eso al WhatsApp al ${formatPhoneForSpeech(e164)}. ¿Hay algo más en que pueda ayudarte?`,
    pt: `Pronto! Enviei para o WhatsApp no ${formatPhoneForSpeech(e164)}. Posso ajudar em mais alguma coisa?`,
    fr: `Envoyé au ${formatPhoneForSpeech(e164)}. Autre chose?`,
    he: `נשלח ל-${formatPhoneForSpeech(e164)}. האם יש עוד שאוכל לעזור?`,
    ru: `Отправлено на ${formatPhoneForSpeech(e164)}. Чем ещё я могу помочь?`,
  })
  return voiceTwiml(voice, stripForTTS(confirm), getFarewell(lang))
}

// ── Send WhatsApp message from voice call context + log ───────────────────────

async function sendWhatsAppFromVoice(toPhone: string, content: string, ctx: CallerContext): Promise<void> {
  const to   = toPhone.startsWith('whatsapp:') ? toPhone : `whatsapp:${toPhone}`
  const from = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`
  const header = `*PMI Top Florida Properties* 🌸\n_Information sent during your call_\n${'─'.repeat(28)}\n\n`
  const footer = `\n\n${'─'.repeat(28)}\n📞 (305) 900-5077  💬 (786) 686-3223\nservice@topfloridaproperties.com`

  try {
    await twilioClient.messages.create({ from, to, body: header + content + footer })
    console.log(`[VOICE→WHATSAPP] Sent to ${toPhone}`)
  } catch (err) {
    console.error('[VOICE→WHATSAPP] Send failed:', err)
  }

  void getSupabase().from('general_conversations').insert({
    session_id:    `voice-wa-${ctx.phone}-${Date.now()}`,
    phone_number:  ctx.phone,
    contact_phone: ctx.phone,
    contact_name:  ctx.name !== 'there' ? ctx.name : null,
    persona:       ctx.persona,
    language:      ctx.language,
    channel:       'voice',
    topic:         'cross_channel_whatsapp',
    summary:       `Voice→WhatsApp to ${toPhone}: ${content.slice(0, 100)}`,
    messages:      [{ role: 'assistant', content: `[WhatsApp → ${toPhone}] ${content}` }],
    status:        'resolved',
    notes:         `Cross-channel: sent from voice call to WhatsApp ${toPhone}`,
    created_at:    new Date().toISOString(),
    updated_at:    new Date().toISOString(),
  })
}

// ── TwiML builder ─────────────────────────────────────────────────────────────

function voiceTwiml(voice: string, spoken: string, farewell: string): NextResponse {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${escapeXml(spoken)}</Say>
  <Gather input="speech" speechTimeout="4" action="/api/webhook" method="POST">
    <Say voice="${voice}">${escapeXml(farewell)}</Say>
  </Gather>
  <Say voice="${voice}">Thank you for calling PMI Top Florida Properties. Have a wonderful day!</Say>
  <Hangup/>
</Response>`
  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

// ── TTS / speech helpers ──────────────────────────────────────────────────────

function stripForTTS(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[*_~`]/g, '')
    .replace(/https?:\/\/\S+/g, 'the link')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ', ')
    .trim()
    .slice(0, 450)
}

function getFarewell(lang: string): string {
  return ({
    en: 'Is there anything else I can help you with?',
    es: '¿Hay algo más en que pueda ayudarte?',
    pt: 'Posso ajudar em mais alguma coisa?',
    fr: 'Puis-je vous aider avec autre chose?',
    he: 'האם יש עוד שאוכל לעזור לך?',
    ru: 'Чем ещё я могу помочь?',
  } as Record<string, string>)[lang] ?? 'Is there anything else I can help you with?'
}

function formatPhoneForSpeech(phone: string): string {
  const digits = phone.replace(/\D/g, '').replace(/^1/, '')
  if (digits.length === 10)
    return `${digits.slice(0, 3)}, ${digits.slice(3, 6)}, ${digits.slice(6)}`
  return digits.split('').join(' ')
}

// Convert spoken digit words to numeric string: "seven eight six" → "786"
function speechToDigits(speech: string): string {
  const map: Record<string, string> = {
    zero:'0', one:'1', two:'2', three:'3', four:'4', five:'5',
    six:'6', seven:'7', eight:'8', nine:'9', oh:'0', o:'0',
    cero:'0', uno:'1', dos:'2', tres:'3', cuatro:'4', cinco:'5',
    seis:'6', siete:'7', ocho:'8', nueve:'9',
    um:'1', dois:'2', três:'3', quatro:'4', sete:'7', oito:'8', nove:'9',
  }
  if (/^\d[\d\s\-().+]*$/.test(speech.trim())) return speech.replace(/\D/g, '')
  return speech.toLowerCase().split(/[\s,\-]+/).map(w => map[w] ?? (w.match(/^\d$/) ? w : '')).join('')
}

// ============================================================
// SMS + WHATSAPP HANDLER
// ============================================================

async function handleTextChannel(phone: string, message: string, channel: Channel): Promise<NextResponse> {
  const ctx   = await buildCallerContext(phone, channel)
  const state = await getConversationState(phone)

  let replyText: string
  const isGreeting = detectMenuTrigger(message) === 'main_menu'

  if (isGreeting) await clearConversationState(phone)

  if (!isGreeting && state?.current_flow && state.current_flow !== 'idle') {
    if (state.current_flow === 'awaiting_feedback') {
      replyText = await processFeedbackReply(phone, message, ctx, state)
    } else if (state.current_flow === 'agent_identification') {
      replyText = await continueAgentFlow(ctx, state, message)
    } else if (['sticker_register','maintenance_rentvine','maintenance_association','schedule','staff_handoff','unknown_contact'].includes(state.current_flow)) {
      replyText = await continueFlow(ctx, state, message)
    } else {
      replyText = await getMaiaIntelligentResponse(ctx, message)
    }
  } else if (isGreeting) {
    if (ctx.persona !== 'unknown') {
      const greeting = buildPersonalGreeting(ctx)
      await sendReply(phone, greeting, channel)
      await new Promise(r => setTimeout(r, 1500))
      replyText = translate(ctx.language, {
        en: `Just tell me what you need and I'll take care of it! 😊`,
        es: `¡Solo dime qué necesitas y yo me encargo! 😊`,
        pt: `É só me dizer o que você precisa e eu resolvo! 😊`,
        fr: `Dites-moi simplement ce dont vous avez besoin! 😊`,
        he: `פשוט תגיד לי מה אתה צריך ואני אטפל בזה! 😊`,
        ru: `Просто скажите что вам нужно и я позабочусь! 😊`,
      })
    } else {
      await saveConversationState(phone, 'unknown_contact', 'awaiting_info', {})
      replyText = translate(ctx.language, {
        en: `Hi! 🌸 I'm Maia from PMI Top Florida Properties. I don't see you registered in our system — please share your full name, email, and how I can help, and I'll make sure our team gets back to you!`,
        es: `¡Hola! 🌸 Soy Maia de PMI Top Florida Properties. No encuentro tu registro — dime tu nombre completo, correo y cómo puedo ayudarte.`,
        pt: `Olá! 🌸 Sou a Maia da PMI Top Florida Properties. Não encontrei seu cadastro — me diga seu nome completo, e-mail e como posso te ajudar.`,
        fr: `Bonjour! 🌸 Je suis Maia de PMI Top Florida Properties. Dites-moi votre nom, email et comment je peux vous aider.`,
        he: `שלום! 🌸 אני מאיה מ-PMI. לא מצאתי אותך במערכת — שתף שם מלא, אימייל ואיך אוכל לעזור.`,
        ru: `Привет! 🌸 Я Мая из PMI. Вас нет в системе — сообщите имя, email и как я могу помочь.`,
      })
    }
  } else {
    replyText = await getMaiaIntelligentResponse(ctx, message)
  }

  await sendReply(phone, replyText, channel)
  await logConversation(phone, message, replyText, ctx)
  return NextResponse.json({ status: 'ok' })
}

// ============================================================
// FEEDBACK — request sender
// ============================================================

async function maybeRequestFeedback(phone: string, ctx: CallerContext, flowType: string, channel: Channel): Promise<void> {
  const config = FEEDBACK_CONFIG[flowType]
  if (!config) return

  const { count } = await getSupabase().from('general_conversations')
    .select('*', { count: 'exact', head: true }).eq('phone_number', phone)

  const feedbackType: FeedbackType = (count ?? 0) >= 5 ? 'stars' : config.type

  await saveConversationState(phone, 'awaiting_feedback', 'pending', {
    flowType, feedbackType, persona: ctx.persona,
    language: ctx.language, channel, sentAt: new Date().toISOString(),
  })

  await new Promise(r => setTimeout(r, 3000))

  const msgText = feedbackType === 'stars'
    ? FEEDBACK_MSG.stars(flowType, ctx.language)
    : FEEDBACK_MSG.thumbs(flowType, ctx.language)

  await sendReply(phone, msgText, channel)
}

// ============================================================
// FEEDBACK — reply processor
// ============================================================

async function processFeedbackReply(phone: string, message: string, ctx: CallerContext, state: ConversationState): Promise<string> {
  const data = state.temporary_data_json as {
    flowType: string; feedbackType: FeedbackType; persona: string
    language: string; channel: string; sentAt: string
  }

  const lang         = data.language ?? ctx.language
  const feedbackType = data.feedbackType ?? 'thumbs'
  const msg          = message.trim().toLowerCase()

  let thumbsValue: 'up' | 'down' | null = null
  let starsValue:  number | null         = null
  let comment:     string | null         = null

  if (feedbackType === 'thumbs') {
    const positives = ['up','bien','bom','good','хорошо','טוב','👍','si','sim','yes','great','1']
    const negatives = ['down','mal','ruim','bad','плохо','רע','👎','no','nao','não','poor','2']
    const isPos = positives.some(p => msg.startsWith(p))
    const isNeg = negatives.some(n => msg.startsWith(n))
    if (!isPos && !isNeg) return FEEDBACK_MSG.invalid(lang, 'thumbs')
    thumbsValue = isPos ? 'up' : 'down'
    const keyword = [...positives, ...negatives].find(k => msg.startsWith(k)) ?? ''
    comment = message.slice(keyword.length).trim() || null
  }

  if (feedbackType === 'stars') {
    const num = parseInt(msg.charAt(0))
    if (isNaN(num) || num < 1 || num > 5) return FEEDBACK_MSG.invalid(lang, 'stars')
    starsValue = num
    comment    = message.slice(1).trim() || null
  }

  const analysis = await analyzeFeedback({ comment, starsValue, thumbsValue, flowType: data.flowType, persona: data.persona, language: lang })

  await getSupabase().from('conversation_feedback').insert({
    conversation_id: phone + '_' + data.sentAt, phone_number: phone,
    persona: data.persona, language: lang, division: ctx.division,
    channel: data.channel, rating_type: feedbackType,
    thumbs_value: thumbsValue, stars_value: starsValue, comment,
    flow_type: data.flowType, handled_by: 'ai',
    ai_sentiment: analysis.sentiment, ai_tags: analysis.tags,
    ai_improvement: analysis.improvement, reviewed_by_staff: false,
    created_at: new Date().toISOString(),
  })

  const isNegative = (starsValue !== null && starsValue <= 2) || thumbsValue === 'down'

  if (isNegative) {
    const subject     = `⚠️ Low Rating — ${data.flowType.replace(/_/g, ' ')} (${starsValue ? starsValue + '★' : '👎'})`
    const description = `Phone: ${phone}\nPersona: ${data.persona}\nFlow: ${data.flowType}\nComment: ${comment ?? 'None'}\nAI Suggestion: ${analysis.improvement}`
    const ticket = await createTicket({
      channel_origin: data.channel as 'sms' | 'whatsapp' | 'phone',
      priority:       starsValue === 1 ? 'urgent' : 'high',
      persona:        data.persona,
      contact_phone:  phone,
      subject,
      summary:        description,
    })
    await appendMessage(ticket.id, {
      direction: 'internal_note',
      channel:   'internal',
      from_addr: 'system',
      body:      description,
    })
    if (starsValue === 1) {
      await notifyTeamByEmail(process.env.STAFF_EMAIL!, `🚨 1-Star Rating — ${data.flowType.replace(/_/g, ' ')}`,
        `Contact: ${phone}\nPersona: ${data.persona}\nComment: ${comment ?? 'None'}\nAI: ${analysis.improvement}`)
    }
  }

  await clearConversationState(phone)
  return FEEDBACK_MSG.thanks(lang, starsValue)
}

// ============================================================
// CLAUDE AI — feedback analysis
// ============================================================

async function analyzeFeedback(params: {
  comment: string | null; starsValue: number | null; thumbsValue: 'up' | 'down' | null
  flowType: string; persona: string; language: string
}): Promise<{ sentiment: string; tags: string[]; improvement: string }> {
  if (!params.comment && !params.starsValue) {
    return { sentiment: params.thumbsValue === 'up' ? 'positive' : 'negative', tags: [], improvement: '' }
  }

  const ratingStr = params.starsValue ? `${params.starsValue}/5 stars` : params.thumbsValue === 'up' ? 'thumbs up' : 'thumbs down'
  const prompt = `Analyze this property management support feedback. Return ONLY valid JSON, no markdown.

Flow: ${params.flowType} | Persona: ${params.persona} | Rating: ${ratingStr}
Comment: "${params.comment ?? 'no comment'}"

{"sentiment":"positive"|"neutral"|"negative","tags":["tag1"],"improvement":"one concise actionable sentence"}

Tags only from: slow_response, wrong_information, language_barrier, very_helpful, fast_resolution, unclear_instructions, payment_issue, escalation_needed, great_ai_response, needs_human_agent, follow_up_missing, resolved_well, friendly_tone, confusing_menu, technical_issue`

  try {
    const res  = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
    })
    const data = await res.json()
    return JSON.parse(data.content?.[0]?.text?.replace(/```json|```/g, '').trim() ?? '{}')
  } catch {
    return { sentiment: params.starsValue && params.starsValue >= 4 ? 'positive' : 'negative', tags: [], improvement: 'Review this interaction.' }
  }
}

// ============================================================
// PERSONA & CONTEXT BUILDER
// ============================================================

async function buildCallerContext(phone: string, channel: Channel): Promise<CallerContext> {
  const cleanPhone = phone.replace(/\D/g, '')
  const plusPhone  = '+' + cleanPhone
  const shortPhone = cleanPhone.replace(/^1/, '')

  const { data: o } = await getSupabase().from('owners')
    .select('first_name, last_name, language, unit_number, association_code')
    .or([`phone.eq.${phone}`,`phone.eq.${plusPhone}`,`phone.eq.${shortPhone}`,
         `phone_2.eq.${phone}`,`phone_2.eq.${plusPhone}`,`phone_2.eq.${shortPhone}`,
         `phone_e164.eq.${plusPhone}`,`phone_e164.eq.${phone}`].join(','))
    .limit(1).maybeSingle()
  if (o) return { phone, channel, division: 'association', persona: 'homeowner',
    language: o.language ?? 'en', name: `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim() || 'there',
    unitId: o.unit_number, associationId: o.association_code }

  const { data: t } = await getSupabase().from('association_tenants')
    .select('first_name, last_name, language, unit_number, association_code')
    .or(`phone.eq.${phone},phone.eq.${plusPhone},phone.eq.${shortPhone}`).limit(1).maybeSingle()
  if (t) return { phone, channel, division: 'association', persona: 'association_tenant',
    language: t.language ?? 'en', name: `${t.first_name ?? ''} ${t.last_name ?? ''}`.trim() || 'there',
    unitId: t.unit_number, associationId: t.association_code }

  const { data: b } = await getSupabase().from('board_members')
    .select('first_name, last_name, language, association_code')
    .or(`phone.eq.${phone},phone.eq.${plusPhone},phone.eq.${shortPhone}`).limit(1).maybeSingle()
  if (b) return { phone, channel, division: 'association', persona: 'board_member',
    language: b.language ?? 'en', name: `${b.first_name ?? ''} ${b.last_name ?? ''}`.trim() || 'there',
    associationId: b.association_code }

  const { data: v } = await getSupabase().from('vendor_directory').select('name, language, association_id').eq('phone', phone).single()
  if (v) return { phone, channel, division: 'association', persona: 'vendor',
    language: v.language ?? 'en', name: v.name, associationId: v.association_id }

  const { data: ag } = await getSupabase().from('real_estate_agents').select('id, first_name, last_name, language').eq('phone', phone).single()
  if (ag) return { phone, channel, division: 'association', persona: 'real_estate_agent',
    language: ag.language ?? 'en', name: `${ag.first_name} ${ag.last_name}` }

  const rv = await lookupRentvineByPhone(phone)
  if (rv) return { phone, channel, division: 'residential', persona: rv.type, language: 'pt', name: rv.name, rentvineContactId: rv.id }

  return { phone, channel, division: 'unknown', persona: 'unknown', language: 'en', name: 'there' }
}

// ============================================================
// RENTVINE
// ============================================================

async function lookupRentvineByPhone(phone: string): Promise<{ id: string; name: string; type: PersonaType } | null> {
  const creds = Buffer.from(`${process.env.RENTVINE_ACCESS_KEY}:${process.env.RENTVINE_SECRET}`).toString('base64')
  const h     = { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' }
  const clean = (p: string) => p.replace(/\D/g, '')
  try {
    for (const [ep, type] of [['contacts/owners','residential_owner'],['contacts/tenants','residential_tenant'],['contacts/vendors','residential_vendor']] as [string, PersonaType][]) {
      const res  = await fetch(`${process.env.RENTVINE_BASE_URL}/${ep}`, { headers: h })
      const json = await res.json()
      const match = json?.data?.find((c: { phone?: string; name: string; contactID: number }) => clean(c.phone ?? '') === clean(phone))
      if (match) return { id: String(match.contactID), name: match.name, type }
    }
  } catch (err) { console.error('[RENTVINE]', err) }
  return null
}

interface RentvineContactData {
  name: string; email: string | null; phone: string | null; unitAddress: string | null
  leaseStart: string | null; leaseEnd: string | null; balance: number | null
  pastDue: number | null; openWorkOrders: number; type: 'owner' | 'tenant' | 'vendor'
}

async function getRentvineContactData(contactId: string, type: PersonaType): Promise<RentvineContactData | null> {
  const creds = Buffer.from(`${process.env.RENTVINE_ACCESS_KEY}:${process.env.RENTVINE_SECRET}`).toString('base64')
  const h    = { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' }
  const base = process.env.RENTVINE_BASE_URL!
  try {
    const epMap: Record<string, string> = { residential_owner:'contacts/owners', residential_tenant:'contacts/tenants', residential_vendor:'contacts/vendors' }
    const cRes    = await fetch(`${base}/${epMap[type] ?? 'contacts/tenants'}/${contactId}`, { headers: h })
    const contact = await cRes.json()
    let leaseStart = null, leaseEnd = null, balance = null, pastDue = null, unitAddress = null, openWorkOrders = 0

    if (type === 'residential_tenant' || type === 'residential_owner') {
      const lRes   = await fetch(`${base}/leases/export`, { headers: h })
      const leases = await lRes.json()
      const lease  = leases?.data?.find((l: { lease: { tenants?: { contactID: number }[]; owners?: { contactID: number }[] }; balances: { unpaidTotalAmount: number; pastDueTotalAmount: number }; unit: { address: string }; leaseStartDate: string; leaseEndDate: string }) => {
        const contacts = type === 'residential_tenant' ? l.lease?.tenants : l.lease?.owners
        return contacts?.some((c: { contactID: number }) => String(c.contactID) === contactId)
      })
      if (lease) { leaseStart = lease.leaseStartDate; leaseEnd = lease.leaseEndDate; balance = lease.balances?.unpaidTotalAmount ?? null; pastDue = lease.balances?.pastDueTotalAmount ?? null; unitAddress = lease.unit?.address ?? null }
      const wRes = await fetch(`${base}/maintenance/work-orders?status=open`, { headers: h })
      const wJson = await wRes.json()
      openWorkOrders = wJson?.data?.filter((w: { contactID?: number }) => String(w.contactID) === contactId).length ?? 0
    }

    return { name: contact?.data?.name ?? contact?.name ?? 'Unknown', email: contact?.data?.email ?? contact?.email ?? null,
      phone: contact?.data?.phone ?? contact?.phone ?? null, unitAddress, leaseStart, leaseEnd, balance, pastDue, openWorkOrders,
      type: type === 'residential_owner' ? 'owner' : type === 'residential_vendor' ? 'vendor' : 'tenant' }
  } catch (err) { console.error('[RENTVINE DATA]', err); return null }
}

async function buildRentvineContext(ctx: CallerContext): Promise<string> {
  if (!ctx.rentvineContactId || ctx.division !== 'residential') return ''
  const data = await getRentvineContactData(ctx.rentvineContactId, ctx.persona)
  if (!data) return ''
  const lines = [`Rentvine Contact Type: ${data.type}`,
    data.unitAddress ? `Unit Address: ${data.unitAddress}` : '',
    data.leaseStart  ? `Lease Start: ${data.leaseStart}` : '',
    data.leaseEnd    ? `Lease End: ${data.leaseEnd}` : '',
    data.balance !== null ? `Current Balance: $${data.balance.toFixed(2)}` : '',
    data.pastDue !== null && data.pastDue > 0 ? `Past Due: $${data.pastDue.toFixed(2)} ⚠️` : '',
    data.openWorkOrders > 0 ? `Open Work Orders: ${data.openWorkOrders}` : '',
  ].filter(Boolean)
  return lines.length ? `\nRentvine Data:\n${lines.join('\n')}` : ''
}

// ============================================================
// MENU
// ============================================================

function detectMenuTrigger(message: string): string | null {
  const m = message.trim().toLowerCase()
  const greetings = ['hi','hello','hola','oi','olá','hey','menu','start','0','bom dia','buenos dias','good morning']
  if (greetings.includes(m)) return 'main_menu'
  return ({'1':'parking_sticker','2':'maintenance','3':'payment','4':'documents','5':'schedule','6':'my_account','7':'emergency','8':'staff','9':'agent_portal'} as Record<string,string>)[m] ?? null
}

function buildMainMenu(ctx: CallerContext): string {
  const first = ctx.name !== 'there' ? ` ${ctx.name.split(' ')[0]}` : ''
  if (ctx.persona === 'real_estate_agent') {
    return translate(ctx.language, {
      en: `👋 Hi${first}! I'm Maia 🌸 PMI Agent Portal.\n\n1 - 🏠 Owner / Seller\n2 - 🔑 Buyer\n3 - 📋 Tenant\n8 - 💬 Team\n\nReply with a number.`,
      es: `👋 ¡Hola${first}! Soy Maia 🌸\n\n1-🏠 Propietario  2-🔑 Comprador  3-📋 Inquilino  8-💬 Equipo`,
      pt: `👋 Olá${first}! Sou a Maia 🌸\n\n1-🏠 Proprietário  2-🔑 Comprador  3-📋 Inquilino  8-💬 Equipe`,
      fr: `👋 Bonjour${first}! Maia 🌸\n\n1-🏠 Propriétaire  2-🔑 Acheteur  3-📋 Locataire  8-💬 Équipe`,
      he: `👋 שלום${first}! מאיה 🌸\n\n1-🏠 בעלים  2-🔑 קונה  3-📋 שוכר  8-💬 צוות`,
      ru: `👋 Привет${first}! Мая 🌸\n\n1-🏠 Владелец  2-🔑 Покупатель  3-📋 Арендатор  8-💬 Команда`,
    })
  }
  return translate(ctx.language, {
    en: `👋 Hi${first}! I'm Maia, your PMI assistant 🌸\n\n1 - 🚗 Parking Sticker\n2 - 🔧 Maintenance\n3 - 💰 Payment\n4 - 📄 Documents\n5 - 📅 Schedule\n6 - 🏠 My Account\n7 - 🚨 Emergency\n8 - 💬 Staff\n9 - 🏡 Real Estate Agent\n\nReply with a number.`,
    es: `👋 ¡Hola${first}! Soy Maia 🌸\n\n1-🚗 Calcomanía  2-🔧 Mant.  3-💰 Pagos\n4-📄 Docs  5-📅 Cita  6-🏠 Cuenta\n7-🚨 Emergencia  8-💬 Equipo  9-🏡 Agente`,
    pt: `👋 Olá${first}! Sou a Maia 🌸\n\n1-🚗 Adesivo  2-🔧 Manutenção  3-💰 Pagamentos\n4-📄 Documentos  5-📅 Agendar  6-🏠 Conta\n7-🚨 Emergência  8-💬 Equipe  9-🏡 Corretor`,
    fr: `👋 Bonjour${first}! Maia 🌸\n\n1-🚗 Vignette  2-🔧 Maintenance  3-💰 Paiements\n4-📄 Documents  5-📅 Rendez-vous  6-🏠 Compte\n7-🚨 Urgence  8-💬 Équipe  9-🏡 Agent`,
    he: `👋 שלום${first}! מאיה 🌸\n\n1-🚗 מדבקה  2-🔧 תחזוקה  3-💰 תשלומים\n4-📄 מסמכים  5-📅 פגישה  6-🏠 חשבון\n7-🚨 חירום  8-💬 צוות  9-🏡 סוכן`,
    ru: `👋 Привет${first}! Мая 🌸\n\n1-🚗 Наклейка  2-🔧 Ремонт  3-💰 Платежи\n4-📄 Документы  5-📅 Запись  6-🏠 Аккаунт\n7-🚨 Экстренно  8-💬 Команда  9-🏡 Агент`,
  })
}

function buildPersonalGreeting(ctx: CallerContext): string {
  const first = ctx.name && ctx.name !== 'there' ? ctx.name.split(' ')[0] : ''
  const n = first ? ` ${first}` : ''
  return translate(ctx.language, {
    en: `Hi${n}! 🌸 This is Maia from PMI Top Florida Properties. So lovely to hear from you!`,
    es: `¡Hola${n}! 🌸 Soy Maia de PMI Top Florida Properties. ¡Qué gusto saber de ti!`,
    pt: `Olá${n}! 🌸 Aqui é a Maia da PMI Top Florida Properties. Que bom te ouvir!`,
    fr: `Bonjour${n}! 🌸 C'est Maia de PMI Top Florida Properties.`,
    he: `שלום${n}! 🌸 אני מאיה מ-PMI Top Florida Properties.`,
    ru: `Привет${n}! 🌸 Это Мая из PMI Top Florida Properties.`,
  })
}

// ============================================================
// CONTINUE FLOW
// ============================================================

async function continueFlow(ctx: CallerContext, state: ConversationState, message: string): Promise<string> {
  const { current_flow: flow, current_step: step, temporary_data_json: data } = state

  if (flow === 'parking_sticker') {
    if (message === '1') {
      const status = await getStickerStatus(ctx)
      await clearConversationState(ctx.phone)
      void maybeRequestFeedback(ctx.phone, ctx, 'parking_sticker', ctx.channel)
      return status
    }
    if (message === '2' || message === '3') {
      await saveConversationState(ctx.phone, 'sticker_register', 'awaiting_plate', data)
      return translate(ctx.language, { en: `Please enter your vehicle's license plate number:`, es: `Ingresa el número de placa:`, pt: `Informe a placa do veículo:` })
    }
  }

  if (flow === 'sticker_register') {
    if (step === 'awaiting_plate') {
      await saveConversationState(ctx.phone, 'sticker_register', 'awaiting_make', { ...data, plate: message.toUpperCase() })
      return translate(ctx.language, { en: `Vehicle make (e.g. Toyota):`, es: `Marca (ej. Toyota):`, pt: `Marca (ex: Toyota):` })
    }
    if (step === 'awaiting_make') {
      await saveConversationState(ctx.phone, 'sticker_register', 'awaiting_model', { ...data, make: message })
      return translate(ctx.language, { en: `Model (e.g. Corolla):`, es: `Modelo (ej. Corolla):`, pt: `Modelo (ex: Corolla):` })
    }
    if (step === 'awaiting_model') {
      await saveConversationState(ctx.phone, 'sticker_register', 'awaiting_color', { ...data, model: message })
      return translate(ctx.language, { en: `Vehicle color:`, es: `Color del vehículo:`, pt: `Cor do veículo:` })
    }
    if (step === 'awaiting_color') {
      const vehicle = { ...data, color: message } as Record<string, string>
      await createStickerRequest(ctx, vehicle)
      await clearConversationState(ctx.phone)
      void maybeRequestFeedback(ctx.phone, ctx, 'sticker_register', ctx.channel)
      return translate(ctx.language, {
        en: `✅ Sticker request submitted!\n\n${vehicle.make} ${vehicle.model} (${vehicle.color})\nPlate: ${vehicle.plate}\n\nPayment link coming shortly.`,
        es: `✅ ¡Solicitud enviada!\n\n${vehicle.make} ${vehicle.model} (${vehicle.color}) — Placa: ${vehicle.plate}`,
        pt: `✅ Solicitação enviada!\n\n${vehicle.make} ${vehicle.model} (${vehicle.color}) — Placa: ${vehicle.plate}`,
      })
    }
  }

  if (flow === 'maintenance_rentvine' && step === 'awaiting_description') {
    const workOrderId = await createRentvineWorkOrder(ctx, message)
    await clearConversationState(ctx.phone)
    void maybeRequestFeedback(ctx.phone, ctx, 'maintenance_rentvine', ctx.channel)
    return translate(ctx.language, {
      en: `✅ Maintenance submitted!\n\nWork Order #${workOrderId}\n"${message}"\n\nOur team will contact you to schedule.`,
      es: `✅ ¡Solicitud enviada!\n\nOrden #${workOrderId}: "${message}"`,
      pt: `✅ Solicitação enviada!\n\nOrdem #${workOrderId}: "${message}"`,
    })
  }

  if (flow === 'maintenance_association' && step === 'awaiting_description') {
    await createAssociationMaintenanceRequest(ctx, message)
    await clearConversationState(ctx.phone)
    void maybeRequestFeedback(ctx.phone, ctx, 'maintenance_association', ctx.channel)
    return translate(ctx.language, {
      en: `✅ Maintenance request received!\n\n"${message}"\n\nForwarded to our maintenance team.`,
      es: `✅ ¡Solicitud recibida!\n\n"${message}"\n\nEnviada al equipo.`,
      pt: `✅ Solicitação recebida!\n\n"${message}"\n\nEncaminhada para a equipe.`,
    })
  }

  if (flow === 'documents' && step === 'awaiting_question') {
    const answer   = await getMaiaIntelligentResponse(ctx, message)
    const msgCount = ((data.msgCount as number) ?? 0) + 1
    if (msgCount >= 3) {
      void maybeRequestFeedback(ctx.phone, ctx, 'documents', ctx.channel)
      await clearConversationState(ctx.phone)
      return answer + translate(ctx.language, { en: `\n\n_Reply *menu* for more options._`, es: `\n\n_Escribe *menú* para más opciones._`, pt: `\n\n_Escreva *menu* para mais opções._` })
    }
    await saveConversationState(ctx.phone, 'documents', 'awaiting_question', { msgCount })
    return answer + translate(ctx.language, { en: `\n\n📄 Ask another question or reply *menu*.`, es: `\n\n📄 Haz otra pregunta o escribe *menú*.`, pt: `\n\n📄 Faça outra pergunta ou escreva *menu*.` })
  }

  if (flow === 'schedule' && step === 'awaiting_type') {
    const types: Record<string, string> = { '1':'unit inspection','2':'move-in walkthrough','3':'management meeting','4':'other appointment' }
    const apptType = types[message] ?? 'appointment'
    await notifyStaff(ctx, `Appointment request: ${apptType}`)
    await clearConversationState(ctx.phone)
    void maybeRequestFeedback(ctx.phone, ctx, 'schedule', ctx.channel)
    return translate(ctx.language, {
      en: `📅 Your ${apptType} request has been sent. We'll confirm date and time shortly.`,
      es: `📅 Solicitud de ${apptType} enviada. Confirmaremos pronto.`,
      pt: `📅 Solicitação de ${apptType} enviada. Confirmaremos em breve.`,
    })
  }

  if (flow === 'staff_handoff') {
    const msgCount = ((data.msgCount as number) ?? 0) + 1
    await notifyStaff(ctx, message)
    if (msgCount >= 3) { void maybeRequestFeedback(ctx.phone, ctx, 'staff_handoff', ctx.channel); await clearConversationState(ctx.phone) }
    else await saveConversationState(ctx.phone, 'staff_handoff', 'waiting', { msgCount })
    return translate(ctx.language, { en: `✉️ Got it! I've passed your message to our team. They'll be in touch soon 🌸`, es: `✉️ ¡Listo! Le pasé tu mensaje al equipo 🌸`, pt: `✉️ Pronto! Repassei sua mensagem para a equipe 🌸` })
  }

  if (flow === 'unknown_contact' && step === 'awaiting_info') {
    await notifyTeamByEmail(process.env.STAFF_EMAIL!, `New Unregistered Contact — ${ctx.phone}`,
      `An unregistered contact reached out via ${ctx.channel.toUpperCase()}.\n\nPhone: ${ctx.phone}\nMessage: "${message}"\n\nPlease follow up.\n\nMaia — PMI Top Florida Properties`)
    await clearConversationState(ctx.phone)
    void maybeRequestFeedback(ctx.phone, ctx, 'staff_handoff', ctx.channel)
    return translate(ctx.language, {
      en: `Thank you so much! 🌸 I've passed your message to our team and they'll get back to you very soon. Have a wonderful day!`,
      es: `¡Muchas gracias! 🌸 Le pasé tu mensaje a nuestro equipo y te contactarán muy pronto. ¡Que tengas un excelente día!`,
      pt: `Muito obrigada! 🌸 Passei sua mensagem para nossa equipe e eles entrarão em contato em breve. Tenha um ótimo dia!`,
      fr: `Merci beaucoup! 🌸 Message transmis. Bonne journée!`,
      he: `תודה רבה! 🌸 העברתי את ההודעה. יום נפלא!`,
      ru: `Большое спасибо! 🌸 Сообщение передано. Хорошего дня!`,
    })
  }

  await clearConversationState(ctx.phone)
  return buildMainMenu(ctx)
}

// ============================================================
// MAIA INTELLIGENT RESPONSE ENGINE
// ============================================================

// Detect an explicit "open / create a ticket | work order" request,
// optionally addressed to a named staff member and bound to an
// association / unit (English / Spanish / Portuguese). Returns the
// extracted bits; null when no create intent is present.
interface CreateIntent {
  entityType:   'ticket' | 'work_order'
  assigneeName: string | null
  unit:         string | null
}
function detectCreateIntent(message: string): CreateIntent | null {
  const verbs       = /\b(?:open|create|please\s+open|please\s+create|crea|crear|crear?\s+un|abre|abrir|abrir\s+um|cria|criar|criar?\s+um|criar?\s+uma)\b/i
  const ticketNoun  = /\b(?:ticket|chamado|caso|task|tarea|tarefa)\b/i
  const workOrder   = /\b(?:work\s*order|wo\b|orden\s+de\s+trabajo|orden\s+de\s+servicio|ordem\s+de\s+servi[çc]o|os\b)/i
  const atTrigger   = /@maia[,!.\s]+(?:ct|ticket|create\s+ticket|open\s+ticket|new\s+ticket|wo|work\s*order|new\s+work\s*order)/i

  const wantsWorkOrder = workOrder.test(message)
  const wantsTicket    = ticketNoun.test(message)
  const hasIntent      = atTrigger.test(message) || (verbs.test(message) && (wantsWorkOrder || wantsTicket))
  if (!hasIntent) return null

  // Work-order language wins when both happen to match.
  const entityType: 'ticket' | 'work_order' = wantsWorkOrder ? 'work_order' : 'ticket'

  // Pull a first-name after a "to / para / a" preposition. Capitalised
  // single token only — keeps the match conservative.
  const to = message.match(/\b(?:to|para|a)\s+([A-Z][a-zA-Z]{1,30})\b/)

  // Pull a unit number: "unit 4B", "apt 16", "apartment #4", "unidad 4B",
  // "apartamento 16", or trailing digits on an account-style code like
  // "ESSI16" (the alphabetic prefix is treated as the association by
  // detectAssociationCode; the trailing digits are the unit).
  const explicitUnit = message.match(/\b(?:unit|apt\.?|apartment|unidad|apartamento|departamento)\s*#?\s*([0-9]{1,4}[A-Za-z]?(?:-[0-9]+)?)\b/i)
  const acctUnit     = message.toUpperCase().match(/\b[A-Z]{3,6}(\d{1,4})\b/)
  const unit         = explicitUnit?.[1] ?? acctUnit?.[1] ?? null

  return { entityType, assigneeName: to?.[1] ?? null, unit }
}

async function handleExplicitCreate(
  ctx: CallerContext,
  message: string,
  intent: CreateIntent,
  requester: { name: string; email: string },
): Promise<string> {
  let assigneeEmail: string | null = null
  let resolvedName:  string | null = null

  if (intent.assigneeName) {
    try {
      const staff   = await fetchStaffList()
      const needle  = intent.assigneeName.toLowerCase()
      const hit = staff.find(s =>
        s.name.toLowerCase().split(/\s+/).includes(needle) ||
        s.email.toLowerCase().split('@')[0].split(/[.\-_]/).includes(needle)
      )
      if (hit) { assigneeEmail = hit.email; resolvedName = hit.name }
    } catch (err) {
      console.warn('[create-intent] staff lookup failed:', err instanceof Error ? err.message : err)
    }
  }

  // Association detection: prefer one inferred from the message itself
  // (so "for ESSI 16" or "at Essington" works for staff who don't have a
  // unit bound to their phone number). Fall back to the caller's own
  // associationId if present.
  let associationCode: string | null = null
  try {
    associationCode = await detectAssociationCode(message) ?? ctx.associationId ?? null
  } catch (err) {
    console.warn('[create-intent] assoc detection failed:', err instanceof Error ? err.message : err)
    associationCode = ctx.associationId ?? null
  }

  const label = intent.entityType === 'work_order' ? 'Work order' : 'Ticket'
  const labelEs = intent.entityType === 'work_order' ? 'Orden de trabajo' : 'Ticket'
  const labelPt = intent.entityType === 'work_order' ? 'Ordem de serviço' : 'Chamado'

  try {
    const ticket = await createTicket({
      type:             intent.entityType,
      channel_origin:   ctx.channel === 'voice' ? 'phone' : ctx.channel,
      priority:         'normal',
      persona:          'staff',
      association_code: associationCode,
      contact_phone:    ctx.phone,
      contact_name:     requester.name,
      contact_email:    requester.email,
      subject:          message.slice(0, 120),
      summary:          message.slice(0, 280),
      assignee_email:   assigneeEmail,
    })
    const shortId = ticket.id.slice(0, 8)

    const assignFragment = assigneeEmail && resolvedName
      ? { en: ` and assigned to ${resolvedName}`,
          es: ` y asignado a ${resolvedName}`,
          pt: ` e atribuído a ${resolvedName}` }
      : intent.assigneeName
        ? { en: ` (couldn't find staff "${intent.assigneeName}" — left unassigned)`,
            es: ` (no encontré al personal "${intent.assigneeName}" — sin asignar)`,
            pt: ` (não encontrei o funcionário "${intent.assigneeName}" — sem responsável)` }
        : { en: '', es: '', pt: '' }

    const ctxFragment = (() => {
      const parts: string[] = []
      if (associationCode) parts.push(associationCode)
      if (intent.unit)     parts.push(`Unit ${intent.unit}`)
      return parts.length ? ` · ${parts.join(' · ')}` : ''
    })()

    return translate(ctx.language, {
      en: `📋 ${label} ${shortId}${ctxFragment} created${assignFragment.en}. We'll follow up shortly. 🌸`,
      es: `📋 ${labelEs} ${shortId}${ctxFragment} creada${assignFragment.es}. Te respondemos pronto. 🌸`,
      pt: `📋 ${labelPt} ${shortId}${ctxFragment} criada${assignFragment.pt}. Retornamos em breve. 🌸`,
    })
  } catch (err) {
    console.error('[create-intent] createTicket failed:', err instanceof Error ? err.message : err)
    return translate(ctx.language, {
      en: `I tried to open a ${label.toLowerCase()} but ran into an issue. Please email service@topfloridaproperties.com or call (305) 900-5077. 🌸`,
      es: `Intenté abrir una ${labelEs.toLowerCase()} pero hubo un problema. Escribe a service@topfloridaproperties.com o llama al (305) 900-5077. 🌸`,
      pt: `Tentei abrir uma ${labelPt.toLowerCase()} mas houve um problema. Escreva para service@topfloridaproperties.com ou ligue (305) 900-5077. 🌸`,
    })
  }
}

async function getMaiaIntelligentResponse(ctx: CallerContext, message: string): Promise<string> {
  const langName = LANGUAGE_NAMES[ctx.language] ?? 'English'
  const msg      = message.toLowerCase()

  // Explicit ticket-creation intent ("open a ticket to Jonathan to check…",
  // "abrir um chamado", "@maia create ticket"). Short-circuits before the
  // keyword routers so unrelated words in the subject (e.g. "check") don't
  // misfire other templates.
  //
  // Staff-only: opening tickets by directive (especially assigning to a
  // named staff member) is reserved for PMI staff. Non-staff senders fall
  // through to the normal keyword routing — their conversation is still
  // auto-logged as a ticket via ingestTwilioConversationToTicket.
  const createIntent = detectCreateIntent(message)
  if (createIntent) {
    const staffSender = await findStaffByPhone(ctx.phone)
    if (staffSender) {
      return await handleExplicitCreate(ctx, message, createIntent, staffSender)
    }
    // Non-staff: silently fall through — no need to call out that the
    // feature is staff-only; their request will be handled by the normal
    // triage below.
  }

  const isMaintenance = /leak|repair|broken|fix|maintenance|agua|plumb|hvac|electric|roof|door|window|faucet|toilet|ac|heat|mold|pest|manuten|reparar/.test(msg)
  // Match real payment intent only. Bare "check" / "pay" caused false positives
  // ("check the board members", "let me check") that fired the HOA Payment
  // Options template on unrelated messages.
  const isPayment     = /\b(balance|past[\s-]*due|amount\s+due|autopay|payment|paying|paid|owe|cobro|pago|saldo|pagamento)\b|\b(pay|pagar)\s+(my|the|by|via|with|now|online|in\s+full|mi|mis|el|la|los|las|ahora)\b|\b(by|via|with|send|mail|writing)\s+(a\s+)?check\b/i.test(msg)
  const isParking     = /park|sticker|car|vehicle|plate|veh|carro|calcoman|adesivo/.test(msg)
  const isBoard       = /board|president|contact|who is|member|junta|directiva|conselho/.test(msg)
  const isDocument    = /document|form|application|lease|contract|estoppel|arc|doc|formulario|contrato/.test(msg)
  const isSchedule    = /schedul|appointment|visit|inspect|meeting|cita|agend|visita/.test(msg)
  const isEmergency   = /emergency|flood|fire|gas|danger|urgent|help|urgente|emergencia|emergência/.test(msg)
  const isArcForm     = /arc|architect|modification|exterior|fence|paint|roof|pool|shed|landscap|structur/.test(msg)
  const isVendorAch   = /vendor|ach form|routing|account.*vendor|vendor.*form|proveedor/.test(msg)
  const isInvoice     = /invoice|approve.*invoice|invoice.*approv|factura|aprob|fatura/.test(msg)

  let dbContext = ''

  if (ctx.division === 'residential' && ctx.rentvineContactId)
    dbContext += await buildRentvineContext(ctx)

  if (ctx.associationId) {
    const { data: assoc } = await getSupabase().from('associations')
      .select('association_name, association_type, service_type, florida_statute')
      .eq('association_code', ctx.associationId).single()
    if (assoc) dbContext += `\nAssociation: ${assoc.association_name} (${assoc.association_type}, ${assoc.service_type})`
  }

  if (isBoard && ctx.associationId) {
    const { data: board } = await getSupabase().from('board_members')
      .select('first_name, last_name, position, email').eq('association_code', ctx.associationId).eq('active', true)
    if (board?.length) dbContext += `\nBoard: ${board.map(b => `${b.first_name} ${b.last_name} (${b.position}) ${b.email}`).join(', ')}`
  }

  if (!isMaintenance && !isPayment && !isParking) {
    const { data: faqs } = await getSupabase().from('association_faq').select('question, answer').limit(5)
    if (faqs?.length) dbContext += '\nFAQ:\n' + faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n')
  }

  if ((isDocument) && ctx.associationId) {
    const { data: folders } = await getSupabase().from('association_drive_folders')
      .select('folder_type, drive_link').eq('association_code', ctx.associationId).not('drive_link', 'is', null)
    if (folders?.length) dbContext += `\nDrive Folders: ${folders.map(f => `${f.folder_type}: ${f.drive_link}`).join(', ')}`
  }

  if (isArcForm && !isMaintenance) return translate(ctx.language, {
    en: `🏗️ ARC Request — email info@topfloridaproperties.com with:\n• Owner signature\n• Project description + dimensions\n• Materials list + paint samples\n• Photo or drawing\n• Site plan\n\n⚠️ NO work until ACC approval!\n\nForm: https://drive.google.com/drive/folders/1RGGBxke8umRS6kH9PTX4P-SJmvuHCsJh 🌸`,
    es: `🏗️ ARC — email info@topfloridaproperties.com con:\n• Firma propietario\n• Descripción + dimensiones\n• Lista materiales\n• Foto o dibujo\n• Plano\n\n⚠️ ¡Sin aprobación no hay trabajo!\n\nFormulario: https://drive.google.com/drive/folders/1RGGBxke8umRS6kH9PTX4P-SJmvuHCsJh`,
    pt: `🏗️ ARC — envie para info@topfloridaproperties.com:\n• Assinatura proprietário\n• Descrição + dimensões\n• Lista materiais\n• Foto ou desenho\n• Planta\n\n⚠️ Nenhum trabalho sem aprovação!\n\nFormulário: https://drive.google.com/drive/folders/1RGGBxke8umRS6kH9PTX4P-SJmvuHCsJh`,
  })

  if (isVendorAch) return translate(ctx.language, {
    en: `📋 Vendor ACH Form — send to billing@topfloridaproperties.com\n\nInclude: business name, bank name, routing #, account # (or VOID check)\n\nForm: https://drive.google.com/drive/folders/1RGGBxke8umRS6kH9PTX4P-SJmvuHCsJh 🌸`,
    es: `📋 Formulario ACH — enviar a billing@topfloridaproperties.com\n\nIncluir: nombre negocio, banco, número de ruta, cuenta (o cheque VOID)\n\nFormulario: https://drive.google.com/drive/folders/1RGGBxke8umRS6kH9PTX4P-SJmvuHCsJh`,
    pt: `📋 Formulário ACH — enviar para billing@topfloridaproperties.com\n\nIncluir: nome empresa, banco, roteamento, conta (ou cheque VOID)\n\nFormulário: https://drive.google.com/drive/folders/1RGGBxke8umRS6kH9PTX4P-SJmvuHCsJh`,
  })

  if (isInvoice) return translate(ctx.language, {
    en: `✅ Invoice Approval:\n\n1️⃣ https://pmitfp.cincwebaxis.com/\n2️⃣ Click "Board Invoice Approval"\n3️⃣ Review + Approve or Decline\n\n⚠️ ONLY portal-approved invoices get paid!\nACH: 5-7 business days after approval.\n\nApp: Android / Apple "Property Management Inc"\n\nQuestions: ar@topfloridaproperties.com 🌸`,
    es: `✅ Aprobación de facturas:\n\n1️⃣ https://pmitfp.cincwebaxis.com/\n2️⃣ "Board Invoice Approval"\n3️⃣ Aprobar o Rechazar\n\n⚠️ ¡Solo facturas aprobadas en portal se pagan!\n\nar@topfloridaproperties.com 🌸`,
    pt: `✅ Aprovação de faturas:\n\n1️⃣ https://pmitfp.cincwebaxis.com/\n2️⃣ "Board Invoice Approval"\n3️⃣ Aprovar ou Recusar\n\n⚠️ Apenas faturas aprovadas no portal são pagas!\n\nar@topfloridaproperties.com 🌸`,
  })

  if (isEmergency) {
    await alertEmergencyTeam(ctx)
    return translate(ctx.language, {
      en: `🚨 I've alerted our emergency team right away! If you're in immediate danger please call 911. Our team will contact you very shortly. Stay safe! 📞 ${process.env.EMERGENCY_PHONE}`,
      es: `🚨 ¡Alerté al equipo de emergencias! Peligro inmediato → llama al 911. 📞 ${process.env.EMERGENCY_PHONE}`,
      pt: `🚨 Alertei nossa equipe! Perigo imediato → ligue para o 911. 📞 ${process.env.EMERGENCY_PHONE}`,
    })
  }

  if (isMaintenance) {
    const isBookkeeping = ctx.associationId &&
      (await getSupabase().from('associations').select('service_type').eq('association_code', ctx.associationId).single()).data?.service_type === 'bookkeeping'

    if (isBookkeeping) {
      const { data: board } = await getSupabase().from('board_members').select('email').eq('association_code', ctx.associationId ?? '').eq('active', true)
      if (board?.length) {
        await notifyTeamByEmail(board.map(b => b.email).filter(Boolean).join(','),
          `Maintenance Request — Unit ${ctx.unitId ?? 'Unknown'} — ${ctx.name}`,
          `Dear Board Members,\n\nMaintenance request from ${ctx.name} (Unit ${ctx.unitId ?? 'N/A'}).\n\nRequest: "${message}"\n\nPlease contact the owner directly.\n\nPMI Top Florida Properties`)
      }
      return translate(ctx.language, {
        en: `Got it! 🌸 PMI provides bookkeeping for your association. I've forwarded your request to all board members — they'll contact you directly. Anything else I can help with?`,
        es: `¡Entendido! 🌸 Envié tu solicitud a todos los miembros de la junta. ¿Hay algo más en que pueda ayudar?`,
        pt: `Entendido! 🌸 Encaminhei sua solicitação a todos os membros do conselho. Posso ajudar em mais alguma coisa?`,
      })
    }

    await saveConversationState(ctx.phone, ctx.division === 'residential' ? 'maintenance_rentvine' : 'maintenance_association', 'awaiting_description', {})

    let openOrdersNote = ''
    if (ctx.division === 'residential' && ctx.rentvineContactId) {
      const d = await getRentvineContactData(ctx.rentvineContactId, ctx.persona)
      if (d && d.openWorkOrders > 0) openOrdersNote = ` (You currently have ${d.openWorkOrders} open work order${d.openWorkOrders > 1 ? 's' : ''} with us.)`
    }

    return translate(ctx.language, {
      en: `Oh no, let me help you with that right away! 🔧${openOrdersNote} Can you describe the issue in a bit more detail? Which room, how long has it been happening, and is it urgent?`,
      es: `¡Enseguida te ayudo! 🔧${openOrdersNote} ¿Puedes describir el problema con más detalle? ¿En qué habitación, desde cuándo y es urgente?`,
      pt: `Deixa eu te ajudar! 🔧${openOrdersNote} Pode descrever o problema com mais detalhes? Qual cômodo, há quanto tempo e é urgente?`,
    })
  }

  if (isParking) {
    const status = await getStickerStatus(ctx)
    return translate(ctx.language, {
      en: `🚗 Parking sticker info:\n\n${status}\n\nNeed to register a new vehicle? Just let me know!`,
      es: `🚗 Info de calcomanía:\n\n${status}\n\n¿Necesitas registrar un vehículo? ¡Dímelo!`,
      pt: `🚗 Info do adesivo:\n\n${status}\n\nPrecisa registrar um veículo? É só me avisar!`,
    })
  }

  if (isPayment) {
    if (ctx.division === 'residential' && ctx.rentvineContactId) {
      const d = await getRentvineContactData(ctx.rentvineContactId, ctx.persona)
      if (d?.balance !== null && d?.balance !== undefined) {
        void maybeRequestFeedback(ctx.phone, ctx, 'payment', ctx.channel)
        return translate(ctx.language, {
          en: `💰 Hi ${ctx.name.split(' ')[0]}!\n\nUnit: ${d.unitAddress ?? 'N/A'}\nBalance: $${d.balance!.toFixed(2)}${d.pastDue && d.pastDue > 0 ? `\nPast Due: $${d.pastDue.toFixed(2)} ⚠️` : ''}\n\nNeed help paying? 🌸`,
          es: `💰 ¡Hola ${ctx.name.split(' ')[0]}!\n\nUnidad: ${d.unitAddress ?? 'N/A'}\nSaldo: $${d.balance!.toFixed(2)}`,
          pt: `💰 Olá ${ctx.name.split(' ')[0]}!\n\nUnidade: ${d.unitAddress ?? 'N/A'}\nSaldo: $${d.balance!.toFixed(2)}`,
        })
      }
    }
    return await handlePaymentInquiry(ctx)
  }

  if (isSchedule) {
    await saveConversationState(ctx.phone, 'schedule', 'awaiting_type', {})
    return translate(ctx.language, {
      en: `📅 What type of appointment do you need?\n\n1 - Unit inspection\n2 - Move-in walkthrough\n3 - Meeting with management\n4 - Other`,
      es: `📅 ¿Qué tipo de cita?\n\n1 - Inspección  2 - Recorrido  3 - Reunión  4 - Otro`,
      pt: `📅 Que tipo de agendamento?\n\n1 - Inspeção  2 - Vistoria  3 - Reunião  4 - Outro`,
    })
  }

  // Board member check
  let isBoardMember = false, boardPosition = ''
  const cleanP = ctx.phone.replace(/\D/g, '')
  const { data: bm } = await getSupabase().from('board_members').select('position')
    .or(`phone.eq.${ctx.phone},phone.eq.+${cleanP}`).limit(1).maybeSingle()
  if (bm) { isBoardMember = true; boardPosition = bm.position ?? 'Board Member' }

  const isVoiceCall = ctx.channel === 'voice'

  // Pull customer-audience skills (triage policy, trade-troubleshooting,
  // etc.) and the live office-hours flag so the same triage rules MAIA
  // uses on web chat and email also apply on SMS / WhatsApp / voice.
  const skillsBlock = await buildSkillsPromptBlock('customer')
  const officeBlock = buildOfficeHoursBlock()

  const system = `You are Maia, a warm and caring virtual assistant for PMI Top Florida Properties, a professional property management company in South Florida managing 25 associations with 801 owners.

Respond ONLY in ${langName}. Be warm, friendly and concise.${isVoiceCall ? ' This is a VOICE CALL — keep responses under 2 sentences, no bullet points, no URLs, no emoji.' : ' Keep replies under 350 characters for SMS.'} Never say you are an AI unless directly asked.

CONTACT CONTEXT:
- Name: ${ctx.name}
- Role: ${isBoardMember ? boardPosition + ' (Board Member)' : ctx.persona.replace(/_/g, ' ')}
- Unit: ${ctx.unitId ?? 'unknown'} | Association: ${ctx.associationId ?? 'unknown'} | Division: ${ctx.division}
- Channel: ${ctx.channel.toUpperCase()}

DATABASE CONTEXT:
${dbContext || 'No additional context available'}

CONTACTS: ar@topfloridaproperties.com (HOA fees) | service@topfloridaproperties.com (maintenance) | support@topfloridaproperties.com (compliance) | billing@topfloridaproperties.com (vendor invoices)
PORTAL: https://pmitfp.cincwebaxis.com/ | HOURS: Mon–Thu 10AM–5PM, Fri 10AM–3PM
ESTOPPEL: https://secure.condocerts.com/resale/ (5–7 days)
APPLICATIONS: https://pmitopfloridaproperties.rentvine.com/public/apply
MAIL: P.O. Box 163556, Miami FL 33116
${isVoiceCall ? `
CROSS-CHANNEL CAPABILITY — YOU CAN SEND WHATSAPP MESSAGES:
- If the caller says "send this to my WhatsApp", "text me this", "send me that information", or similar → you can send a WhatsApp message to their number.
- If they are a known contact, their registered number is used automatically.
- If unknown, you will ask for their WhatsApp number.
- Proactively offer this when sharing complex info (balances, links, instructions): "I can also send this to your WhatsApp if you'd like!"
- After sending, confirm: "I've sent that to your WhatsApp."
` : ''}
Always end with a warm offer to help with anything else. 🌸${officeBlock}${skillsBlock}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, system, messages: [{ role: 'user', content: message }] }),
    })
    const d = await res.json()
    const text = d.content?.[0]?.text
    if (text) return text
  } catch (err) {
    console.error('[MAIA AI]', err)
  }
  return translate(ctx.language, {
    en: `I'd love to help! Let me connect you with our team. Reply 8 or email support@topfloridaproperties.com 🌸`,
    es: `¡Me encantaría ayudarte! Responde 8 o escribe a support@topfloridaproperties.com 🌸`,
    pt: `Adoraria te ajudar! Responda 8 ou escreva para support@topfloridaproperties.com 🌸`,
  })
}

// ============================================================
// PAYMENT INQUIRY
// ============================================================

async function handlePaymentInquiry(ctx: CallerContext): Promise<string> {
  const name = ctx.name.split(' ')[0]

  if (ctx.division === 'residential' && ctx.rentvineContactId) {
    try {
      const creds  = Buffer.from(`${process.env.RENTVINE_ACCESS_KEY}:${process.env.RENTVINE_SECRET}`).toString('base64')
      const res    = await fetch(`${process.env.RENTVINE_BASE_URL}/leases/export`, { headers: { Authorization: `Basic ${creds}` } })
      const leases = await res.json()
      const lease  = leases?.find((l: { lease: { tenants: { contactID: number }[] }; balances: { unpaidTotalAmount: number; pastDueTotalAmount: number } }) =>
        l.lease?.tenants?.some((t: { contactID: number }) => String(t.contactID) === ctx.rentvineContactId))
      if (lease) {
        const { unpaidTotalAmount, pastDueTotalAmount } = lease.balances
        void maybeRequestFeedback(ctx.phone, ctx, 'payment', ctx.channel)
        return translate(ctx.language, {
          en: `💰 Balance for ${name}:\n\nUnpaid: $${unpaidTotalAmount?.toFixed(2)}\nPast due: $${pastDueTotalAmount?.toFixed(2)}\n\nContact office to pay or reply *menu*.`,
          es: `💰 Pendiente: $${unpaidTotalAmount?.toFixed(2)} — Vencido: $${pastDueTotalAmount?.toFixed(2)}`,
          pt: `💰 Pendente: $${unpaidTotalAmount?.toFixed(2)} — Vencido: $${pastDueTotalAmount?.toFixed(2)}`,
        })
      }
    } catch (err) { console.error('[RENTVINE payment]', err) }
  }

  // No CSAT here — this is a generic reference card, not a resolved interaction.
  // Feedback is requested above only when we actually fetched a balance for the user.
  return translate(ctx.language, {
    en: `💰 Hi ${name}! HOA Payment Options:\n\n1️⃣ *ACH Autopay — FREE* ✅\nForm: https://drive.google.com/drive/folders/1RGGBxke8umRS6kH9PTX4P-SJmvuHCsJh\nEmail: ar@topfloridaproperties.com (processed 10th)\n\n2️⃣ *Online Portal* (fee)\nhttps://pmitfp.cincwebaxis.com/\n\n📱 App: "Property Management Inc" (Android/Apple)\n\n3️⃣ *Check by mail*\nPayable to: FULL HOA name | Write account # in MEMO\nPMI, P.O. Box 163556, Miami FL 33116\n\n📞 (305) 900-5105 🌸`,
    es: `💰 ¡Hola ${name}! Opciones HOA:\n\n1️⃣ ACH GRATIS ✅ — ar@topfloridaproperties.com\nFormulario: https://drive.google.com/drive/folders/1RGGBxke8umRS6kH9PTX4P-SJmvuHCsJh\n\n2️⃣ Portal: https://pmitfp.cincwebaxis.com/\n📱 App "Property Management Inc"\n\n3️⃣ Cheque: PMI, P.O. Box 163556, Miami FL 33116\n\n📞 (305) 900-5105 🌸`,
    pt: `💰 Olá ${name}! Opções HOA:\n\n1️⃣ ACH GRÁTIS ✅ — ar@topfloridaproperties.com\nFormulário: https://drive.google.com/drive/folders/1RGGBxke8umRS6kH9PTX4P-SJmvuHCsJh\n\n2️⃣ Portal: https://pmitfp.cincwebaxis.com/\n📱 App "Property Management Inc"\n\n3️⃣ Cheque: PMI, P.O. Box 163556, Miami FL 33116\n\n📞 (305) 900-5105 🌸`,
    fr: `💰 Bonjour ${name}!\n1️⃣ ACH gratuit — ar@topfloridaproperties.com\n2️⃣ https://pmitfp.cincwebaxis.com/\n3️⃣ Chèque: P.O. Box 163556, Miami FL 33116 🌸`,
    he: `💰 שלום ${name}!\n1️⃣ ACH חינם — ar@topfloridaproperties.com\n2️⃣ https://pmitfp.cincwebaxis.com/\n3️⃣ המחאה: P.O. Box 163556, Miami FL 33116 🌸`,
    ru: `💰 Привет ${name}!\n1️⃣ ACH бесплатно — ar@topfloridaproperties.com\n2️⃣ https://pmitfp.cincwebaxis.com/\n3️⃣ Чек: P.O. Box 163556, Miami FL 33116 🌸`,
  })
}

// ============================================================
// ACCOUNT INFO
// ============================================================

async function handleAccountInfo(ctx: CallerContext): Promise<string> {
  const [{ data: reqs }, { data: vehicles }] = await Promise.all([
    getSupabase().from('sticker_requests').select('id, status').eq('owner_id', ctx.phone).order('created_at', { ascending: false }).limit(3),
    getSupabase().from('vehicles').select('make, model, plate').eq('owner_id', ctx.phone).eq('active', true),
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

const AGENT_MSG = {
  identify: (lang: string, name: string) => ({ en:`👋 Hello ${name}! Agent Portal.\n\n1 - 🏠 Owner / Seller\n2 - 🔑 Buyer\n3 - 📋 Tenant / Renter`, es:`👋 ¡Hola ${name}! Portal de Agentes.\n\n1-🏠 Propietario  2-🔑 Comprador  3-📋 Inquilino`, pt:`👋 Olá ${name}! Portal de Corretores.\n\n1-🏠 Proprietário  2-🔑 Comprador  3-📋 Inquilino`, fr:`👋 Bonjour ${name}!\n1-🏠 Propriétaire  2-🔑 Acheteur  3-📋 Locataire`, he:`👋 שלום ${name}!\n1-🏠 בעלים  2-🔑 קונה  3-📋 שוכר`, ru:`👋 Привет ${name}!\n1-🏠 Владелец  2-🔑 Покупатель  3-📋 Арендатор` } as Record<string,string>)[lang] ?? 'Reply 1, 2, or 3.',
  ownerSelected: (lang: string) => ({ en:`🏠 Owner/Seller — upload signed listing agreement at:\n${process.env.NEXT_PUBLIC_APP_URL}/agents/upload\n\nOr reply with the property address.`, es:`🏠 Sube el acuerdo de listado firmado:\n${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, pt:`🏠 Envie o contrato de listagem assinado:\n${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, fr:`🏠 ${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, he:`🏠 ${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, ru:`🏠 ${process.env.NEXT_PUBLIC_APP_URL}/agents/upload` } as Record<string,string>)[lang] ?? `Upload at ${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`,
  buyerSelected: (lang: string) => ({ en:`🔑 Buyer — provide buyer's name, unit of interest, and what you need.\n\nOr: ${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, es:`🔑 Proporciona nombre, unidad y qué necesitas.\n${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, pt:`🔑 Informe nome, unidade e o que precisa.\n${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, fr:`🔑 ${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, he:`🔑 ${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, ru:`🔑 ${process.env.NEXT_PUBLIC_APP_URL}/agents/upload` } as Record<string,string>)[lang] ?? `${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`,
  tenantSelected: (lang: string) => ({ en:`📋 Tenant — provide tenant's name, unit of interest, and what you need.\n\nOr: ${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, es:`📋 Proporciona nombre, unidad y qué necesitas.\n${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, pt:`📋 Informe nome, unidade e o que precisa.\n${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, fr:`📋 ${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, he:`📋 ${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, ru:`📋 ${process.env.NEXT_PUBLIC_APP_URL}/agents/upload` } as Record<string,string>)[lang] ?? `${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`,
  notRegistered: (lang: string) => ({ en:`👤 You're not registered as an agent yet.\n\nRegister: ${process.env.NEXT_PUBLIC_APP_URL}/agents/register\n\nOr reply with your full name, license #, and brokerage.`, es:`👤 No estás registrado. Regístrate: ${process.env.NEXT_PUBLIC_APP_URL}/agents/register`, pt:`👤 Não cadastrado. Cadastre-se: ${process.env.NEXT_PUBLIC_APP_URL}/agents/register`, fr:`👤 ${process.env.NEXT_PUBLIC_APP_URL}/agents/register`, he:`👤 ${process.env.NEXT_PUBLIC_APP_URL}/agents/register`, ru:`👤 ${process.env.NEXT_PUBLIC_APP_URL}/agents/register` } as Record<string,string>)[lang] ?? `Register at ${process.env.NEXT_PUBLIC_APP_URL}/agents/register`,
  uploadReminder: (lang: string, name: string) => ({ en:`📎 Hi ${name} — still waiting for your listing agreement.\n\n${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, es:`📎 Hola ${name} — aún esperamos el acuerdo.\n${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, pt:`📎 Olá ${name} — ainda aguardamos o contrato.\n${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, fr:`📎 ${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, he:`📎 ${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`, ru:`📎 ${process.env.NEXT_PUBLIC_APP_URL}/agents/upload` } as Record<string,string>)[lang] ?? `${process.env.NEXT_PUBLIC_APP_URL}/agents/upload`,
  requestLogged: (lang: string, reqId: string) => ({ en:`✅ Request logged! Ref: ${reqId.slice(0,8)}\n\nOur team will send forms within 1 business day.`, es:`✅ ¡Solicitud registrada! Ref: ${reqId.slice(0,8)}`, pt:`✅ Solicitação registrada! Ref: ${reqId.slice(0,8)}`, fr:`✅ Ref: ${reqId.slice(0,8)}`, he:`✅ ${reqId.slice(0,8)}`, ru:`✅ ${reqId.slice(0,8)}` } as Record<string,string>)[lang] ?? `✅ Request logged.`,
  agreementReceived: (lang: string) => ({ en:`✅ Listing agreement received and under review. We'll confirm within 1 business day.`, es:`✅ Acuerdo de listado recibido y en revisión.`, pt:`✅ Contrato de listagem recebido e em análise.`, fr:`✅ Contrat reçu.`, he:`✅ הסכם התקבל.`, ru:`✅ Соглашение получено.` } as Record<string,string>)[lang] ?? `✅ Agreement received.`,
}

async function startAgentFlow(ctx: CallerContext): Promise<string> {
  if (ctx.persona !== 'real_estate_agent') return AGENT_MSG.notRegistered(ctx.language)
  const firstName = ctx.name !== 'there' ? ctx.name.split(' ')[0] : ''
  await saveConversationState(ctx.phone, 'agent_identification', 'awaiting_representation', { lang: ctx.language, agentName: firstName })
  return AGENT_MSG.identify(ctx.language, firstName)
}

async function continueAgentFlow(ctx: CallerContext, state: ConversationState, message: string): Promise<string> {
  const { current_step: step, temporary_data_json: data } = state
  const lang      = (data.lang as string) ?? ctx.language
  const agentName = (data.agentName as string) ?? ctx.name.split(' ')[0]
  const msg       = message.trim()

  if (step === 'awaiting_representation') {
    for (const [num, repType] of [['1','owner'],['2','buyer'],['3','tenant']] as [string,string][]) {
      if (msg === num) {
        const { data: req } = await getSupabase().from('agent_requests').insert({
          agent_id: await getAgentId(ctx.phone), representation_type: repType,
          status: repType === 'owner' ? 'awaiting_documents' : 'new',
          channel: ctx.channel, created_at: new Date().toISOString(),
        }).select('id').single()
        const nextStep = repType === 'owner' ? 'awaiting_address' : `awaiting_${repType}_details`
        await saveConversationState(ctx.phone, 'agent_identification', nextStep, { lang, agentName, repType, requestId: req?.id })
        await notifyAgentTeam(ctx, repType, req?.id ?? '')
        return repType === 'owner' ? AGENT_MSG.ownerSelected(lang) : repType === 'buyer' ? AGENT_MSG.buyerSelected(lang) : AGENT_MSG.tenantSelected(lang)
      }
    }
    return AGENT_MSG.identify(lang, agentName)
  }

  if (step === 'awaiting_address') {
    await getSupabase().from('agent_requests').update({ property_address: msg }).eq('id', data.requestId)
    const { data: req } = await getSupabase().from('agent_requests').select('listing_agreement_status').eq('id', data.requestId).single()
    if (req?.listing_agreement_status === 'uploaded' || req?.listing_agreement_status === 'approved') {
      await clearConversationState(ctx.phone)
      void maybeRequestFeedback(ctx.phone, ctx, 'agent_identification', ctx.channel)
      return AGENT_MSG.agreementReceived(lang)
    }
    await saveConversationState(ctx.phone, 'agent_identification', 'awaiting_listing_upload', { ...data, propertyAddress: msg })
    return AGENT_MSG.uploadReminder(lang, agentName)
  }

  if (step === 'awaiting_listing_upload') {
    const { data: req } = await getSupabase().from('agent_requests').select('listing_agreement_status').eq('id', data.requestId).single()
    if (req?.listing_agreement_status === 'uploaded' || req?.listing_agreement_status === 'approved') {
      await clearConversationState(ctx.phone)
      void maybeRequestFeedback(ctx.phone, ctx, 'agent_identification', ctx.channel)
      return AGENT_MSG.agreementReceived(lang)
    }
    return AGENT_MSG.uploadReminder(lang, agentName)
  }

  if (step === 'awaiting_buyer_details' || step === 'awaiting_tenant_details') {
    await getSupabase().from('agent_requests').update({ request_notes: msg, status: 'documents_received' }).eq('id', data.requestId)
    await clearConversationState(ctx.phone)
    void maybeRequestFeedback(ctx.phone, ctx, 'agent_identification', ctx.channel)
    return AGENT_MSG.requestLogged(lang, data.requestId as string)
  }

  await clearConversationState(ctx.phone)
  return startAgentFlow(ctx)
}

async function getAgentId(phone: string): Promise<string | null> {
  const { data } = await getSupabase().from('real_estate_agents').select('id').eq('phone', phone).single()
  return data?.id ?? null
}

async function notifyAgentTeam(ctx: CallerContext, repType: string, reqId: string): Promise<void> {
  const labels: Record<string,string> = { owner:'Owner / Listing Agent', buyer:'Buyer Agent', tenant:'Tenant Agent' }
  await notifyTeamByEmail(process.env.LEASING_EMAIL!, `🏡 Agent Request — ${labels[repType]} — ${ctx.name}`,
    `Agent: ${ctx.name}\nPhone: ${ctx.phone}\nRepresenting: ${labels[repType]}\nRequest ID: ${reqId}\n\nView: ${process.env.NEXT_PUBLIC_APP_URL}/admin/agents/${reqId}`)
}

;(FEEDBACK_CONFIG as Record<string,{type:FeedbackType}>)['agent_identification'] = { type: 'stars' }

// ============================================================
// SUPABASE HELPERS
// ============================================================

async function getConversationState(phone: string): Promise<ConversationState | null> {
  const { data } = await getSupabase().from('conversation_state').select('*').eq('phone_number', phone).single()
  return data
}

async function saveConversationState(phone: string, flow: string, step: string, tempData: Record<string, unknown>) {
  await getSupabase().from('conversation_state').upsert(
    { phone_number: phone, current_flow: flow, current_step: step, temporary_data_json: tempData, updated_at: new Date().toISOString() },
    { onConflict: 'phone_number' })
}

async function clearConversationState(phone: string) {
  await getSupabase().from('conversation_state').upsert(
    { phone_number: phone, current_flow: 'idle', current_step: 'idle', temporary_data_json: {}, updated_at: new Date().toISOString() },
    { onConflict: 'phone_number' })
}

async function getStickerStatus(ctx: CallerContext): Promise<string> {
  const { data } = await getSupabase().from('sticker_requests').select('id, status, payment_status')
    .eq('owner_id', ctx.phone).order('created_at', { ascending: false }).limit(1).single()
  if (!data) return translate(ctx.language, { en:`No sticker requests found. Reply *1* from the menu to start.`, es:`Sin solicitudes. Responde *1* para iniciar.`, pt:`Nenhuma solicitação. Responda *1* para iniciar.` })
  return translate(ctx.language, { en:`🚗 Request ${data.id.slice(0,8)} — ${data.status} — Payment: ${data.payment_status}`, es:`🚗 Solicitud ${data.id.slice(0,8)} — ${data.status}`, pt:`🚗 Solicitação ${data.id.slice(0,8)} — ${data.status}` })
}

async function createStickerRequest(ctx: CallerContext, vehicle: Record<string, string>) {
  const { data: v } = await getSupabase().from('vehicles').upsert(
    { owner_id: ctx.phone, make: vehicle.make, model: vehicle.model, color: vehicle.color, plate: vehicle.plate, active: true },
    { onConflict: 'owner_id,plate' }).select().single()
  await getSupabase().from('sticker_requests').insert({
    owner_id: ctx.phone, vehicle_id: v?.id, association_id: ctx.associationId,
    request_source: ctx.channel, status: 'pending', payment_status: 'unpaid',
    payment_required: true, created_at: new Date().toISOString(),
  })
}

async function createAssociationMaintenanceRequest(ctx: CallerContext, description: string) {
  await getSupabase().from('maintenance_requests').insert({
    owner_id: ctx.phone, unit_id: ctx.unitId, association_id: ctx.associationId, description,
    urgency: description.toLowerCase().includes('emergency') ? 'emergency' : 'medium',
    status: 'open', created_at: new Date().toISOString(),
  })
  await notifyTeamByEmail(process.env.MAINTENANCE_EMAIL!, `New Maintenance — Unit ${ctx.unitId ?? 'Unknown'}`,
    `From: ${ctx.name} (${ctx.phone})\nUnit: ${ctx.unitId}\nIssue: ${description}`)
}

async function createRentvineWorkOrder(ctx: CallerContext, description: string): Promise<string> {
  const creds = Buffer.from(`${process.env.RENTVINE_ACCESS_KEY}:${process.env.RENTVINE_SECRET}`).toString('base64')
  try {
    const res  = await fetch(`${process.env.RENTVINE_BASE_URL}/maintenance/work-orders`, {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, priority: description.toLowerCase().includes('emergency') ? 'urgent' : 'normal',
        contactID: ctx.rentvineContactId ? parseInt(ctx.rentvineContactId) : undefined, source: ctx.channel }),
    })
    const data = await res.json()
    return data?.workOrderID ? String(data.workOrderID) : 'WO-' + Date.now()
  } catch { return 'WO-' + Date.now() }
}

async function logConversation(phone: string, inbound: string, outbound: string, ctx: CallerContext) {
  await getSupabase().from('general_conversations').insert({
    session_id:    `twilio-${phone}-${Date.now()}`,
    phone_number:  phone,
    contact_phone: phone,
    contact_name:  ctx.name !== 'there' ? ctx.name : null,
    persona:       ctx.persona,
    language:      ctx.language,
    channel:       ctx.channel,
    topic:         ctx.persona,
    summary:       `IN: ${inbound.slice(0, 100)} | OUT: ${outbound.slice(0, 100)}`,
    message:       inbound,
    response:      outbound,
    messages:      [
      { role: 'user',      content: inbound  },
      { role: 'assistant', content: outbound },
    ],
    status:        'open',
    created_at:    new Date().toISOString(),
    updated_at:    new Date().toISOString(),
  })

  // Mirror into the ticket primitive so SMS/WhatsApp/voice show up in the
  // unified dashboard. Auto-threads onto the contact's open ticket if one
  // exists within the recency window; otherwise creates a new ticket.
  // Awaited (not fire-and-forget): Vercel can freeze the function immediately
  // after the response, killing in-flight Promises mid-flight. The ticket
  // ingest is several sequential Supabase calls and was getting cut off.
  await ingestTwilioConversationToTicket(phone, inbound, outbound, ctx)
}

async function ingestTwilioConversationToTicket(
  phone: string,
  inbound: string,
  outbound: string,
  ctx: CallerContext,
): Promise<void> {
  try {
    const channelOrigin = ctx.channel === 'voice' ? 'phone' : ctx.channel
    const ticket = await findOrCreateTicket({
      channel_origin:   channelOrigin,
      persona:          ctx.persona,
      contact_name:     ctx.name !== 'there' ? ctx.name : null,
      contact_phone:    phone,
      subject:          inbound.slice(0, 120),
      summary:          inbound.slice(0, 280),
    })
    await appendMessage(ticket.id, {
      direction: 'inbound',
      channel:   channelOrigin,
      from_addr: phone,
      body:      inbound,
    })
    await appendMessage(ticket.id, {
      direction: 'outbound',
      channel:   channelOrigin,
      to_addr:   phone,
      body:      outbound,
    })
  } catch (err) {
    console.error('[tickets] ingest twilio conversation failed:', err instanceof Error ? err.message : err)
  }
}

// ============================================================
// NOTIFICATIONS
// ============================================================

async function notifyStaff(ctx: CallerContext, message: string) {
  await notifyTeamByEmail(process.env.STAFF_EMAIL!, `Staff Request — ${ctx.persona} (${ctx.name})`,
    `Contact: ${ctx.name}\nPhone: ${ctx.phone}\nChannel: ${ctx.channel}\n\nMessage: ${message}`)
}

async function alertEmergencyTeam(ctx: CallerContext) {
  await notifyTeamByEmail(process.env.EMERGENCY_EMAIL!, `🚨 EMERGENCY — ${ctx.name} Unit ${ctx.unitId ?? 'Unknown'}`,
    `Contact: ${ctx.name}\nPhone: ${ctx.phone}\nUnit: ${ctx.unitId}`)
  try {
    await twilioClient.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: process.env.EMERGENCY_PHONE!,
      body: `🚨 EMERGENCY: ${ctx.name} (${ctx.phone}) Unit ${ctx.unitId ?? 'Unknown'} — respond immediately`,
    })
  } catch (err) { console.error('[EMERGENCY SMS]', err) }
}

async function notifyTeamByEmail(to: string, subject: string, body: string) {
  await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/send-email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, body }),
  }).catch(err => console.error('[EMAIL]', err))
}

// ============================================================
// ✅ FIX 2 — sendReply uses TWILIO_WHATSAPP_NUMBER env var
// Previously hardcoded to sandbox +14155238886 — now fixed
// ============================================================

async function sendReply(phone: string, text: string, channel: Channel) {
  const from = channel === 'whatsapp'
    ? `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`
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
  return ({ en:`Hello ${first}! Thank you for calling PMI Top Florida Properties. How can I help you today?`, es:`Hola ${first}! Gracias por llamar a PMI Top Florida Properties. ¿En qué puedo ayudarle?`, pt:`Olá ${first}! Obrigado por ligar para a PMI Top Florida Properties. Como posso ajudar?`, fr:`Bonjour! Merci d'avoir appelé PMI Top Florida Properties. Comment puis-je vous aider?`, he:`שלום! תודה על השיחה ל-PMI Top Florida Properties.`, ru:`Здравствуйте! Спасибо за звонок в PMI Top Florida Properties.` } as Record<string,string>)[ctx.language] ?? `Hello! How can I help?`
}

function getListenPrompt(lang: string): string {
  return ({ en:'Please describe how I can help you.', es:'Por favor describa cómo puedo ayudarle.', pt:'Por favor descreva como posso ajudar.', fr:'Veuillez décrire comment je peux vous aider.', he:'אנא תאר כיצד אוכל לעזור לך.', ru:'Пожалуйста, опишите, как я могу вам помочь.' } as Record<string,string>)[lang] ?? 'How can I help?'
}

// Amazon Polly voices — available on all Twilio accounts, no add-on required
function getVoiceForLanguage(lang: string): string {
  return ({
    en: 'Polly.Joanna',
    es: 'Polly.Lupe',
    pt: 'Polly.Camila',
    fr: 'Polly.Celine',
    he: 'Polly.Joanna',  // Hebrew unavailable in Polly; fallback to English
    ru: 'Polly.Tatyana',
  } as Record<string, string>)[lang] ?? 'Polly.Joanna'
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// ============================================================
// TRANSLATION HELPER
// ============================================================

function translate(language: string, options: Partial<Record<'en'|'es'|'pt'|'fr'|'he'|'ru', string>>): string {
  return options[language as keyof typeof options] ?? options.en ?? Object.values(options)[0] ?? ''
}