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
import { normalizeUpload } from '@/lib/pdf-normalize'

export const runtime = 'nodejs'
export const maxDuration = 60

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']
const MAX_BYTES = 10 * 1024 * 1024

const EXTRACTION_PROMPT = `You are reading a residential lease or purchase/sale agreement.
Extract the following and return STRICT JSON only — no markdown, no prose:
{
  "association": "<HOA, condo, or community name — exactly as written on the document, or null>",
  "address": "<full property address including street, city, state, zip — or null>",
  "unit": "<unit/apt/suite number only (e.g. '203', 'A', '14B') — or null>",
  "moveIn": "<lease start date or closing date in YYYY-MM-DD format — or null>",
  "entity": "<if the tenant or buyer is a company, LLC, Inc, Corp, Trust, LP, LLP, Foundation, or any legal entity — return its exact legal name; otherwise null>",
  "tenants": ["<full legal name of each individual tenant or buyer listed — exclude entity names>"],
  "landlord": "<full legal name of the LANDLORD / LESSOR / SELLER / OWNER as written on the document — include company suffix (LLC, Inc, Trust, etc.) — null if not stated>"
}
If a field cannot be determined, use null. For tenants use an empty array if none found.
If the buyer/tenant is an entity, put its name in 'entity' and leave 'tenants' empty or with any individual co-signers listed separately.
The landlord is the party RENTING OUT or SELLING the property — often labeled "Lessor", "Landlord", "Seller", "Owner", or "Grantor". This is critical for matching the property to its owner record.
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
  // Shrink oversized phone-scan uploads before storing / extracting.
  const { buffer } = await normalizeUpload(Buffer.from(bytes), { contentType: mimeType, filename: file.name })

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
    entity: string | null
    tenants: string[]
    landlord: string | null
  }

  let extracted: Extracted = { association: null, address: null, unit: null, moveIn: null, entity: null, tenants: [], landlord: null }

  // Normalise MIME type to what Gemini accepts
  const geminiMime = mimeType.includes('pdf') ? 'application/pdf'
    : mimeType.includes('png') ? 'image/png'
    : 'image/jpeg'

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
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
  // Strategy (in order of trust):
  //   1. Name match — Gemini sometimes pulls a clean HOA name like
  //      "7636 Abbott Avenue Condominium Association, Inc.".
  //   2. Address match — most leases just list the property address;
  //      we look up owners.address + city + zip + street_number to find
  //      which association owns that unit.
  //   3. Landlord name match — the lessor named on the lease should be
  //      the unit owner in MAIA. Match owners.first_name + last_name
  //      + entity_name fuzzy.
  //
  // We try ALL signals and keep the best confidence score. If multiple
  // signals agree, that's a strong match. If they conflict, we tip
  // toward the user's dropdown selection (passed as selected_assoc_code).
  const { data: assocs } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name, principal_address, city, state, zip')
    .eq('active', true)

  type AssocRow = { association_code: string; association_name: string; principal_address: string; city: string; state: string; zip: string }
  let matched: AssocRow | null = null

  const userSelectedCode = (form.get('selected_assoc_code')?.toString() ?? '').toUpperCase().trim()

  // Signal 1: name match
  let nameMatchedCode: string | null = null
  if (assocs && extracted.association) {
    const r = matchAssociation(extracted.association, extracted.address, assocs as AssocRow[], null) as AssocRow | null
    if (r) nameMatchedCode = r.association_code
  }

  // Signal 2: address match — query owners by extracted address signals
  let addressMatchedCode: string | null = null
  if (extracted.address) {
    addressMatchedCode = await findAssociationByAddress(extracted.address)
  }

  // Signal 3: landlord match — look up owner by the lessor name on the
  // lease. Skips when the landlord is one of OUR management entities
  // (PMI, the management company itself) since those won't be in the
  // owners table.
  let landlordMatchedCode: string | null = null
  if (extracted.landlord && !looksLikeManagementCompany(extracted.landlord)) {
    landlordMatchedCode = await findAssociationByOwnerName(extracted.landlord)
  }

  // Pick the winning code: prefer signals that AGREE, fall back to
  // the user's dropdown when ambiguous.
  const winningCode = resolveWinningCode({
    nameMatchedCode,
    addressMatchedCode,
    landlordMatchedCode,
    userSelectedCode: userSelectedCode || null,
  })

  if (winningCode && assocs) {
    matched = (assocs as AssocRow[]).find(a => a.association_code === winningCode) ?? null
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
  extracted: { association: string | null; unit: string | null; entity: string | null; tenants: string[] },
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

  // Build application subfolder label: {account} - {YYYY} - {Month} - {Name}
  const now = new Date()
  const year = now.getFullYear()
  const month = now.toLocaleString('en-US', { month: 'long' })
  const applicantName = (extracted.entity ?? extracted.tenants[0] ?? 'Unknown Applicant')
    .replace(/[/\\:*?"<>|]/g, '').trim()

  const unitDocsFolderId = await findOrCreateFolder(drive, 'UNIT Docs', rootFolderId)
  const unitNumber = extracted.unit?.trim() || null
  let unitFolderLabel: string = 'New Applications'
  let accountNumber: string | null = null

  if (unitNumber && matched) {
    const { data: hw } = await supabaseAdmin
      .from('owners')
      .select('account_number, street_number, address')
      .eq('association_code', matched.association_code)
      .eq('unit_number', unitNumber)
      .limit(1)
      .maybeSingle()
    if (hw?.account_number) {
      const acct: string = hw.account_number
      accountNumber = acct
      const propertyAddress = [hw.street_number, hw.address].filter(Boolean).join(' ').trim()
      unitFolderLabel = propertyAddress
        ? `${acct} - ${propertyAddress}`
        : acct
    } else if (unitNumber) {
      unitFolderLabel = unitNumber
    }
  }

  const unitFolderId = await findOrCreateFolder(drive, unitFolderLabel, unitDocsFolderId)

  // Application subfolder: {account} - {YYYY} - {Month} - {Name}
  const appFolderLabel = accountNumber
    ? `${accountNumber} - ${year} - ${month} - ${applicantName}`
    : `${year} - ${month} - ${applicantName}`
  const targetFolderId = await findOrCreateFolder(drive, appFolderLabel, unitFolderId)

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

// ─────────────────────────────────────────────────────────────────────
// Association matcher
//
// Real-world data is messy: a lease might say "7636 Abbott Ave Condo"
// while MAIA stores it as "7636 Abbott Avenue Condominium Association,
// Inc.". The naive substring matcher missed those cases.
//
// Strategy here, in priority order:
//   1. Exact normalized-string equality
//   2. Substring containment (either direction)
//   3. Token overlap on normalized tokens (abbreviations expanded,
//      generic suffix words like "inc"/"association" stripped) —
//      requires the SHORTER token set to be a high-percentage subset
//      of the longer set
//   4. ZIP code match between extracted address + association zip,
//      used only when no name match cleared the threshold
//   5. User-selected tiebreaker: if the applicant chose a code in the
//      dropdown before uploading, ANY ambiguous match for that code
//      wins over higher-scoring matches for other codes
//
// Returns the best AssocRow at or above SCORE_THRESHOLD, or null.
// ─────────────────────────────────────────────────────────────────────

type AssocRowMatchable = {
  association_code: string
  association_name: string
  principal_address?: string
  city?: string
  state?: string
  zip?: string
}

const STREET_ABBREVS: Record<string, string> = {
  ave: 'avenue',    av:  'avenue',    avenue:  'avenue',
  blvd: 'boulevard', boulevard: 'boulevard',
  rd:  'road',      road: 'road',
  st:  'street',    street: 'street',
  ct:  'court',     court: 'court',
  dr:  'drive',     drive: 'drive',
  ln:  'lane',      lane: 'lane',
  pl:  'place',     place: 'place',
  pkwy: 'parkway',  parkway: 'parkway',
  ter: 'terrace',   terr: 'terrace', terrace: 'terrace',
  cir: 'circle',    circle: 'circle',
  hwy: 'highway',   highway: 'highway',
  // Property-type abbreviations
  condo: 'condominium', cdo: 'condominium', condominium: 'condominium',
  coop:  'cooperative', cooperative: 'cooperative',
  apts:  'apartments',  apt: 'apartments',  apartments: 'apartments',
  hoa:   'homeowners',
}

// Generic entity-suffix and noise words that don't help disambiguate.
const STOP_WORDS = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'corp', 'corporation', 'co',
  'the', 'a', 'an', 'of', 'and', '&',
  'association', 'associations', 'community',
])

function normalizeName(s: string): { raw: string; tokens: string[] } {
  const cleaned = (s ?? '')
    .toLowerCase()
    .replace(/[.,'"()/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const tokens = cleaned.split(/\s+/)
    .map(t => STREET_ABBREVS[t] ?? t)
    .filter(t => t && !STOP_WORDS.has(t))
  return { raw: cleaned, tokens }
}

const SCORE_THRESHOLD = 50

function scoreName(extracted: string, assocName: string): number {
  const a = normalizeName(extracted)
  const b = normalizeName(assocName)
  if (!a.raw || !b.raw) return 0
  if (a.raw === b.raw) return 100
  if (a.raw.includes(b.raw) || b.raw.includes(a.raw)) return 90

  // Token overlap. Compare in the direction of the SHORTER set so a
  // very short extracted name like "Abbott Condo" can still match the
  // longer official name when its tokens are all subset.
  const setA = new Set(a.tokens)
  const setB = new Set(b.tokens)
  if (setA.size === 0 || setB.size === 0) return 0
  const [shorter, longer] = setA.size <= setB.size ? [setA, setB] : [setB, setA]
  let common = 0
  for (const t of shorter) if (longer.has(t)) common++
  const pct = common / shorter.size
  // A near-complete subset (≥ 2 tokens in common AND ≥ 75% of the
  // shorter set present) is a strong signal — typical for cases like
  // "7636 abbott ave condo" → "7636 abbott avenue condominium".
  if (pct >= 0.75 && common >= 2) return 75
  if (pct >= 0.6  && common >= 2) return 55
  return 0
}

function matchAssociation(
  extractedName:    string,
  extractedAddress: string | null,
  candidates:       AssocRowMatchable[],
  userSelectedCode: string | null,
): AssocRowMatchable | null {
  // Score every candidate on name + a small bonus for matching ZIP /
  // address tokens when the lease address is available.
  const extractedAddrLower = (extractedAddress ?? '').toLowerCase()
  const extractedZip = extractedAddrLower.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? null

  type Scored = { row: AssocRowMatchable; score: number }
  const scored: Scored[] = candidates.map(row => {
    let score = scoreName(extractedName, row.association_name)
    if (extractedZip && row.zip === extractedZip) score += 15
    if (extractedAddrLower && row.principal_address && extractedAddrLower.includes(row.principal_address.toLowerCase())) {
      score += 20
    }
    return { row, score }
  })

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (!best || best.score < SCORE_THRESHOLD) {
    // Last-resort tiebreaker: applicant explicitly picked an assoc
    // from the dropdown. Trust them when there's no confident name
    // match — better to confirm-by-asking than block the application
    // outright with "Association not recognized".
    if (userSelectedCode) {
      const picked = candidates.find(c => c.association_code.toUpperCase() === userSelectedCode)
      if (picked) return picked
    }
    return null
  }

  // Borderline name match (50-74) AND the user pre-picked one of the
  // top candidates: lean toward what they picked. Avoids the case
  // where two associations have overlapping names and the matcher
  // picked the wrong one.
  if (best.score < 80 && userSelectedCode) {
    const userPick = scored.find(s => s.row.association_code.toUpperCase() === userSelectedCode && s.score >= SCORE_THRESHOLD - 20)
    if (userPick) return userPick.row
  }

  return best.row
}

// ─────────────────────────────────────────────────────────────────────
// Address-based matching
//
// Many leases don't name the HOA at all — they only carry the property
// address. We look up owners whose address fields are consistent with
// the extracted address, then return the association_code that owner
// belongs to. Most-frequent code among matching owner rows wins, so
// a stray duplicate doesn't pull the match the wrong way.
// ─────────────────────────────────────────────────────────────────────
async function findAssociationByAddress(extractedAddress: string): Promise<string | null> {
  const addr = extractedAddress.toLowerCase().trim()
  if (!addr) return null

  // Pull out the strong signals: ZIP, leading street number, and the
  // street name word (e.g. "abbott"). All three combined are nearly
  // unique even across associations.
  const zip = addr.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? null
  const streetNo = addr.match(/\b(\d{3,6})\s+([a-z]+)/)?.[1] ?? null
  const streetName = addr.match(/\b\d{3,6}\s+([a-z]+)/)?.[1] ?? null

  // No usable signal at all — bail.
  if (!zip && !streetNo) return null

  // Cast wide on initial query then filter in memory. We're already
  // hitting the row LIMIT, so a couple of dozen-row pull is cheap and
  // saves us building complex OR clauses.
  const { data: owners } = await supabaseAdmin
    .from('owners')
    .select('association_code, address, street_number, city, state, zip_code')
    .or('status.neq.previous,status.is.null')
    .limit(2000)

  if (!owners?.length) return null

  const tally = new Map<string, number>()
  for (const o of owners as Array<{
    association_code: string | null
    address: string | null
    street_number: string | number | null
    city: string | null
    state: string | null
    zip_code: string | null
  }>) {
    if (!o.association_code) continue
    let hits = 0
    if (zip && o.zip_code === zip) hits++
    if (streetNo && String(o.street_number ?? '') === streetNo) hits++
    if (streetName && (o.address ?? '').toLowerCase().includes(streetName)) hits++
    // Need at least TWO signals lining up to count, so a stray owner
    // with a matching ZIP doesn't pull the association the wrong way.
    if (hits >= 2) tally.set(o.association_code, (tally.get(o.association_code) ?? 0) + 1)
  }

  if (tally.size === 0) return null
  // Pick the association_code that the most owner rows agreed on.
  let bestCode: string | null = null
  let bestCount = 0
  for (const [code, count] of tally) {
    if (count > bestCount) { bestCount = count; bestCode = code }
  }
  return bestCode
}

// ─────────────────────────────────────────────────────────────────────
// Landlord-based matching
//
// The lessor named on the lease should be one of our unit owners.
// Match across first_name + last_name + entity_name with the same
// normalize-and-token-overlap strategy used for assoc names.
// ─────────────────────────────────────────────────────────────────────
async function findAssociationByOwnerName(landlord: string): Promise<string | null> {
  const target = normalizeName(landlord)
  if (target.tokens.length === 0) return null

  const { data: owners } = await supabaseAdmin
    .from('owners')
    .select('association_code, first_name, last_name, entity_name')
    .or('status.neq.previous,status.is.null')
    .limit(5000)

  if (!owners?.length) return null

  type OwnerLite = {
    association_code: string | null
    first_name: string | null
    last_name: string | null
    entity_name: string | null
  }

  let best: { code: string; score: number } | null = null
  for (const o of owners as OwnerLite[]) {
    if (!o.association_code) continue
    const candidate = [o.entity_name, o.first_name, o.last_name].filter(Boolean).join(' ').trim()
    if (!candidate) continue
    const sc = scoreName(landlord, candidate)
    if (sc < 55) continue
    if (!best || sc > best.score) best = { code: o.association_code, score: sc }
  }
  return best?.code ?? null
}

// PMI itself, its property management LLCs, and similar agent names
// shouldn't be looked up in the owners table — they're the management
// company on behalf of the owner, not the owner.
function looksLikeManagementCompany(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n.includes('pmi') ||
    n.includes('property management') ||
    n.includes('management company') ||
    n.includes('top florida properties')
  )
}

// ─────────────────────────────────────────────────────────────────────
// Combine signals
//
// Truth table priority:
//   - All three signals agree → that code (highest confidence)
//   - Two signals agree → that code
//   - Only one signal fired → that code
//   - Signals conflict → user-selected code wins if it matches at
//     least one signal; otherwise the name-matched code wins; otherwise
//     null (and the UI will show "not recognized")
// ─────────────────────────────────────────────────────────────────────
function resolveWinningCode(signals: {
  nameMatchedCode:     string | null
  addressMatchedCode:  string | null
  landlordMatchedCode: string | null
  userSelectedCode:    string | null
}): string | null {
  const present = [signals.nameMatchedCode, signals.addressMatchedCode, signals.landlordMatchedCode]
    .filter((c): c is string => c !== null)

  if (present.length === 0) return signals.userSelectedCode

  const tally = new Map<string, number>()
  for (const code of present) tally.set(code, (tally.get(code) ?? 0) + 1)

  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1])
  const [topCode, topCount] = sorted[0]

  // Clear winner — at least one signal pointing at this code with no
  // disagreement at the top.
  if (sorted.length === 1) return topCode
  if (topCount > sorted[1][1]) return topCode

  // Conflict between two equally-supported codes. Prefer the user's
  // dropdown selection if it's one of them.
  if (signals.userSelectedCode) {
    const upper = signals.userSelectedCode.toUpperCase()
    if (sorted.some(([c]) => c.toUpperCase() === upper)) return signals.userSelectedCode
  }
  // Otherwise lean toward the name signal — it's the most specific.
  return signals.nameMatchedCode ?? topCode
}
