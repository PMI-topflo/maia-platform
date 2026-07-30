// =====================================================================
// lib/drive-import.ts
// Read a shared Google Drive folder (recursively) for the Compliance Hub
// bulk importer. Reuses the invoice-mirror service-account Drive client.
// The folder must be shared with the service-account email (preferred) or
// be "anyone with the link". Returns the importable files (PDFs/images) with
// their subfolder breadcrumb, which the classifier uses as a hint.
// =====================================================================

import { getDrive, serviceAccountEmail } from '@/lib/drive-invoice-mirror'

export { serviceAccountEmail }

/** The email the folder must be SHARED WITH. With domain-wide delegation the
 *  Drive client acts AS the impersonated user (GOOGLE_DRIVE_IMPERSONATE), so
 *  that user — not the raw service account — needs access. */
export function shareTargetEmail(): string | null {
  return process.env.GOOGLE_DRIVE_IMPERSONATE || serviceAccountEmail()
}

export interface DriveFile {
  id: string
  name: string
  mimeType: string      // the mime we HAND DOWNSTREAM (a Google Doc becomes application/pdf)
  path: string          // breadcrumb of subfolders below the root, e.g. "Lakeview / Insurance"
  modifiedTime: string | null
  createdTime: string | null   // drives the YYYY_MM in the organize/rename convention
  size: number | null
  webViewLink: string | null   // open-in-Drive URL (for files too heavy to preview)
  sourceMimeType?: string   // the real Drive mime, when it differs (Google-native → exported to PDF)
}

const IMPORTABLE = /^(application\/pdf|image\/(jpeg|png|webp|heic|tiff))$/i
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut'
// Google-native editor files (Docs/Sheets/Slides) can't be downloaded with
// alt=media — they must be EXPORTED. Many board approval letters are native
// Google Docs, so without this they were silently skipped by the scan.
const GOOGLE_NATIVE = /^application\/vnd\.google-apps\.(document|spreadsheet|presentation)$/i

/** True for a Google-native editor file that we import by exporting to PDF. */
export function isGoogleNative(mime: string): boolean { return GOOGLE_NATIVE.test(mime) }

/** Extract the folder id from a pasted Drive URL (or accept a raw id). */
export function extractFolderId(input: string): string | null {
  const s = (input ?? '').trim()
  if (!s) return null
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s   // looks like a bare id
  return null
}

export interface ScanResult { files: DriveFile[]; foldersScanned: number }

/** List one folder's direct children: the importable files (with breadcrumb)
 *  plus the subfolders to descend into next. Follows folder shortcuts. */
async function listOneFolder(
  drive: ReturnType<typeof getDrive>, id: string, path: string,
): Promise<{ files: DriveFile[]; subfolders: { id: string; path: string }[] }> {
  const files: DriveFile[] = []
  const subfolders: { id: string; path: string }[] = []
  let pageToken: string | undefined
  do {
    const res = await drive.files.list({
      q: `'${id}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, createdTime, size, webViewLink, shortcutDetails(targetId, targetMimeType))',
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageToken,
    })
    for (const f of res.data.files ?? []) {
      // Resolve shortcuts to their real target (folders are often linked,
      // not nested — that's why a recursive scan can miss whole branches).
      let mime = f.mimeType ?? ''
      let realId = f.id ?? ''
      if (mime === SHORTCUT_MIME && f.shortcutDetails) {
        mime = f.shortcutDetails.targetMimeType ?? mime
        realId = f.shortcutDetails.targetId ?? realId
      }
      if (!realId) continue
      if (mime === FOLDER_MIME) {
        subfolders.push({ id: realId, path: path ? `${path} / ${f.name}` : (f.name ?? '') })
      } else if (isGoogleNative(mime)) {
        // Google-native editor file (often a board approval letter): import it
        // by exporting to PDF. Present it downstream as a PDF with a .pdf name.
        const base = f.name ?? 'document'
        files.push({
          id: realId, name: /\.pdf$/i.test(base) ? base : `${base}.pdf`,
          mimeType: 'application/pdf', sourceMimeType: mime, path,
          modifiedTime: f.modifiedTime ?? null, createdTime: f.createdTime ?? null, size: f.size ? Number(f.size) : null,
          webViewLink: f.webViewLink ?? null,
        })
      } else if (IMPORTABLE.test(mime)) {
        files.push({
          id: realId, name: f.name ?? 'file', mimeType: mime, path,
          modifiedTime: f.modifiedTime ?? null, createdTime: f.createdTime ?? null, size: f.size ? Number(f.size) : null,
          webViewLink: f.webViewLink ?? null,
        })
      }
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return { files, subfolders }
}

/** Recursively list importable files under a folder, following folder
 *  shortcuts. BFS over subfolders, carrying the breadcrumb. Each BFS level is
 *  fetched with bounded CONCURRENCY — a 147-unit folder tree is hundreds of
 *  Drive listings, and doing them one at a time blows the serverless time
 *  limit (the scan would 504). Bounded so we never exhaust Drive's rate quota
 *  or the function's memory. */
export async function listFolderFilesRecursive(folderId: string, maxFiles = 2000, concurrency = 12): Promise<ScanResult> {
  const drive = getDrive()
  const out: DriveFile[] = []
  const seen = new Set<string>()           // guard against shortcut cycles / dupes
  let frontier: { id: string; path: string }[] = [{ id: folderId, path: '' }]
  let foldersScanned = 0
  let guard = 0

  while (frontier.length && out.length < maxFiles && guard < 20000) {
    const batch = frontier.filter(x => !seen.has(x.id))
    for (const x of batch) seen.add(x.id)
    const next: { id: string; path: string }[] = []

    for (let i = 0; i < batch.length && out.length < maxFiles && guard < 20000; i += concurrency) {
      const slice = batch.slice(i, i + concurrency)
      guard += slice.length
      foldersScanned += slice.length
      const results = await Promise.all(slice.map(({ id, path }) => listOneFolder(drive, id, path)))
      for (const r of results) {
        for (const f of r.files) { if (out.length < maxFiles) out.push(f) }
        next.push(...r.subfolders)
      }
    }
    frontier = next
  }
  return { files: out.slice(0, maxFiles), foldersScanned }
}

/** Download a Drive file's bytes. Google-native editor files (Docs/Sheets/
 *  Slides) can't be fetched with alt=media — they're EXPORTED to PDF. We
 *  detect the real mime first so the import route doesn't have to thread it. */
export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const drive = getDrive()
  const meta = await drive.files.get({ fileId, fields: 'mimeType', supportsAllDrives: true })
  if (isGoogleNative(meta.data.mimeType ?? '')) {
    const res = await drive.files.export({ fileId, mimeType: 'application/pdf' }, { responseType: 'arraybuffer' })
    return Buffer.from(res.data as ArrayBuffer)
  }
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  )
  return Buffer.from(res.data as ArrayBuffer)
}
