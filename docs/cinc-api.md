# CINC API reference

Internal cheat-sheet for the CINC integration in `lib/integrations/cinc.ts`. Verified by `scripts/probe-cinc.ts` on 2026-05-11 and cross-checked against CINC's own Swagger UI (`https://integration.cincsys.io/api/swagger/ui/index`). CINC's Swagger is authoritative; this doc is the quick-reference summary plus the gotchas not obvious from the spec.

## Configuration

| Env var | Production value | Notes |
|---------|------------------|-------|
| `CINC_AUTH_URL`      | `https://identity.cincsys.com/connect/token` | Note: **`.com`**, not `.io`. The `.io` host returns 403 on all API calls (but is fine as the docs host). |
| `CINC_API_BASE`      | `https://PMITFP.cincsys.com/api`             | **Tenant-prefixed** with the org slug. Generic `integration.cincsys.com` returns HTML error pages, not real API responses. |
| `CINC_CLIENT_ID`     | (sensitive)                                   | Flagged as sensitive in Vercel → cannot be read back via CLI; must be re-set via dashboard. |
| `CINC_CLIENT_SECRET` | (sensitive)                                   | Same. |
| `CINC_SCOPE`         | `cincapi.all`                                 | Default. |
| `CINC_SYNC_ENABLED`  | `true`                                        | Gate — when false, the outbox drain is a no-op for CINC rows. |
| `CINC_DEFAULT_WO_TYPE` | (optional)                                  | Falls back to `'General Maintenance'` if unset; if no match, falls back to first type in CINC's catalog. |

## Auth

```
POST https://identity.cincsys.com/connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=<CLIENT_ID>
&client_secret=<CLIENT_SECRET>
&scope=cincapi.all
```

Response: `{ access_token, expires_in: 3600, token_type: "Bearer" }`. Cached module-scope in `lib/integrations/cinc.ts` until ~60s before expiry.

All API calls require `Authorization: Bearer <token>`.

## Endpoints (full catalog)

### `GET /management/1/workOrderStatuses`
No parameters. Returns:
```json
[ { "WorkOrderStatusId": 0, "WorkOrderStatusDescription": "string", "IsCompleted": 0 } ]
```
`IsCompleted` (0/1) tells us which statuses are "done" — useful for mapping our `resolved`/`closed` to the right CINC status.

### `GET /management/1/workOrderTypes`
No parameters. Returns `[ { WorkOrderTypeId, WorkOrderTypeDescription } ]`. 22 categories at our tenant: Plumbing, Pool, Roof Leak, Building repair, HVAC, etc.

### `GET /management/1/workOrders`
**At least one query parameter is required.** Returns rich work-order objects with embedded notes, contacts, and vendor info.

Query params:
| Name | Type | Description |
|------|------|-------------|
| `workOrderId` | int | Single work-order lookup |
| `assocId` | int | Filter by association (CINC internal id) |
| `assocCode` | string | Filter by association code |
| `vendorId` | int | Filter by vendor |
| `typeId` | int | Filter by work-order type |
| `statusId` | int | Filter by status |
| `fromDate` / `toDate` | datetime | Filter by **DueDate** (`mm/dd/yyyy`) |
| **`createdFromDate` / `createdToDate`** | datetime | Filter by **CreatedDate** (`yyyy-mm-dd hh:mm:ss`, GMT). **This is the cursor we use for inbound polling.** |
| `createdByUserId` / `createdByUserName` | int / string | Filter by creator |

**Important: there is NO `modifiedAfter` parameter.** Updates to existing work orders (status changes, new notes) cannot be discovered by date filter. We have to re-fetch each open work order by ID to detect updates. See "Inbound sync architecture" below.

