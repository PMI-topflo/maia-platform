// =====================================================================
// scripts/bootstrap-manxi-folders.ts
//
// Idempotent MANXI Drive folder migration:
//   - Snapshots the current folder list to drive_pre_migration_snapshot
//   - Renames existing per-unit folders to: MANXI{unit} - 4174 Inverrary Drive #{unit}
//   - Creates new folders for units that don't have one yet
//   - Ensures all 5 subfolders exist inside each unit folder
//   - Upserts every folder ID into unit_drive_folders
//
// USAGE:
//   # Dry run (default — shows what would happen, makes no changes):
//   npx tsx scripts/bootstrap-manxi-folders.ts
//
//   # Execute for real:
//   npx tsx scripts/bootstrap-manxi-folders.ts --apply
//
// REQUIRED ENV:
//   GOOGLE_SERVICE_ACCOUNT_JSON, NEXT_PUBLIC_SUPABASE_URL,
//   SUPABASE_SERVICE_ROLE_KEY, MANXI_PARENT_FOLDER_ID
// =====================================================================

import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
// Load env vars from shell or .env.local before running this script.
// e.g.: node --env-file=.env.local (Node 20.6+) or set vars in your shell.

const PARENT_FOLDER_ID = process.env.MANXI_PARENT_FOLDER_ID
  ?? '1kRDm6ajZr8lXuXGcAXTnA3vigzhLCZpz';
const ASSOCIATION_CODE = 'MANXI';
const STREET = '4174 Inverrary Drive';
const APPLY = process.argv.includes('--apply');

const SUBFOLDERS = [
  { name: 'Lease Applications',              type: 'lease_applications' },
  { name: 'Purchase Applications',           type: 'purchase_applications' },
  { name: 'Violations',                      type: 'violations' },
  { name: 'Insurance',                       type: 'insurance' },
  { name: 'Lauderhill Certificate of Use',   type: 'lauderhill_cou' },
] as const;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function driveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

interface DriveFolder {
  id: string;
  name: string;
}

// ---- Step 1: Snapshot current folder list ----
async function snapshotCurrentFolders(folders: DriveFolder[]) {
  const rows = folders.map(f => ({
    association_code: ASSOCIATION_CODE,
    drive_folder_id: f.id,
    original_name: f.name,
    parent_folder_id: PARENT_FOLDER_ID,
  }));
  if (!APPLY) {
    console.log(`[snapshot] Would record ${rows.length} folder names (dry run)`);
    return;
  }
  const { error } = await supabase
    .from('drive_pre_migration_snapshot')
    .insert(rows);
  if (error) {
    console.warn('[snapshot] Insert failed (continuing):', error.message);
  } else {
    console.log(`[snapshot] Recorded ${rows.length} folder names for rollback`);
  }
}

// ---- Step 2: List all top-level folders under the MANXI parent ----
async function listChildFolders(drive: any, parentId: string): Promise<DriveFolder[]> {
  const all: DriveFolder[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'nextPageToken, files(id, name)',
      pageSize: 200,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) {
      if (f.id && f.name) all.push({ id: f.id, name: f.name });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return all;
}

// ---- Step 3: Match existing folders to units ----
function matchFolderToUnit(folderName: string, unitNumber: string): boolean {
  // Match the unit number as a standalone token (\b = word boundary).
  // Catches "103", "Unit 103", "103 - Smith", "4174-103", "Apt 103"
  // but NOT "1031" or "1103" when looking for "103".
  const escaped = unitNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}\\b`);
  return pattern.test(folderName);
}

// ---- Step 4: Rename helper ----
async function renameFolder(drive: any, folderId: string, newName: string) {
  if (!APPLY) return;
  await drive.files.update({
    fileId: folderId,
    requestBody: { name: newName },
    supportsAllDrives: true,
  });
}

// ---- Step 5: Get-or-create helper ----
async function getOrCreateFolder(drive: any, name: string, parentId: string): Promise<string> {
  const escapedName = name.replace(/'/g, "\\'");
  const existing = await drive.files.list({
    q: `'${parentId}' in parents and name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (existing.data.files && existing.data.files.length > 0) {
    return existing.data.files[0].id!;
  }
  if (!APPLY) return `<dry-run-would-create:${name}>`;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });
  return created.data.id!;
}

