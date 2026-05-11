# CINC API reference

Internal cheat-sheet for the CINC integration in `lib/integrations/cinc.ts`. Verified by `scripts/probe-cinc.ts` on 2026-05-11. CINC's own Swagger UI is the authoritative source; this file is a quick-reference summary plus what we learned that wasn't obvious from the docs.

## Configuration

| Env var | Production value | Notes |
|---------|------------------|-------|
| `CINC_AUTH_URL`      | `https://identity.cincsys.com/connect/token` | Note: **`.com`**, not `.io`. The `.io` host returns 403 on all calls. |
| `CINC_API_BASE`      | `https://PMITFP.cincsys.com/api`             | **Tenant-prefixed** with the org slug. Generic `integration.cincsys.com` returns HTML error pages, not real API responses. |
| `CINC_CLIENT_ID`     | (sensitive)                                   | Flagged as sensitive in Vercel → cannot be read back via CLI; must be re-set via dashboard or `vercel env add --force`. |
| `CINC_CLIENT_SECRET` | (sensitive)                                   | Same. |
| `CINC_SCOPE`         | `cincapi.all`                                 | Default. |
| `CINC_SYNC_ENABLED`  | `true`                                        | Gate — when false, the outbox drain is a no-op for CINC rows. |
| `CINC_DEFAULT_WO_TYPE` | (optional)                                  | Falls back to `'General Maintenance'` if unset; if no match, falls back to the first type in CINC's catalog. |

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

## WorkOrders endpoints

### Reads (`GET`)

| Endpoint | What |
|----------|------|
| `GET /management/1/workOrderStatuses`     | List all WO statuses + their IDs |
| `GET /management/1/workOrderTypes`        | List all WO types + their IDs (22 categories: Plumbing, Pool, Roof Leak, etc.) |
| `GET /management/1/workOrders`            | List work orders. **All params optional but at least one required.** Returns `WorkOrder[]` with embedded `Notes` array on each. |
| `GET /management/1/workOrderAttachments`  | List attachments for a particular work order |

### Writes (`POST`)

| Endpoint | What |
|----------|------|
| `POST /management/1/linkedWorkOrder`     | Create a WO linked to a homeowner / common area. Used by our outbox. |
| `POST /management/1/unlinkedWorkOrder`   | Create a WO with no linked location. Not currently used. |
| `POST /management/1/workOrderNotes`      | Append one or more notes. Used by our outbox on ticket-message append. |
| `POST /management/1/workOrderContacts`   | Add contacts to a WO. Not currently used. |
| `POST /management/1/workOrderAttachment` | Add an attachment (file as byte array, <25 MB). Not currently used. |

### Updates (`PATCH`)

| Endpoint | What |
|----------|------|
| `PATCH /management/1/workOrderStatus`        | Change a WO's status. **Needed for Phase A.5** (when our ticket resolves/closes, mirror to CINC). |
| `PATCH /management/1/workOrderStatusReopen`  | Reopen a closed/completed WO. |
| `PATCH /management/1/workOrderDetails`       | Update type, description, dates, work location. |

## Quirks

- **Tenant-prefixed host.** Every API call must go to `PMITFP.cincsys.com`, not `integration.cincsys.com`. The latter returns HTML error landing pages (not 403, but a 200 with HTML — easy to misread as success).
- **`/api` prefix required** under the tenant host. Without it, CINC's web app returns its HTML error page.
- **`.com` only.** The `.io` versions (`integration.cincsys.io`, `identityserver.cincsys.io`) all return 403 even with valid tokens. Possibly a deprecated environment.
- **`assocId` is required on linked work orders** and isn't directly addressable by `association_code`. Workaround: `GET /workOrders?assocCode=<code>` and pluck `AssocId` off the first row. Cached per container in `_assocIdCache`. **Edge case**: if no existing CINC work orders exist for an association, we can't derive the id this way — a human has to manually create the first one in CINC.
- **Sensitive env vars are write-only.** Once `CINC_CLIENT_ID` etc. are flagged sensitive in Vercel, `vercel env pull` returns them as empty strings. To get the real value into `.env.local` you must either grab from the Vercel dashboard (eye icon to reveal) or from CINC's original credentials email.

## Discovery probe

`scripts/probe-cinc.ts` walks a grid of host + path candidates and reports which combinations return real JSON. Re-run any time CINC support says "use this URL" and the integration starts 403-ing:

```
vercel env pull .env.local --environment=preview
# manually paste real CINC values into .env.local (sensitive vars come back blank)
npx tsx scripts/probe-cinc.ts > probe-cinc-output.json
```

## What's implemented vs pending

| Capability | Status | Notes |
|------------|--------|-------|
| Phase A: create CINC linked WO from our ticket | ✅ | `lib/integrations/cinc.ts` `createLinkedWorkOrder()` |
| Phase A: append our ticket message as a CINC note | ✅ | `appendNote()` |
| Phase A.5: mirror status changes to CINC | ❌ | `PATCH /workOrderStatus` available; not yet wired |
| Phase B-1: sync NEW work orders from CINC into our tickets | ❌ | `GET /workOrders` exists but exact "modified-since" param name TBD; needs probe extension or Swagger inspection |
| Phase B-2: sync notes (conversations) from CINC into our ticket_messages | ❌ | Notes embedded in `GET /workOrders` response → wire from same poll cron as B-1 |
| Phase B-3: reclassify work_order ↔ ticket locally | ✅ | PR #27 — UI button, no CINC mutation |
| Mirror file attachments both ways | ❌ | `workOrderAttachments` endpoints available; not prioritized |
