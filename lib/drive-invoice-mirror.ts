// =====================================================================
// lib/drive-invoice-mirror.ts
//
// Upload a renamed invoice PDF into the team's INVOICE TO INPUT
// Google Drive folder, parallel to the CINC API push. Keeps the
// existing Drive-based audit trail intact so Isabela's downstream
// workflow (per-association folder move + spreadsheet update) keeps
// working unchanged.
//
// Auth: same service-account JSON used by app/api/indexer/drive-scan,
// but with the narrower drive.file scope (only files the SA creates).
// For the SA to be able to put a file *inside* the INVOICE TO INPUT
// folder, the folder must be shared with the service-account email
// with Editor permission — one-time manual step in Drive.
//
// Failure mode: callers should treat upload failure as non-fatal.
// The CINC push is the source of truth; Drive is a convenience copy.
// =====================================================================

import { google } from 'googleapis'
import { Readable } from 'stream'

const DEFAULT_FOLDER_ID = process.env.INVOICE_INTAKE_DRIVE_FOLDER_ID
  ?? '1EFtayKzeg5zRtYvshQ8vHPUpNOv93O4m'  // My Drive › Accounting › INVOICE TO INPUT

let _driveClient: ReturnType<typeof buildClient> | null = null

function buildClient() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!json) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set')
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(json),
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  })
  return google.drive({ version: 'v3', auth })
}

function drive() {
  if (!_driveClient) _driveClient = buildClient()
  return _driveClient
}

export interface MirrorResult {
  driveFileId: string
  webViewLink: string | null
}

/** Upload a renamed PDF to the INVOICE TO INPUT folder. Throws on
 *  failure — caller decides whether to surface or swallow. */
export async function uploadInvoiceToDrive(opts: {
  filename:  string
  pdfBuffer: Buffer
  folderId?: string
}): Promise<MirrorResult> {
  const folderId = opts.folderId ?? DEFAULT_FOLDER_ID

  // Retry transient Drive failures. A single blip during a push used to
  // permanently miss the Drive copy (the invoice still posts to CINC, but the
  // file never lands in INVOICE TO INPUT). A Readable can only be consumed
  // once, so build a fresh one per attempt.
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await drive().files.create({
        requestBody: {
          name:     opts.filename,
          parents:  [folderId],
          mimeType: 'application/pdf',
        },
        media: {
          mimeType: 'application/pdf',
          body:     Readable.from(opts.pdfBuffer),
        },
        fields:        'id, webViewLink',
        supportsAllDrives: true,
      })
      const driveFileId = res.data.id
      if (!driveFileId) throw new Error('Drive returned no file id')
      return { driveFileId, webViewLink: res.data.webViewLink ?? null }
    } catch (err) {
      lastErr = err
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 600))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
