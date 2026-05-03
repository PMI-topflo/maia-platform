// =====================================================================
// app/api/apply/parse-lease/route.ts
//
// POST — accepts a lease or purchase agreement (PDF/JPG/PNG),
// saves to Supabase Storage, extracts property data with Gemini Flash,
// matches to a known association, and (when GOOGLE_SERVICE_ACCOUNT_JSON
// is present) saves to the correct Google Drive unit folder.
//
// Returns:
//   { extracted, matched, storagePath, driveFileId }
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const maxDuration = 30

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']
const MAX_BYTES = 10 * 1024 * 1024

const EXTRACTION_PROMPT = `You are reading a residential lease or purchase/sale agreement.
Extract the following and return STRICT JSON only — no markdown, no prose:
{
  "association": "<HOA, condo, or community name — exactly as written on the document, or null>",
  "address": "<full property address including street, city, state, zip — or null>",
  "unit": "<unit/apt/suite number only (e.g. '203', 'A', '14B') — or null>",
  "moveIn": "<lease start date or closing date in YYYY-MM-DD format — or null>",
  "tenants": ["<full legal name of each tenant or buyer listed>"]
}
If a field cannot be determined, use null. For tenants use an empty array if none found.
Do NOT include any text outside the JSON object.`

export async function POST(req: NextRequest) {
  // ── Parse multipart form ──────────────────────────────────────────
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = form.get('lease') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const mimeType = file.type.split(';')[0].trim()
  if (!ALLOWED_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: 'Only PDF, JPG, or PNG allowed' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large — max 10 MB' }, { status: 400 })
  }

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)

  // ── Save to Supabase Storage (pending-leases bucket path) ─────────
  const ts = Date.now()
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'
  const storagePath = `pending-leases/${ts}/lease.${ext}`

  const { error: storageErr } = await supabaseAdmin.storage
    .from('application-docs')
    .upload(storagePath, buffer, { contentType: mimeType, upsert: false })

  if (storageErr) {
    console.error('[parse-lease] storage upload failed', storageErr)
    // Non-fatal — continue with extraction
  }

  // ── Extract with Gemini Flash ─────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Document parsing is not yet configured. Please contact us to apply.' },
      { status: 503 }
    )
  }

  type Extracted = {
    association: string | null
    address: string | null
    unit: string | null
    moveIn: string | null
    tenants: string[]
  }

  let extracted: Extracted = { association: null, address: null, unit: null, moveIn: null, tenants: [] }

  // Normalise MIME type to what Gemini accepts
  const geminiMime = mimeType.includes('pdf') ? 'application/pdf'
    : mimeType.includes('png') ? 'image/png'
    : 'image/jpeg'

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
    // inlineData must come before the text prompt (matches drive-scan pattern)
    const result = await model.generateContent([
      { inlineData: { data: buffer.toString('base64'), mimeType: geminiMime } },
      { text: EXTRACTION_PROMPT },
    ])
    const raw = result.response.text().trim()
    // Extract the first JSON object from anywhere in the response
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response: ' + raw.slice(0, 300))
    extracted = JSON.parse(jsonMatch[0])
    if (!Array.isArray(extracted.tenants)) extracted.tenants = []
  } catch (err) {
    console.error('[parse-lease] Gemini extraction error', err)
    return NextResponse.json(
      { error: 'Could not read your document. Please try a clearer scan or contact us.' },
      { status: 422 }
    )
  }

  // ── Match extracted association to known associations ─────────────
  const { data: assocs } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name, principal_address, city, state, zip')
    .eq('active', true)

  type AssocRow = { association_code: string; association_name: string; principal_address: string; city: string; state: string; zip: string }
  let matched: AssocRow | null = null

  if (assocs && extracted.association) {
    const q = extracted.association.toLowerCase().trim()
    matched =
      (assocs as AssocRow[]).find((a) => a.association_name.toLowerCase() === q) ??
      (assocs as AssocRow[]).find(
        (a) =>
          a.association_name.toLowerCase().includes(q) ||
          q.includes(a.association_name.toLowerCase())
      ) ??
      null
  }

  // ── Save to Google Drive (non-fatal if not configured) ────────────
  let driveFileId: string | null = null
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      driveFileId = await saveLeaseToDrive(buffer, ext, mimeType, extracted, matched)
    } catch (err) {
      console.error('[parse-lease] Drive save failed (non-fatal)', err)
    }
  }

  return NextResponse.json({
    extracted,
    matched: matched
      ? {
          code: matched.association_code,
          name: matched.association_name,
          address: [matched.principal_address, matched.city, matched.state, matched.zip]
            .filter(Boolean)
            .join(', '),
        }
      : null,
    storagePath,
    driveFileId,
  })
}

// ─────────────────────────────────────────────────────────────────────
// Google Drive upload — finds or creates the correct unit folder
// Structure: [drive_root_folder_id] → UNIT Docs → [unit] or New Applications
// ─────────────────────────────────────────────────────────────────────
async function saveLeaseToDrive(
  buffer: Buffer,
  ext: string,
  mimeType: string,
  extracted: { association: string | null; unit: string | null },
  matched: { association_code: string; association_name: string } | null
): Promise<string> {
  const { google } = await import('googleapis')
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!)
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  const drive = google.drive({ version: 'v3', auth })

  // Look up drive_root_folder_id from association_config
  let rootFolderId: string | null = null
  if (matched) {
    const { data } = await supabaseAdmin
      .from('association_config')
      .select('drive_root_folder_id')
      .eq('association_code', matched.association_code)
      .maybeSingle()
    rootFolderId = (data as { drive_root_folder_id: string | null } | null)?.drive_root_folder_id ?? null
  }

  // Fallback to MANXI_PARENT_FOLDER_ID env var
  if (!rootFolderId) {
    rootFolderId = process.env.MANXI_PARENT_FOLDER_ID ?? null
  }
  if (!rootFolderId) throw new Error('No Drive root folder configured for this association')

  // Find or create UNIT Docs → [unit number] or New Applications
  const unitDocsFolderId = await findOrCreateFolder(drive, 'UNIT Docs', rootFolderId)
  const unitLabel = extracted.unit?.trim() || null
  const targetFolderId = await findOrCreateFolder(
    drive,
    unitLabel ?? 'New Applications',
    unitDocsFolderId
  )

  // Upload the file
  const { Readable } = await import('stream')
  const res = await drive.files.create({
    requestBody: {
      name: `lease_application_${Date.now()}.${ext}`,
      parents: [targetFolderId],
    },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id',
  })

  return res.data.id!
}

async function findOrCreateFolder(
  drive: ReturnType<typeof import('googleapis').google.drive>,
  name: string,
  parentId: string
): Promise<string> {
  const safe = name.replace(/'/g, "\\'")
  const list = await drive.files.list({
    q: `name = '${safe}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`,
    fields: 'files(id)',
    spaces: 'drive',
  })
  if (list.data.files?.[0]?.id) return list.data.files[0].id

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  })
  return created.data.id!
}
