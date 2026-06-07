# Spec — Push work-order photos MAIA → CINC

_Status: 🔴 not built. Drafted 2026-06-07. Companion to `docs/ROADMAP.md` (CINC sync gaps)._

## Problem / goal
Today MAIA work-order sync is **one-way for photos**: we **mirror CINC's photos → MAIA**
(`listWorkOrderAttachments` + the `work_order_attachments` table, `source='cinc'`), but we
**never upload MAIA's own photos → CINC**. So a vendor/staff photo that arrives by email or
admin upload shows in MAIA but is invisible to anyone using CINC's native UI.

**Goal:** when a real photo is added to a MAIA work order that's linked to CINC, push it into
the CINC work order too. (Notes/observations already sync — `createLinkedWorkOrder` body.notes
on create + `addWorkOrderNote` via the outbox for ongoing ones. Only PHOTOS are missing.)

## CINC endpoint (confirmed, API v1.40.0)
`POST /management/1/workOrderAttachment`  (singular — the plural `…Attachments` is the GET list)
- `workOrderId` is a **query** param.
- Body is an **array** (batch): `[ { "fileName": "string", "file": "<base64>" } ]`.
- `file` = base64 bytes. **≤ 25 MB** each.

## New CINC wrapper (`lib/integrations/cinc.ts`)
```ts
/** Push one or more files INTO a CINC work order. file = base64, ≤25MB each. */
export async function pushWorkOrderAttachments(
  workOrderId: number,
  files: Array<{ fileName: string; file: string /* base64 */ }>,
): Promise<void> {
  if (!files.length) return
  await call<unknown>('/management/1/workOrderAttachment', {
    method: 'POST',
    query:  { workOrderId },
    json:   files,
  })
}
```
(Model on `attachInvoicePdf`. No ImageID is returned for WO attachments per Swagger, so don't
require one back.)

## What to push (and NOT)
- Push only `work_order_attachments` with **`source IN ('email','staff_upload')`** — never
  `source='cinc'` (those came FROM CINC; pushing back = duplicate).
- Only images that survive the existing **logo/dedupe filter** (already applied at ingest by
  `lib/email-attachment-filter.ts`), under the 25 MB cap (already compressed by
  `normalizeStoredFile`).
- Only when the work order has a **`cinc_workorder_id`** (it's actually linked). If not linked
  yet, leave it unpushed — backfill once it links (see Backfill).

## Idempotency (migration)
Add to `work_order_attachments`:
```sql
ALTER TABLE public.work_order_attachments
  ADD COLUMN IF NOT EXISTS cinc_pushed_at timestamptz;
NOTIFY pgrst, 'reload schema';
```
Register in `lib/migration-status.ts`. Skip any row with `cinc_pushed_at IS NOT NULL`. Stamp it
after a successful push so we never double-push the same MAIA photo.

> Dedupe caveat: CINC renames files on upload (`file<hash>.png`), so we can't perfectly dedupe
> against a photo a vendor *also* uploaded directly in CINC. Mitigation = only push MAIA-origin
> rows + the `cinc_pushed_at` stamp. Accept the rare double if a vendor both emailed and uploaded.

## Wiring (use the existing outbox — same pattern as notes/WO-create)
1. **Enqueue** an outbox event after a photo is saved, when the WO is CINC-linked:
   - `lib/maia-command-processor.ts` → `attachEmailPhotosToWorkOrder` (email path).
   - `app/api/admin/work-orders/[id]/photos/route.ts` POST (staff upload path).
   - New event kind e.g. `('work_order_attachment','push_photo')` with `{ ticketId, attachmentId }`.
2. **Handle** in `lib/integrations/outbox-handler.ts`: load the attachment bytes from the
   `work-order-photos` bucket → base64 → resolve the WO's `cinc_workorder_id` →
   `pushWorkOrderAttachments(...)` → stamp `cinc_pushed_at`. (Outbox gives retry + ordering;
   the drain cron is already running with `CINC_SYNC_ENABLED=true`.)

## Backfill (existing photos + newly-linked WOs)
- Admin action (button on the WO photos widget or a small route): for a given ticket — or sweep
  all CINC-linked WOs — push every `source IN ('email','staff_upload')` photo with
  `cinc_pushed_at IS NULL`.
- Also trigger backfill when a WO first gets its `cinc_workorder_id` (the outbox WO-create result).

## Acceptance
- Email a photo to a CINC-linked WO → it appears in CINC's native WO attachments within a drain
  cycle, exactly once.
- Staff upload in admin → same.
- Re-running the drain / re-saving doesn't create duplicates (`cinc_pushed_at` guard).
- CINC-mirrored photos (`source='cinc'`) are never pushed back.

## Out of scope
- Pulling CINC → MAIA (already done via the mirror).
- The 10 unsynced WOs ("Cannot resolve AssocId") — separate task: seed one WO per association in
  CINC, then they link and this backfills.
