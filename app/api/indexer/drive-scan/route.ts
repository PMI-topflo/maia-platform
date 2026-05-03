// =====================================================================
// app/api/indexer/drive-scan/route.ts
//
// POST /api/indexer/drive-scan
// Body: { associationCode: string, folderType: 'lease' | 'insurance' | 'cou' | 'violations' | 'all', driveFolderId?: string }
//
// Scans a Drive folder, extracts compliance data with Gemini Flash,
// upserts into Supabase, logs results to drive_indexer_log.
//
// Auth: Requires service role (server-side only). Called by:
//  - Cron: app/api/cron/daily-index/route.ts
//  - Manual: dashboard "Re-scan now" button at /admin/audit
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

// ---- Clients ----
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const gemini = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Drive client uses the same service account as Gmail OAuth (or a dedicated one)
function driveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!),
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

// ---- Extraction prompts ----
const PROMPTS = {
  lease: `Extract lease information from this PDF. Return STRICT JSON only, no prose, no markdown:
{
  "tenant_name": "string or null",
  "tenant_email": "string or null",
  "tenant_phone": "string or null",
  "lease_start_date": "YYYY-MM-DD or null",
  "lease_end_date": "YYYY-MM-DD or null",
  "unit_address": "string or null",
  "unit_number": "string or null",
  "monthly_rent_usd": "number or null",
  "confidence": "high | medium | low"
}
If the document is not a lease, return {"confidence": "low", "tenant_name": null, ...}.`,

  insurance: `Extract insurance policy information from this PDF. Return STRICT JSON only:
{
  "carrier": "string or null",
  "policy_number": "string or null",
  "effective_date": "YYYY-MM-DD or null",
  "expiration_date": "YYYY-MM-DD or null",
  "premium_usd": "number or null",
  "named_insured": "string or null",
  "unit_address": "string or null",
  "unit_number": "string or null",
  "confidence": "high | medium | low"
}`,

  cou: `Extract City of Lauderhill Certificate of Use information from this PDF. Return STRICT JSON only:
{
  "certificate_number": "string or null",
  "issue_date": "YYYY-MM-DD or null",
  "expiration_date": "YYYY-MM-DD or null",
  "renewal_fee_usd": "number or null",
  "property_address": "string or null",
  "unit_number": "string or null",
  "owner_name": "string or null",
  "city": "Lauderhill",
  "confidence": "high | medium | low"
}
The Lauderhill annual CoU expires on Sep 30 of each renewal year. If multiple dates appear, use the most recent expiration date.`,

  violations: `Extract HOA violation notice information from this PDF. Return STRICT JSON only:
{
  "violation_type": "string or null",
  "description": "string or null",
  "issued_date": "YYYY-MM-DD or null",
  "resolution_due_date": "YYYY-MM-DD or null",
  "unit_address": "string or null",
  "unit_number": "string or null",
  "confidence": "high | medium | low"
}`,
} as const;

type FolderType = keyof typeof PROMPTS;

// ---- Helpers ----
async function extractFromPdf(fileId: string, folderType: FolderType, drive: ReturnType<typeof driveClient>) {
  // Download the PDF bytes
  const fileRes = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  const base64 = Buffer.from(fileRes.data as ArrayBuffer).toString('base64');

  const result = await gemini.generateContent([
    { inlineData: { data: base64, mimeType: 'application/pdf' } },
    { text: PROMPTS[folderType] },
  ]);

  const raw = result.response.text().trim();
  // Strip ```json fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    console.warn(`[indexer] Failed to parse JSON from ${fileId}:`, raw.slice(0, 200));
    return null;
  }
}

