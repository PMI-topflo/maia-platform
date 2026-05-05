import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const maxDuration = 300

const SUBFOLDERS = [
  { name: 'Lease Applications',            type: 'lease_applications' },
  { name: 'Purchase Applications',         type: 'purchase_applications' },
  { name: 'Violations',                    type: 'violations' },
  { name: 'Insurance',                     type: 'insurance' },
  { name: 'Lauderhill Certificate of Use', type: 'lauderhill_cou' },
] as const

function matchFolderToUnit(folderName: string, unitNumber: string): boolean {
  const escaped = unitNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`).test(folderName)
}

async function listChildFolders(drive: any, parentId: string) {
  const all: { id: string; name: string }[] = []
  let pageToken: string | undefined
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'nextPageToken, files(id, name)',
      pageSize: 200,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    for (const f of res.data.files ?? []) {
      if (f.id && f.name) all.push({ id: f.id, name: f.name })
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return all
}

async function getOrCreateFolder(drive: any, name: string, parentId: string, apply: boolean): Promise<string> {
  const safe = name.replace(/'/g, "\\'")
  const existing = await drive.files.list({
    q: `'${parentId}' in parents and name='${safe}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })
  if (existing.data.files?.length > 0) return existing.data.files[0].id!
  if (!apply) return `dry-run:${name}`
  const created = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
    supportsAllDrives: true,
  })
  return created.data.id!
}

export async function POST(req: NextRequest) {
  const { apply = false, association_code = 'MANXI' } = await req.json()

  const googleJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!googleJson) return NextResponse.json({ ok: false, error: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' }, { status: 500 })

  const { google } = await import('googleapis')
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(googleJson),
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  const drive = google.drive({ version: 'v3', auth })

  // Get root folder from association_config or env fallback
  const { data: cfg } = await supabaseAdmin
    .from('association_config')
    .select('drive_root_folder_id')
    .eq('association_code', association_code)
    .maybeSingle()

  const rootFolderId =
    (cfg as any)?.drive_root_folder_id ??
    process.env.MANXI_PARENT_FOLDER_ID ??
    '1kRDm6ajZr8lXuXGcAXTnA3vigzhLCZpz'

  // Load units from homeowners
  const { data: rawUnits, error: unitsErr } = await supabaseAdmin
    .from('homeowners')
    .select('account_number, unit_number, street_number, address')
    .eq('association_code', association_code)

  if (unitsErr) return NextResponse.json({ ok: false, error: unitsErr.message }, { status: 500 })

  const units = new Map<string, { unit_number: string; property_address: string }>()
  for (const u of rawUnits ?? []) {
    if (!units.has(u.account_number)) {
      const addr = [u.street_number, u.address].filter(Boolean).join(' ').trim()
      units.set(u.account_number, { unit_number: String(u.unit_number), property_address: addr })
    }
  }

  // List existing Drive folders
  const existingFolders = await listChildFolders(drive, rootFolderId)

  // Match folders to units
  const matchesByAccount = new Map<string, { id: string; name: string }[]>()
  for (const folder of existingFolders) {
    const candidates = Array.from(units.entries()).filter(([, u]) =>
      matchFolderToUnit(folder.name, u.unit_number)
    )
    if (candidates.length === 1) {
      const acct = candidates[0][0]
      if (!matchesByAccount.has(acct)) matchesByAccount.set(acct, [])
      matchesByAccount.get(acct)!.push(folder)
    }
  }

  // Plan and execute
  const log: string[] = []
  const registryRows: any[] = []
  let renamed = 0, created = 0, ok = 0

  for (const [account, unit] of Array.from(units.entries()).sort()) {
    const target = `${account} - ${unit.property_address}`
    const matches = matchesByAccount.get(account) ?? []

    let unitFolderId: string

    if (matches.length === 1) {
      unitFolderId = matches[0].id
      if (matches[0].name !== target) {
        if (apply) {
          await drive.files.update({
            fileId: unitFolderId,
            requestBody: { name: target },
            supportsAllDrives: true,
          })
          renamed++
          log.push(`RENAMED: "${matches[0].name}" → "${target}"`)
        } else {
          log.push(`WOULD RENAME: "${matches[0].name}" → "${target}"`)
          renamed++
        }
      } else {
        ok++
      }
    } else if (matches.length === 0) {
      unitFolderId = await getOrCreateFolder(drive, target, rootFolderId, apply)
      created++
      log.push(`${apply ? 'CREATED' : 'WOULD CREATE'}: "${target}"`)
    } else {
      log.push(`SKIPPED (ambiguous): ${account}`)
      continue
    }

    if (apply && !unitFolderId.startsWith('dry-run:')) {
      registryRows.push({
        account_number: account,
        association_code,
        folder_type: 'unit_root',
        drive_folder_id: unitFolderId,
        drive_url: `https://drive.google.com/drive/folders/${unitFolderId}`,
      })

      for (const sub of SUBFOLDERS) {
        const subId = await getOrCreateFolder(drive, sub.name, unitFolderId, apply)
        registryRows.push({
          account_number: account,
          association_code,
          folder_type: sub.type,
          drive_folder_id: subId,
          drive_url: `https://drive.google.com/drive/folders/${subId}`,
        })
      }
    }
  }

  // Upsert registry
  if (registryRows.length > 0) {
    for (let i = 0; i < registryRows.length; i += 500) {
      await supabaseAdmin
        .from('unit_drive_folders')
        .upsert(registryRows.slice(i, i + 500), { onConflict: 'account_number,folder_type' })
    }
  }

  return NextResponse.json({
    ok: true,
    apply,
    summary: { renamed, created, already_correct: ok, units_total: units.size },
    log,
  })
}
