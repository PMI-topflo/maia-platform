---
name: CINC API — Swagger + in-repo reference
description: Where to look up CINC API endpoints. Repo has a running map at CINC_API.md; canonical source is CINC's Swagger UI.
type: reference
originSessionId: 0363c6fe-ab6d-4432-a13b-88c075f3d964
---
CINC's REST API has its own browsable Swagger UI plus an in-repo reference doc that mirrors what we've discovered.

**In-repo doc**: `CINC_API.md` at the repo root. Contains the full category list (ACCInfo, Accounting, Association, HomeownerInfo, WorkOrders, etc.), the endpoints we already use, response shapes for the ones we've probed, and conventions (path style, camelCase params, 4xx-means-empty semantics). Update this file as new endpoints are discovered.

**External Swagger**:
- UI (browse + try-it-out): https://integration.cincsys.io/api/swagger/ui/index
- JSON spec: https://integration.cincsys.io/api/swagger/docs/1.40.0
- Tenant API base (production): https://PMITFP.cincsys.com/api
- OAuth token URL: https://identity.cincsys.com/connect/token
- API version (Feb 2026): 1.40.0
- Auth: OAuth 2.0 client_credentials, scope `cincapi.all`, bearer token

**When to use this**:
- Before probing CINC for a new endpoint, check `CINC_API.md` to avoid re-probing what's already documented.
- After discovering a new endpoint via the probe pattern, update `CINC_API.md` so the next session doesn't have to rediscover.
- For unfamiliar categories, browse the Swagger UI rather than guessing endpoint shapes.

**Probe pattern**: `scripts/probe-cinc-work-orders.ts` is the template — read-only GETs, PII redaction, summary table + full JSON dump.

**Voiding/deleting invoices is NOT API-exposed (verified 2026-06-03):** our tenant returns **404** for `PUT /management/1/accounting/voidInvoice` (CINC_API.md lists it but it isn't live) and **405** for `DELETE` on the invoice resource. Only create/update/approve/expenseItems are writable. To void/delete an invoice (e.g. a duplicate), do it in **CINC WebAxis (web UI)**, not the API.

**Attach a PDF to an existing invoice (works):** `PUT /management/1/associations/InvoiceAttachmentsBase64`, body `{InvoiceID, FileName, File:<base64>}` → returns `{ImageId, FileName}`. Used to fix invoices pushed without a PDF.