Response shape:
```json
[{
  "WorkOrderId": 0,
  "AssocId": 0, "AssocCode": "string", "AssociationName": "string",
  "HoID": "string", "PropertyId": 0,
  "IsCommonArea": 0, "IsUnlinked": 0,
  "EnteredDate": "...", "CreatedDate": "...", "CreatedBy": "string",
  "IssuedDate": "...", "DueDate": "...", "FollowUpDate": "...",
  "Description": "string", "EstimateTotal": 0,
  "WorkOrderStatusId": 0, "WorkOrderStatus": "string",
  "WorkOrderTypId": 0, "WorkOrderType": "string",   // sic: "TypId" — CINC typo
  "Contacts":        [ { "ContactId": 0, "ContactName": "...", "ContactEmail": "...", "ContactPhone": "..." } ],
  "VendorId": 0, "Vendor": "string",
  "VendorContacts":  [ { "VendorContactId": 0, "VendorName": "...", "VendorEmail": "...", "VendorPhone": "...", "VendorCell": "...", "VendorFax": "..." } ],
  "WorkLocationName": "...", "AddressLine1": "...", "AddressLine2": "...", "City": "...", "State": "...", "Zip": "...",
  "Notes": [ {
    "NoteId": 0, "NoteDescription": "string", "NoteCreatedDate": "...",
    "NoteCreatedUserId": 0, "NoteCreatedBy": "string",
    "IsNotePublic": 0, "IsNoteEmailedToVendor": 0, "IsNoteEmailedToWorkLocation": 0,
    "IsNoteSystemGenerated": 0,
    "NoteDeletedBy": "string", "NoteDeletedDate": "..."
  } ]
}]
```

### `GET /management/1/workOrderAttachments`
Required query param: `workOrderId` (int). Returns `[ { FileName, CreatedDate, FileSize, FileContent } ]`. `FileContent` is base64-encoded bytes.

### `POST /management/1/linkedWorkOrder`
Create a WO linked to a homeowner or common area. Body:
```json
{
  "assocId": 0,                            // required
  "workOrderTypeId": 0, "description": "string",
  "workOrderStatusId": 0, "estimateTotal": 0,
  "dueDate": "...", "followUpDate": "...",
  "assocAddressId": 0, "propertyId": 0,
  "contactEmail": "...", "contactPhone": "...",
  "additionalContacts": [ { "addlContactName": "...", "addlContactEmail": "...", "addlContactPhone": "..." } ],
  "vendorId": 0, "vendorName": "...",
  "notes": { "noteDescription": "...", "isNotePublic": true, "isNoteEmailedToWorkLocation": true, "isNoteEmailedToVendor": true }
}
```
Returns 201. **The Swagger spec shows empty body `{}` but the actual response includes `workOrderId`** (confirmed empirically — we extract it in `createLinkedWorkOrder()`).

### `POST /management/1/unlinkedWorkOrder`
Same shape as `linkedWorkOrder` but with explicit address fields (`workLocationName`, `addressLine1`, `addressLine2`, `city`, `state`, `zip`) and no `propertyId`. For WOs at locations not registered in CINC. Not currently used by our integration.

### `POST /management/1/workOrderNotes`
Required query param: `workOrderId` (int). Body is **array** (can append multiple notes in one call):
```json
[ { "noteDescription": "...", "isNotePublic": true, "isNoteEmailedToWorkLocation": true, "isNoteEmailedToVendor": true } ]
```
Returns 201. Used by our outbox on ticket-message append.

### `POST /management/1/workOrderContacts`
Required query param: `workOrderId` (int). Body is array of `{ addlContactName, addlContactEmail, addlContactPhone }`. Returns 201. Not currently used; useful for adding watchers/CCs after creation.

### `POST /management/1/workOrderAttachment`
Singular endpoint (asymmetric with the plural GET). Required query param: `workOrderId` (int). Body is array of `{ fileName, file }` where `file` is base64-encoded bytes. **Max 25 MB per file.** Returns 201. Not currently used.

### `PATCH /management/1/workOrderStatus`
Body uses **PascalCase keys** (inconsistent with the camelCase POST endpoints):
```json
{
  "WorkOrderId": 0, "WorkOrderStatusId": 0,
  "Note": "string",
  "IsEmailedToVendor": true, "IsEmailedToWorkLocation": true, "IsPublic": true,
  "VendorRating": 0, "VendorRatingNote": "string"
}
```
**This is the endpoint for Phase A.5** — mirror status changes from our ticket to CINC.

### `PATCH /management/1/workOrderStatusReopen`
Same shape as `workOrderStatus` plus `WorkOrderTypeId`. Used when our ticket goes from `resolved`/`closed` back to `open` and we need to reopen the CINC work order.

### `PATCH /management/1/workOrderDetails`
Updates type, description, dates, work location. **Not** status or vendor (those have their own endpoints). PascalCase body:
```json
{
  "WorkOrderId": 0, "WorkOrderTypeId": 0,
  "Description": "string", "EstimateTotal": 0,
  "DueDate": "...", "FollowupDate": "...",
  "AssocAddressId": 0, "PropertyId": 0,
  "WorkLocationName": "...", "AddressLine1": "...", "AddressLine2": "...",
  "City": "...", "State": "...", "Zip": "..."
}
```

