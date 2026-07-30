// =====================================================================
// lib/drive-organize-folders.ts
//
// The three Manors XI top-level Drive folders (renamed 2026-07-30, same IDs /
// share links) and helpers to resolve a unit's folder inside them. Env-
// overridable so this isn't hard-wired to Manors XI forever.
//
//   OFFICIAL  "Unit Docs - 2026 Maia Official Files"     → clean renamed record
//   ARCHIVE   "Unit Docs - OLD Approved Application Files" → past applications (kept)
//   ONGOING   "Unit Docs - On Going Applications"          → in-progress, pre-approval
// =====================================================================

import { getDrive } from '@/lib/drive-invoice-mirror'

export const DRIVE_FOLDERS = {
  official: process.env.MANXI_OFFICIAL_FOLDER_ID ?? '1kRDm6ajZr8lXuXGcAXTnA3vigzhLCZpz',
  archive:  process.env.MANXI_ARCHIVE_FOLDER_ID  ?? '11mMQghXeQfPuXEO4YnWgecqaTKuLKhs8',
  ongoing:  process.env.MANXI_ONGOING_FOLDER_ID  ?? '1rX11uKdi5y0rAfaLPvRRlJ_aCactViuZ',
} as const

const FOLDER_MIME = 'application/vnd.google-apps.folder'

// Suffix put on a unit folder in Official that has no documents yet, so empty
// units are visible at a glance. Stripped automatically when a file lands.
export const NO_FILES_TAG = ' - NO FILES YET'
export function stripNoFilesTag(name: string): string {
  return name.replace(/\s*-\s*NO FILES YET\s*$/i, '').trimEnd()
}

/** Canonical per-unit folder name in the Official tree, e.g.
 *  "MANXI811 - 4174 Inverrary Drive". */
export function unitFolderName(unitRef: string): string {
  return `${unitRef} - 4174 Inverrary Drive`
}

/** Find (or create, when create=true) the folder for a unit directly under
 *  `parentId`. Matches on the folder name STARTING with the unit ref (so the
 *  existing "MANXI811 - 4174 Inverrary Drive" is reused). Returns its id. */
export async function resolveUnitFolder(parentId: string, unitRef: string, create: boolean): Promise<string | null> {
  const drive = getDrive()
  // Look for an existing child folder whose name begins with the unit ref.
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false and name contains '${unitRef}'`,
    fields: 'files(id, name)', pageSize: 50, supportsAllDrives: true, includeItemsFromAllDrives: true,
  })
  const rx = new RegExp(`^${unitRef}\\b`, 'i')
  const hit = (res.data.files ?? []).find(f => rx.test(f.name ?? ''))
  if (hit?.id) return hit.id
  if (!create) return null

  const created = await drive.files.create({
    requestBody: { name: unitFolderName(unitRef), mimeType: FOLDER_MIME, parents: [parentId] },
    fields: 'id', supportsAllDrives: true,
  })
  return created.data.id ?? null
}

/** Find (or create) a dated subfolder under a unit's archive folder, e.g.
 *  ".../MANXI811 - …/2026-06". */
export async function resolveDatedSubfolder(unitFolderId: string, dateLabel: string, create: boolean): Promise<string | null> {
  const drive = getDrive()
  const res = await drive.files.list({
    q: `'${unitFolderId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false and name = '${dateLabel}'`,
    fields: 'files(id, name)', pageSize: 10, supportsAllDrives: true, includeItemsFromAllDrives: true,
  })
  if (res.data.files?.[0]?.id) return res.data.files[0].id
  if (!create) return null
  const created = await drive.files.create({
    requestBody: { name: dateLabel, mimeType: FOLDER_MIME, parents: [unitFolderId] },
    fields: 'id', supportsAllDrives: true,
  })
  return created.data.id ?? null
}
