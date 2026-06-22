// =====================================================================
// lib/extract-image.ts
//
// Reads an uploaded image with Claude vision and returns a faithful text
// transcription/description, so the "Teach MAIA" studio can ingest
// screenshots, scanned notices, flyers, signage photos, etc. — not just
// PDFs. The transcription then flows through the same understandContent()
// teach loop as text and PDFs.
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'

const VISION_MODEL = 'claude-haiku-4-5-20251001'
const MAX_BYTES = 8 * 1024 * 1024 // 8 MB — Anthropic image cap headroom

const SUPPORTED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export interface ImageExtractResult {
  status: 'done' | 'skipped' | 'failed'
  text:   string | null
  error:  string | null
}

function normalizeMedia(mime: string | null | undefined): string | null {
  const m = (mime ?? '').toLowerCase()
  if (SUPPORTED.has(m)) return m
  if (m === 'image/jpg') return 'image/jpeg'
  return null
}

const client = new Anthropic()

export async function extractImageText(
  buffer: Buffer,
  mimeType: string | null | undefined,
): Promise<ImageExtractResult> {
  const media = normalizeMedia(mimeType)
  if (!media) {
    return { status: 'skipped', text: null, error: `Unsupported image type: ${mimeType ?? 'unknown'} (use JPEG/PNG/GIF/WebP)` }
  }
  if (buffer.byteLength > MAX_BYTES) {
    return { status: 'skipped', text: null, error: `Image is ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB; max ${MAX_BYTES / 1024 / 1024} MB` }
  }

  try {
    const resp = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: media as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: buffer.toString('base64') },
          },
          {
            type: 'text',
            text: 'Transcribe everything in this image faithfully. Include all visible text verbatim (titles, body, dates, amounts, phone numbers, hours). If it is a form or table, preserve the structure. Then add a one-line note describing what the image is. Do not summarize away details.',
          },
        ],
      }],
    })
    const text = resp.content[0]?.type === 'text' ? resp.content[0].text.trim() : ''
    return { status: 'done', text: text || null, error: text ? null : 'No text returned' }
  } catch (err) {
    return { status: 'failed', text: null, error: err instanceof Error ? err.message : String(err) }
  }
}
