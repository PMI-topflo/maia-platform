// =====================================================================
// app/api/apply/parse-sunbiz/route.ts
//
// POST — accepts a Florida Sunbiz registration printout (PDF/JPG/PNG) and
// extracts the entity name, registration/document number, and all listed
// principals using Gemini Flash. Server-side so the API key is never exposed
// to the browser. Returns:
//   { entity_name, registration_number, principals: [{ name, title }] }
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { normalizeUpload } from '@/lib/pdf-normalize'

export const runtime = 'nodejs'
export const maxDuration = 60

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']
const MAX_BYTES = 10 * 1024 * 1024

const EXTRACTION_PROMPT = `You are reading a Florida Sunbiz (Division of Corporations) business registration document.
Extract the following and return STRICT JSON only — no markdown, no prose:
{
  "entity_name": "<the full legal entity name exactly as registered — or null>",
  "registration_number": "<the document/registration number (e.g. L21000123456, P98000012345) — or null>",
  "principals": [{ "name": "<full name of each officer, director, manager, member, or authorized person>", "title": "<their title if shown, else null>" }]
}
Include every natural person listed as a principal/officer/manager/member. If a field cannot be determined use null; use an empty array for principals if none are found. Do NOT include any text outside the JSON object.`

export async function POST(req: NextRequest) {
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }) }

  const file = form.get('sunbiz') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const mimeType = file.type.split(';')[0].trim()
  if (!ALLOWED_TYPES.includes(mimeType)) return NextResponse.json({ error: 'Only PDF, JPG, or PNG allowed' }, { status: 400 })
  if (file.size > MAX_BYTES)             return NextResponse.json({ error: 'File too large — max 10 MB' }, { status: 400 })

  const { buffer } = await normalizeUpload(Buffer.from(await file.arrayBuffer()), { contentType: mimeType, filename: file.name })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Document parsing is not configured.' }, { status: 503 })

  const geminiMime = mimeType.includes('pdf') ? 'application/pdf' : mimeType.includes('png') ? 'image/png' : 'image/jpeg'

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
    const result = await model.generateContent([
      { inlineData: { data: buffer.toString('base64'), mimeType: geminiMime } },
      { text: EXTRACTION_PROMPT },
    ])
    const raw = result.response.text().trim()
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')
    const parsed = JSON.parse(jsonMatch[0]) as { entity_name?: string | null; registration_number?: string | null; principals?: { name?: string; title?: string | null }[] }
    const principals = Array.isArray(parsed.principals)
      ? parsed.principals.filter(p => p?.name).map(p => ({ name: String(p.name), title: p.title ?? '' }))
      : []
    return NextResponse.json({
      entity_name: parsed.entity_name ?? null,
      registration_number: parsed.registration_number ?? null,
      principals,
    })
  } catch (err) {
    console.error('[parse-sunbiz] extraction error', err)
    return NextResponse.json({ error: 'Could not read the document' }, { status: 422 })
  }
}