async function listPdfsInFolder(folderId: string, drive: ReturnType<typeof driveClient>) {
  const files: Array<{ id: string; name: string; webViewLink: string }> = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and (mimeType='application/pdf' or mimeType='application/vnd.google-apps.folder') and trashed=false`,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink)',
      pageSize: 200,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) {
      if (f.mimeType === 'application/pdf' && f.id) {
        files.push({ id: f.id, name: f.name ?? '', webViewLink: f.webViewLink ?? '' });
      } else if (f.mimeType === 'application/vnd.google-apps.folder' && f.id) {
        // Recurse into subfolders
        const sub = await listPdfsInFolder(f.id, drive);
        files.push(...sub);
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
}

// Match unit_number → account_number using the homeowners table
async function resolveAccountNumber(associationCode: string, unitNumber: string | null) {
  if (!unitNumber) return null;
  const { data } = await supabase
    .from('homeowners')
    .select('account_number')
    .eq('association_code', associationCode)
    .eq('unit_number', String(unitNumber))
    .limit(1)
    .single();
  return data?.account_number ?? null;
}

// ---- Upsert helpers (one per record type) ----
async function upsertLease(associationCode: string, accountNumber: string, ext: any, fileId: string, fileUrl: string) {
  await supabase.from('unit_leases').upsert({
    account_number: accountNumber,
    association_code: associationCode,
    tenant_name: ext.tenant_name,
    tenant_email: ext.tenant_email,
    tenant_phone: ext.tenant_phone,
    lease_start_date: ext.lease_start_date,
    lease_end_date: ext.lease_end_date,
    application_status: ext.lease_end_date && new Date(ext.lease_end_date) < new Date() ? 'expired' : 'active',
    source_pdf_url: fileUrl,
    source_drive_file_id: fileId,
    extracted_by: 'gemini',
    extracted_at: new Date().toISOString(),
  }, { onConflict: 'source_drive_file_id', ignoreDuplicates: false });
}

async function upsertInsurance(associationCode: string, accountNumber: string, ext: any, fileId: string, fileUrl: string) {
  await supabase.from('unit_insurance').upsert({
    account_number: accountNumber,
    association_code: associationCode,
    carrier: ext.carrier,
    policy_number: ext.policy_number,
    effective_date: ext.effective_date,
    expiration_date: ext.expiration_date,
    premium_usd: ext.premium_usd,
    source_pdf_url: fileUrl,
    source_drive_file_id: fileId,
    extracted_by: 'gemini',
    extracted_at: new Date().toISOString(),
  }, { onConflict: 'source_drive_file_id', ignoreDuplicates: false });
}

async function upsertCou(associationCode: string, accountNumber: string, ext: any, fileId: string, fileUrl: string) {
  await supabase.from('unit_certificate_of_use').upsert({
    account_number: accountNumber,
    association_code: associationCode,
    city: 'Lauderhill',
    certificate_number: ext.certificate_number,
    issue_date: ext.issue_date,
    expiration_date: ext.expiration_date,
    renewal_fee_usd: ext.renewal_fee_usd,
    status: ext.expiration_date && new Date(ext.expiration_date) < new Date() ? 'expired' : 'active',
    source_pdf_url: fileUrl,
    source_drive_file_id: fileId,
    extracted_by: 'gemini',
    extracted_at: new Date().toISOString(),
  }, { onConflict: 'account_number,city,expiration_date', ignoreDuplicates: false });
}

async function upsertViolation(associationCode: string, accountNumber: string, ext: any, fileId: string, fileUrl: string) {
  await supabase.from('unit_violations').upsert({
    account_number: accountNumber,
    association_code: associationCode,
    violation_type: ext.violation_type,
    description: ext.description,
    issued_date: ext.issued_date,
    resolution_due_date: ext.resolution_due_date,
    status: 'open',
    source_pdf_url: fileUrl,
    source_drive_file_id: fileId,
    extracted_by: 'gemini',
    extracted_at: new Date().toISOString(),
  }, { onConflict: 'source_drive_file_id', ignoreDuplicates: false });
}

// ---- Main handler ----
export async function POST(req: NextRequest) {
  // Auth: only allow with internal API secret OR Vercel cron
  const authHeader = req.headers.get('authorization');
  const cronSecret = req.headers.get('x-vercel-cron-signature');
  if (
    authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET}` &&
    !cronSecret
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { associationCode, folderType, driveFolderId } = await req.json();
  if (!associationCode || !folderType) {
    return NextResponse.json({ error: 'associationCode and folderType required' }, { status: 400 });
  }

  // Resolve folder ID from registry if not provided
  let folderId = driveFolderId;
  if (!folderId) {
    const { data } = await supabase
      .from('unit_drive_folders')
      .select('drive_folder_id')
      .eq('association_code', associationCode)
      .eq('folder_type', folderTypeMap(folderType))
      .limit(1)
      .single();
    folderId = data?.drive_folder_id;
  }
  if (!folderId) {
    return NextResponse.json({ error: 'No drive_folder_id resolved' }, { status: 400 });
  }

  // Start log
  const { data: logRow } = await supabase
    .from('drive_indexer_log')
    .insert({
      association_code: associationCode,
      folder_scanned: folderId,
      ai_provider: 'gemini',
    })
    .select('id')
    .single();

  const drive = driveClient();
  const startedAt = Date.now();
  let processed = 0, skipped = 0, errors = 0;
  const errorDetails: any[] = [];

  try {
    const files = await listPdfsInFolder(folderId, drive);

    for (const file of files) {
      try {
        const ext = await extractFromPdf(file.id, folderType as FolderType, drive);
        if (!ext || ext.confidence === 'low') { skipped++; continue; }

        const accountNumber = await resolveAccountNumber(associationCode, ext.unit_number);
        if (!accountNumber) {
          skipped++;
          errorDetails.push({ file: file.name, reason: 'unit_number not found in homeowners' });
          continue;
        }

        if (folderType === 'lease')      await upsertLease(associationCode, accountNumber, ext, file.id, file.webViewLink);
        else if (folderType === 'insurance') await upsertInsurance(associationCode, accountNumber, ext, file.id, file.webViewLink);
        else if (folderType === 'cou')       await upsertCou(associationCode, accountNumber, ext, file.id, file.webViewLink);
        else if (folderType === 'violations') await upsertViolation(associationCode, accountNumber, ext, file.id, file.webViewLink);

        processed++;
      } catch (e: any) {
        errors++;
        errorDetails.push({ file: file.name, error: e.message });
      }
    }

    await supabase.from('drive_indexer_log').update({
      files_seen: files.length,
      files_processed: processed,
      files_skipped: skipped,
      errors,
      error_details: errorDetails.length ? errorDetails : null,
      duration_ms: Date.now() - startedAt,
      completed_at: new Date().toISOString(),
    }).eq('id', logRow!.id);

    return NextResponse.json({
      ok: true,
      filesSeen: files.length,
      processed,
      skipped,
      errors,
      durationMs: Date.now() - startedAt,
    });
  } catch (e: any) {
    await supabase.from('drive_indexer_log').update({
      errors: errors + 1,
      error_details: [...errorDetails, { fatal: e.message }],
      duration_ms: Date.now() - startedAt,
      completed_at: new Date().toISOString(),
    }).eq('id', logRow!.id);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function folderTypeMap(short: string): string {
  const map: Record<string, string> = {
    lease: 'lease_applications',
    purchase: 'purchase_applications',
    insurance: 'insurance',
    violations: 'violations',
    cou: 'lauderhill_cou',
  };
  return map[short] ?? short;
}
