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
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut'

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

/** Recursively list importable files under a folder, following folder
 *  shortcuts. BFS over subfolders, carrying the breadcrumb. Bounded. */
export async function listFolderFilesRecursive(folderId: string, maxFiles = 2000): Promise<ScanResult> {
  const drive = getDrive()
  const out: DriveFile[] = []
  const seen = new Set<string>()           // guard against shortcut cycles / dupes
  const queue: { id: string; path: string }[] = [{ id: folderId, path: '' }]
  let foldersScanned = 0
  let guard = 0
  while (queue.length && out.length < maxFiles && guard < 20000) {
    guard++
    const { id, path } = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    foldersScanned++
    let pageToken: string | undefined
    do {
      const res = await drive.files.list({
        q: `'${id}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size, shortcutDetails(targetId, targetMimeType))',
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
          queue.push({ id: realId, path: path ? `${path} / ${f.name}` : (f.name ?? '') })
        } else if (IMPORTABLE.test(mime)) {
          out.push({
            id: realId, name: f.name ?? 'file', mimeType: mime, path,
            modifiedTime: f.modifiedTime ?? null, size: f.size ? Number(f.size) : null,
          })
          if (out.length >= maxFiles) break
        }
      }
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken && out.length < maxFiles)
  }
  return { files: out, foldersScanned }
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