## Quirks

- **Tenant-prefixed host.** Every API call must go to `PMITFP.cincsys.com`, not `integration.cincsys.com`. The latter returns HTML error landing pages (200 OK with HTML, easy to misread as success).
- **`/api` prefix required** under the tenant host. Without it, CINC's web app returns its HTML error page.
- **`.com` only.** The `.io` versions (`integration.cincsys.io`, `identityserver.cincsys.io`) all return 403 even with valid tokens. Possibly a deprecated environment.
- **`assocId` required on linked work orders** and isn't directly addressable by `association_code`. Workaround: `GET /workOrders?assocCode=<code>` and pluck `AssocId` off the first row. Cached per container in `_assocIdCache`. **Edge case**: if no existing CINC work orders exist for an association, we can't derive the id this way — a human has to create the first one in CINC manually.
- **Sensitive env vars are write-only.** Once `CINC_CLIENT_ID` etc. are flagged sensitive in Vercel, `vercel env pull` returns them as empty strings.
- **PascalCase vs camelCase inconsistency.** POST endpoints use camelCase (`workOrderTypeId`); PATCH endpoints use PascalCase (`WorkOrderTypeId`). Even within one shape: `WorkOrderTypId` (sic — CINC's typo) shows up in the GET workOrders response.
- **`POST /linkedWorkOrder` response.** Swagger shows empty `{}` but the actual response includes `workOrderId`. Don't trust the empty spec.
- **No "modified-after" filter on `GET /workOrders`.** Only `createdFromDate` / `createdToDate` (by Created Date) and `fromDate` / `toDate` (by Due Date). To detect status/note updates on existing WOs, we must re-fetch each open one by ID.

## Inbound sync architecture (planned)

For B-1 (sync NEW WOs) and B-2 (sync notes/status changes on existing WOs), the cron `sync-cinc-inbound` runs every 5 min with two passes:

### Pass 1 — Discovery (NEW work orders)
```
GET /workOrders?createdFromDate=<last_sync_cursor>
For each WO returned:
  upsert into tickets (by cinc_workorder_id)
    - type='work_order'
    - status = mapped from WorkOrderStatus
    - association_code = AssocCode
    - subject = Description (first line)
    - contact_email/phone/name from Contacts[0]
  insert ticket_messages from Notes[] (where IsNoteSystemGenerated=0 or per policy)
Update cursor to max(CreatedDate) from response.
```

### Pass 2 — Refresh (UPDATES on existing WOs)
```
For each ticket where cinc_workorder_id IS NOT NULL AND status NOT IN ('resolved','closed'):
  GET /workOrders?workOrderId=<cinc_workorder_id>
  Diff: status changed? new notes by NoteId? new attachments?
  Insert new notes into ticket_messages
  Update ticket fields if status or fields changed
```

A small `cinc_sync_state` table holds `cursor`, `last_run_at`, `last_error`.

## Discovery probe

`scripts/probe-cinc.ts` walks a grid of host + path candidates and reports which return real JSON. Re-run any time the integration starts 403-ing or CINC support says "use this URL":

```bash
vercel env pull .env.local --environment=preview
# manually paste real CINC values into .env.local (sensitive vars come back blank)
npx tsx scripts/probe-cinc.ts > probe-cinc-output.json
```

## What's implemented vs pending

| Capability | Status | Notes |
|------------|--------|-------|
| Phase A: create CINC linked WO from our ticket | ✅ | `createLinkedWorkOrder()` |
| Phase A: append our ticket message as a CINC note | ✅ | `appendNote()` |
| Pick a CINC Type when creating a work order | ✅ | PR #26 — `tickets.work_order_type_id` flows through |
| B-3: reclassify work_order ↔ ticket locally | ✅ (PR #27) | UI button, no CINC mutation |
| Phase A.5: mirror status changes our → CINC | ❌ | `PATCH /workOrderStatus` available; not yet wired |
| Phase A.5: mirror description/type/dates our → CINC | ❌ | `PATCH /workOrderDetails` available; not yet wired |
| B-1: sync NEW work orders CINC → ours | ❌ | Use `createdFromDate` cursor |
| B-2: sync notes (and status updates) on existing WOs | ❌ | Re-fetch by `workOrderId`; notes embedded in response |
| Mirror file attachments both ways | ❌ | `workOrderAttachment(s)` endpoints documented |
