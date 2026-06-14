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
  mimeType: string
  path: string          // breadcrumb of subfolders below the root, e.g. "Lakeview / Insurance"
  modifiedTime: string | null
  size: number | null
}

const IMPORTABLE = /^(application\/pdf|image\/(jpeg|png|webp|heic|tiff))$/i
const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Extract the folder id from a pasted Drive URL (or accept a raw id). */
export function extractFolderId(input: string): string | null {
  const s = (input ?? '').trim()
  if (!s) return null
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s   // looks like a bare id
  return null
}

/** Recursively list importable files under a folder. Bounded for safety. */
export async function listFolderFilesRecursive(folderId: string, maxFiles = 800): Promise<DriveFile[]> {
  const drive = getDrive()
  const out: DriveFile[] = []
  // BFS over subfolders, carrying the breadcrumb.
  const queue: { id: string; path: string }[] = [{ id: folderId, path: '' }]
  let guard = 0
  while (queue.length && out.length < maxFiles && guard < 5000) {
    guard++
    const { id, path } = queue.shift()!
    let pageToken: string | undefined
    do {
      const res = await drive.files.list({
        q: `'${id}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
        pageSize: 200,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageToken,
      })
      for (const f of res.data.files ?? []) {
        if (f.mimeType === FOLDER_MIME) {
          queue.push({ id: f.id!, path: path ? `${path} / ${f.name}` : (f.name ?? '') })
        } else if (f.mimeType && IMPORTABLE.test(f.mimeType)) {
          out.push({
            id: f.id!, name: f.name ?? 'file', mimeType: f.mimeType, path,
            modifiedTime: f.modifiedTime ?? null, size: f.size ? Number(f.size) : null,
          })
          if (out.length >= maxFiles) break
        }
      }
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken && out.length < maxFiles)
  }
  return out
}

/** Download a Drive file's bytes. */
export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const drive = getDrive()
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  )
  return Buffer.from(res.data as ArrayBuffer)
}