// ---- Main ----
async function main() {
  console.log(`\n${APPLY ? '🚀 APPLY MODE' : '🔍 DRY RUN MODE'} — ${ASSOCIATION_CODE}\n`);

  // 1. Pull MANXI units from homeowners (deduped on account_number)
  const { data: rawUnits, error } = await supabase
    .from('homeowners')
    .select('account_number, unit_number')
    .eq('association_code', ASSOCIATION_CODE);
  if (error) throw error;

  const units = new Map<string, { account_number: string; unit_number: string }>();
  for (const u of rawUnits!) {
    if (!units.has(u.account_number)) {
      units.set(u.account_number, {
        account_number: u.account_number,
        unit_number: String(u.unit_number),
      });
    }
  }
  console.log(`[plan] ${units.size} unique MANXI units to process`);

  // 2. List existing folders + snapshot
  const drive = driveClient();
  const existingFolders = await listChildFolders(drive, PARENT_FOLDER_ID);
  console.log(`[plan] ${existingFolders.length} existing folders found under MANXI parent`);
  await snapshotCurrentFolders(existingFolders);

  // 3. Match each existing folder to a unit
  const matchesByAccount = new Map<string, DriveFolder[]>();
  const unmatchedFolders: DriveFolder[] = [];

  for (const folder of existingFolders) {
    const candidateUnits = Array.from(units.values()).filter(u =>
      matchFolderToUnit(folder.name, u.unit_number)
    );
    if (candidateUnits.length === 0) {
      unmatchedFolders.push(folder);
      continue;
    }
    if (candidateUnits.length > 1) {
      console.warn(`  ⚠ Folder "${folder.name}" matches ${candidateUnits.length} units; skipping`);
      continue;
    }
    const acct = candidateUnits[0].account_number;
    if (!matchesByAccount.has(acct)) matchesByAccount.set(acct, []);
    matchesByAccount.get(acct)!.push(folder);
  }

  // 4. Build action plan
  let toRename = 0;
  let toCreate = 0;
  let alreadyCorrect = 0;
  const ambiguousAccounts: string[] = [];
  const planRows: Array<{ account: string; action: string; current: string; target: string }> = [];

  const sortedAccounts = Array.from(units.keys()).sort();
  for (const account of sortedAccounts) {
    const unit = units.get(account)!;
    const target = `${account} - ${STREET} #${unit.unit_number}`;
    const matches = matchesByAccount.get(account) ?? [];

    if (matches.length === 0) {
      planRows.push({ account, action: 'CREATE', current: '(none)', target });
      toCreate++;
    } else if (matches.length === 1) {
      if (matches[0].name === target) {
        planRows.push({ account, action: 'OK', current: matches[0].name, target });
        alreadyCorrect++;
      } else {
        planRows.push({ account, action: 'RENAME', current: matches[0].name, target });
        toRename++;
      }
    } else {
      ambiguousAccounts.push(account);
      planRows.push({ account, action: 'AMBIGUOUS', current: matches.map(m => m.name).join(' | '), target });
    }
  }

  // 5. Print plan summary
  console.log(`\n[plan summary]`);
  console.log(`  Already correctly named: ${alreadyCorrect}`);
  console.log(`  Will rename:             ${toRename}`);
  console.log(`  Will create new:         ${toCreate}`);
  console.log(`  Ambiguous (will skip):   ${ambiguousAccounts.length}`);
  console.log(`  Other folders kept:      ${unmatchedFolders.length} (Common Area, Master Insurance, etc — untouched)`);

  if (ambiguousAccounts.length > 0) {
    console.log(`\n[ambiguous accounts requiring manual review]`);
    for (const a of ambiguousAccounts) console.log(`  ${a}`);
  }

  console.log(`\n[plan sample — first 15 actions]`);
  for (const row of planRows.slice(0, 15)) {
    console.log(`  [${row.action.padEnd(9)}] ${row.account}: "${row.current}" → "${row.target}"`);
  }
  if (planRows.length > 15) console.log(`  … and ${planRows.length - 15} more`);

  if (!APPLY) {
    console.log(`\n💡 Dry run complete. Re-run with --apply to execute the plan.`);
    return;
  }

  // 6. Execute
  console.log(`\n[execute] Applying changes…`);
  const registryRows: any[] = [];
  let processed = 0;

  for (const account of sortedAccounts) {
    const unit = units.get(account)!;
    const target = `${account} - ${STREET} #${unit.unit_number}`;
    const matches = matchesByAccount.get(account) ?? [];

    let unitFolderId: string;

    if (matches.length === 1) {
      unitFolderId = matches[0].id;
      if (matches[0].name !== target) {
        await renameFolder(drive, unitFolderId, target);
      }
    } else if (matches.length === 0) {
      unitFolderId = await getOrCreateFolder(drive, target, PARENT_FOLDER_ID);
    } else {
      continue; // ambiguous, skipped
    }

    registryRows.push({
      account_number: account,
      association_code: ASSOCIATION_CODE,
      folder_type: 'unit_root',
      drive_folder_id: unitFolderId,
      drive_url: `https://drive.google.com/drive/folders/${unitFolderId}`,
    });

    for (const sub of SUBFOLDERS) {
      const subId = await getOrCreateFolder(drive, sub.name, unitFolderId);
      registryRows.push({
        account_number: account,
        association_code: ASSOCIATION_CODE,
        folder_type: sub.type,
        drive_folder_id: subId,
        drive_url: `https://drive.google.com/drive/folders/${subId}`,
      });
    }

    processed++;
    if (processed % 10 === 0) console.log(`  …${processed}/${units.size} units processed`);
  }

  // 7. Upsert registry
  console.log(`\n[registry] Upserting ${registryRows.length} folder records…`);
  for (let i = 0; i < registryRows.length; i += 500) {
    const batch = registryRows.slice(i, i + 500);
    const { error: upErr } = await supabase
      .from('unit_drive_folders')
      .upsert(batch, { onConflict: 'account_number,folder_type' });
    if (upErr) console.error('  upsert batch error:', upErr);
  }

  console.log(`\n✅ Done. ${processed}/${units.size} units have a standardized folder structure.`);
  if (ambiguousAccounts.length > 0) {
    console.log(`⚠️  ${ambiguousAccounts.length} ambiguous unit(s) still need manual review.`);
  }
}

main().catch(err => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
