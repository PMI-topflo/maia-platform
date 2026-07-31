// =====================================================================
// lib/drive-organize.ts
//
// Naming convention for the Manors XI Drive file-organize tool. Files in a
// unit's canonical folder are renamed `YYYY_MM_<Type>.<ext>` — date-first (so
// the folder sorts chronologically = one leasing/renewal cycle groups
// together), date = the file's CREATED date. Type comes from the doc-type
// whitelist (lib/drive-import-filter).
//
// Only the compliance keeper types get a proposed name in a unit folder;
// PII / unrecognized / unsigned-approval-drafts are left as-is (skip). The
// application-archive types (Drivers/Credit/…) are handled by the archive
// flow, not here.
// =====================================================================

import type { FilterCategory } from '@/lib/drive-import-filter'

// category → the Type token used in the filename. `insurance` defaults to HO6
// (owner); staff flip to HO4 (renter) on the screen. null = not auto-renamed.
export const TYPE_FOR_CATEGORY: Partial<Record<FilterCategory, string>> = {
  approval:           'Approval',
  certificate_of_use: 'LauderhillCert',
  insurance:          'HO6',
  lease:              'Lease',
}

// The types a user may pick from on the screen (unit-folder + archive).
export const RENAME_TYPES = [
  'Approval', 'Lease', 'HO6', 'HO4', 'Liability', 'LauderhillCert',
  'DriversLicense', 'ID', 'Credit', 'Background', 'Income', 'Application',
] as const

function ext(name: string): string {
  const m = name.match(/\.([a-z0-9]{1,5})$/i)
  return m ? `.${m[1].toLowerCase()}` : ''
}

/** yyyy-mm from an ISO date; null if unparseable. */
export function yyyymm(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export interface ProposedName {
  type: string | null       // null when the file isn't an auto-renamed keeper
  suggested: string | null  // full proposed filename, or null
}

/** Propose a `YYYY_MM_<Type>.<ext>` name for a file, from its whitelist
 *  category + created date. Returns { type:null } for anything we don't
 *  auto-rename in a unit folder (PII, unrecognized, unsigned drafts). */
export function proposeName(
  filename: string, category: FilterCategory, include: boolean, createdTime: string | null,
): ProposedName {
  const type = include ? (TYPE_FOR_CATEGORY[category] ?? null) : null
  if (!type) return { type: null, suggested: null }
  const ym = yyyymm(createdTime)
  if (!ym) return { type, suggested: null }   // no date → let staff fill it in
  return { type, suggested: `${ym}_${type}${ext(filename)}` }
}

/** Given the (possibly staff-edited) target names for a set of files, append
 *  _2 / _3 to any that collide within the same folder. Order-stable. */
export function dedupeNames(names: (string | null)[]): (string | null)[] {
  const seen = new Map<string, number>()
  return names.map(n => {
    if (!n) return n
    const dot = n.lastIndexOf('.')
    const base = dot > 0 ? n.slice(0, dot) : n
    const e = dot > 0 ? n.slice(dot) : ''
    const key = n.toLowerCase()
    const count = seen.get(key) ?? 0
    seen.set(key, count + 1)
    return count === 0 ? n : `${base}_${count + 1}${e}`
  })
}
