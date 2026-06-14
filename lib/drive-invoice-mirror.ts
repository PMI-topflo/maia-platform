// =====================================================================
// lib/drive-invoice-mirror.ts
//
// Upload a renamed invoice PDF into the team's INVOICE TO INPUT
// Google Drive folder, parallel to the CINC API push. Keeps the
// existing Drive-based audit trail intact so Isabela's downstream
// workflow (per-association folder move + spreadsheet update) keeps
// working unchanged.
//
// Auth: same service-account JSON used by app/api/indexer/drive-scan.
// Scope is FULL `drive` (NOT `drive.file`): drive.file only grants access to
// files the SA itself created, so it can't see — let alone write into — the
// human-created "INVOICE TO INPUT" folder, and every upload 404s (this is
// why drive_file_id was null on every pushed invoice). Full `drive` lets the
// SA write into a folder that's been SHARED with it.
// Requirement: share that folder with the service-account email (the
// `client_email` in GOOGLE_SERVICE_ACCOUNT_JSON) with Editor permission —
// one-time manual step in Drive. On failure the thrown error names the SA
// email + folder id so the share step is obvious.
//
// Failure mode: callers should treat upload failure as non-fatal.
// The CINC push is the source of truth; Drive is a convenience copy.
// =====================================================================

import { google } from 'googleapis'
import { Readable } from 'stream'

const DEFAULT_FOLDER_ID = process.env.INVOICE_INTAKE_DRIVE_FOLDER_ID
  ?? '1EFtayKzeg5zRtYvshQ8vHPUpNOv93O4m'  // My Drive › Accounting › INVOICE TO INPUT

let _driveClient: ReturnType<typeof buildClient> | null = null

/** The service-account's email (client_email) — what the Drive folder must
 *  be shared with. Read at runtime; null if the JSON is missing/malformed. */
export function serviceAccountEmail(): string | null {
  try { return (JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}').client_email as string) ?? null }
  catch { return null }
}

function buildClient() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!json) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set')
  const creds  = JSON.parse(json)
  const scopes = ['https://www.googleapis.com/auth/drive']
  // Service accounts have NO Drive storage quota of their own, so creating a
  // file the SA itself would OWN fails with "Service Accounts do not have
  // storage quota" — even in a folder shared with it. Two ways to give the
  // file a real owner:
  //   • Domain-wide delegation (GOOGLE_DRIVE_IMPERSONATE): the SA acts AS a
  //     Workspace user (who has quota); the file is owned by that user and
  //     lands in their My Drive — so the existing "INVOICE TO INPUT" folder
  //     keeps working. Requires authorizing the SA's client ID for the drive
  //     scope in the Workspace Admin console.
  //   • Shared Drive: put the target folder in a Shared Drive and add the SA
  //     as a member — files are owned by the Shared Drive, no impersonation.
  //     supportsAllDrives:true on the create call already covers this.
  const subject = process.env.GOOGLE_DRIVE_IMPERSONATE
  if (subject) {
    const jwt = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes, subject })
    return google.drive({ version: 'v3', auth: jwt })
  }
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes })
  return google.drive({ version: 'v3', auth })
}

function drive() {
  if (!_driveClient) _driveClient = buildClient()
  return _driveClient
}

/** Shared Drive v3 client (same auth as the invoice mirror) for other features. */
export function getDrive() { return drive() }

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
  const base = lastErr instanceof Error ? lastErr.message : String(lastErr)
  const sa = serviceAccountEmail()
  let hint = ''
  if (/storage quota/i.test(base)) {
    // The real, common cause: SAs own no Drive storage.
    hint = ` — service accounts can't own Drive files. Fix EITHER: (a) set GOOGLE_DRIVE_IMPERSONATE to a Workspace user email and authorize ${sa ?? 'the SA'} for domain-wide delegation (drive scope) in Admin; OR (b) move folder ${folderId} into a Shared Drive and add ${sa ?? 'the SA'} as a member.`
  } else if (/not found|permission|insufficient|forbidden|403|404/i.test(base)) {
    hint = ` — the service account can't access the folder. Share Drive folder ${folderId} with ${sa ?? 'the service-account email'} (Editor), or use GOOGLE_DRIVE_IMPERSONATE.`
  }
  throw new Error(`${base}${hint}`)
}
