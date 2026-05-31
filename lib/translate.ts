// =====================================================================
// lib/translate.ts — small Claude-backed translation helper.
// Durable records (ticket reports) are stored in English (canonical-
// English rule); vendor crew write in Spanish/etc. Best-effort: returns
// the original text on any failure or when not configured.
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-4-5-20251001'

const LANG_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', pt: 'Portuguese', ht: 'Haitian Creole', fr: 'French',
}

/** Translate free text to English. No-op for empty text, English source,
 *  or when ANTHROPIC_API_KEY is missing. */
export async function translateToEnglish(text: string | null | undefined, sourceLang?: string | null): Promise<string> {
  const t = (text ?? '').trim()
  if (!t) return ''
  if (sourceLang === 'en') return t
  if (!process.env.ANTHROPIC_API_KEY) return t
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const from = sourceLang && LANG_NAMES[sourceLang] ? ` from ${LANG_NAMES[sourceLang]}` : ''
    const resp = await anthropic.messages.create({
      model: MODEL, max_tokens: 1200,
      system: `Translate the user's text${from} to English. Output ONLY the English translation — no preamble, no quotes. If it is already English, return it unchanged.`,
      messages: [{ role: 'user', content: t }],
    })
    const out = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
    return out || t
  } catch {
    return t
  }
}
