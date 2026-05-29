# CINC API reference

Living reference for CINC's REST API as we discover endpoints. The
canonical source is CINC's own Swagger UI; this file is for Claude
sessions and humans who want a quick map without clicking through the
Swagger explorer every time.

> **If you need an endpoint not documented here**, open the Swagger UI
> below, paste the endpoint shape into this file, and commit.

---

## Where to look things up

| What | URL |
|------|-----|
| Swagger UI (browse + try-it-out) | <https://integration.cincsys.io/api/swagger/ui/index> |
| Swagger JSON spec | <https://integration.cincsys.io/api/swagger/docs/1.40.0> |
| Tenant API base (production) | `https://PMITFP.cincsys.com/api` |
| OAuth token URL | `https://identity.cincsys.com/connect/token` |
| API version (at time of writing) | `1.40.0` |

**Auth**: OAuth 2.0 `client_credentials` flow with scope `cincapi.all`.
Token cached in `lib/integrations/cinc.ts`. The `Authorization: Bearer <token>`
header is required on every call. See `call<T>()` in that file for the
standard request wrapper (handles 401 retry on mid-flight expiration).

---

## API categories

These are the top-level groups in the Swagger UI. Click into each in
the Swagger to see the individual endpoints; documented ones below get
expanded sub-sections.

| Category | Documented below | Notes |
|----------|------------------|-------|
| ACCInfo | yes | ACC = Architectural Change Control. 3 endpoints |
| Accounting | yes | Big surface: charges, invoices, GL, budgets, lockbox. 25+ endpoints |
| AgedBalances | yes | 1 endpoint |
| Association | yes | Two path patterns: `/management/1/associations/...` and `/management/associations/1/...` |
| Banking | yes | 1 endpoint |
| BillingType | yes | 1 endpoint |
| CallLog | yes | 5 endpoints; potential integration with our Twilio inbound |
| Charges | yes | 1 endpoint |
| Documents | yes | 3 endpoints; **pairs with InvoiceAttachments** for upload → download round-trip |
| FlaggedCollections | yes | Collections workflow — accounts in collection steps + their attachments |
| HomeownerInfo | yes | Huge surface (~35 endpoints). Key for task 7 (ledgers) — see `homeownerTransactionByAssociation` |
| MiscInfo | yes | 2 endpoints — custom field categories per assoc |
| Payment | yes | 2 endpoints — payment entry point + transaction codes |
| User | yes | 2 endpoints — security groups + user list |
| VendorInfo | yes | ~22 endpoints. Insurance docs upload (10 MB cap, multiple variants) |
| Violations | yes | 2 endpoints |
| WorkOrders | yes (full) | see below. **`POST /workOrderAttachment` enables bidirectional photo sync** |

---

## ACCInfo

Architectural Change Control — homeowner requests to modify common-area-visible elements (paint, fences, etc.). Used by associations that require board approval for exterior changes.

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/associations/ACCInfo` | All ACC info for all associations (or one if assocCode param provided) |
| `POST /management/1/ACCInfo` | Create an ACC request |
| `GET /management/1/ACCType` | All ACC types (reference data) |

---

## Accounting

The largest category. Covers homeowner charges, invoices, GL transactions, budgets, late fees, and lockbox. Most relevant for the future "send my ledger" feature (task 7) and any owner-facing financial summary.

### Charges + balances + transactions

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/accounting/chargeCodes` | All charge codes |
| `GET /management/1/accounting/transactionHistory` | All transaction history |
| `GET /management/1/accounting/recurringCharges` | All recurring charges |
| `GET /management/1/accounting/lateFees` | All late fees |
| `GET /management/1/accounting/balance` | Returns the balance |
| `GET /management/1/accounting/allCurrentBalances` | Current balance for selected categories of homeowners |
| `POST /management/1/accounting/chargeAndAdjustments` | Post charges + adjustments to individual homeowner accounts |
| `GET /management/1/accounting/billableCounts` | Billable counts |

### Legal status

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/accounting/legalStatus` | All legal statuses |
| `GET /management/1/accounting/legalStatusByAssociation` | Homeowner legal statuses without balance for a specified association |

### Invoices

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/accounting/openInvoices` | Open invoices (all assocs if no code) |
| `POST /management/1/accounting/invoice` | Create invoice; returns invoice info |
| `PUT /management/1/accounting/invoice` | Update invoice; returns invoice info |
| `PUT /management/1/accounting/approveInvoice` | Approve an invoice |
| `PUT /management/1/accounting/voidInvoice` | Void an invoice |
| `POST /management/1/accounting/expenseItems` | Create invoice expense items; returns IDs |
| `PUT /management/1/accounting/expenseItems` | Update invoice expense items |
| `DELETE /management/1/accounting/expenseItems` | Delete invoice expense items |
| `GET /management/1/accounting/invoiceNotes/{invoiceID}` | Invoice notes (pass `includeDeleted=true` to include deleted) |
| `POST /management/1/accounting/invoiceNotes` | Create invoice notes |
| `GET /management/1/accounting/invoiceInstruction/association/{assocCode}` | Invoice instructions |
| `GET /management/1/accounting/duplicateInvoices` | Duplicate invoices for a given assoc + vendor |
| `POST /management/1/accounting/approvedInvoices` | Post fully approved invoices into "Ready for Payment" status |

### Lockbox + batches + setup

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/accounting/lockBox` | Lockbox info |
| `GET /management/1/accounting/transactionSetup` | Transaction setup data |
| `GET /management/1/accounting/openManualBatches` | Open manual posting batches |

### Budgets

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/accounting/budget/association/{assocCode}` | Budget data for an association |
| `GET /management/1/accounting/budgetByMonth` | Month-by-month budget for a fiscal year |

### General Ledger

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/accounting/glTransactions` | GL transactions for an assoc, filterable by transaction type |
| `GET /management/1/accounting/glTransactionsByDateAndAssocCode` | GL transactions by assoc code + date |
| `GET /management/1/accounting/glPreviousBalanceAsOfADate` | "Previous Balance" — final balance before a given date |
| `GET /management/1/accounting/glSegmentDescriptions` | GL segments + descriptions |

---

## AgedBalances

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/AgedBalances` | Aged balances |

---

## Association

Two distinct path patterns appear in this category:

- `/management/1/associations/...` — the older / write-heavy endpoints
- `/management/associations/1/...` — newer read endpoints (note the swap: `associations/1/` not `1/associations/`)

### Association metadata + roles

| Method + path | Purpose | Wrapper |
|---------------|---------|---------|
| `GET /management/1/associations` | All assocs, or one if `assocCode` param provided | `findAssocIdByCode()`, `listAllCincAssociations()`, `getAssociationMeta()` |
| `GET /management/1/associations/correspondenceType` | Descriptions of correspondences + ids |  |
| `PATCH /management/1/associations/contact` | Update association contact |  |
| `GET /management/1/associations/types` | All association types |  |
| `GET /management/1/associations/addresses` | Addresses for a given association |  |
| `PATCH /management/1/associations/manager` | Set a user as manager for an association |  |
| `PATCH /management/1/associations/assistantManager` | Set a user as assistant manager |  |
| `GET /management/1/associations/region` | Region for an assoc (or all assocs) |  |
| `PATCH /management/1/associations/region` | Update region |  |
| `GET /management/1/associations/office` | Office for an assoc (or all assocs) |  |
| `PATCH /management/1/associations/office` | Update region office |  |
| `GET /management/1/associations/boardMembers` | Board member info for active associations | `listAssociationBoardMembers()` |

### Widget / dashboard data (note the path swap)

| Method + path | Purpose |
|---------------|---------|
| `GET /management/associations/1/getWidgetData` | Data for the association widget |
| `GET /management/associations/1/assessments` | All defined assessments for an assoc |
| `GET /management/associations/1/miscInformation` | Misc info |
| `GET /management/associations/1/associationGlAccounts` | GL account info |
| `GET /management/associations/1/payByTypes` | Pay-by types for invoices |
| `GET /management/associations/1/invoiceStatuses` | Status types for invoices |
| `GET /management/associations/1/associationBankAccounts` | **404 in our tenant — use `/banking/bankBalances` instead** (last 4 digits only) |
| `GET /management/associations/1/invoicePayments` | Payments for an invoice |
| `GET /management/associations/1/invoiceHistory` | History for an invoice |
| `GET /management/associations/1/invoice` | A specific invoice |
| `GET /management/associations/1/invoices` | Invoices matching search params |

### Invoice attachments (single-file pattern — different from WorkOrders!)

> **Note**: unlike `workOrderAttachments` (returns *many* photos as base64), invoice attachments are limited to **one file per invoice, max 25 MB**. CINC offers two upload variants:

| Method + path | Purpose |
|---------------|---------|
| `PUT /management/1/associations/InvoiceAttachments` | Attach file (ByteArray). 1 attachment max, 25 MB max. Returns ImageID |
| `PUT /management/1/associations/InvoiceAttachmentsBase64` | Same, but Base64-encoded body. Returns ImageID |
| `DELETE /management/1/associations/InvoiceAttachments` | Delete an attachment by invoice ID + image ID |

### User-defined fields

| Method + path | Purpose |
|---------------|---------|
| `PUT /management/1/associations/associationUserDefined` | Update user-defined fields on the Association Information screen. **Warning**: fields with no value provided are *deleted* |

---

## Banking

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/banking/bankBalances` | Bank accounts + live balances for an assoc. Returns `BankAccountID`, `AccountDescription` ("SSB - Operating - 8614"), `CashAccountNumber` ("10-1020-00"), `BankBalance`, `CincBalance`. **Note**: the `Reserve` boolean is unreliable — returns `false` for actual reserve accounts. Detect kind from description text ("Operating" / "Reserve" / "Special Assessment") or Cash GL prefix (10-=operating, 12-=reserve, 13-=likely SA). Use this as the source for `PayFromBankAccountID` on createInvoice. |

---

## BillingType

| Method + path | Purpose |
|---------------|---------|
| `PATCH /management/1/billing/billingType` | Update billing type for a given billing type id |

---

## CallLog

Homeowner call records. Could plug into our Twilio inbound flow later — when a call hits the office line, we could push a row into CINC via `POST /callLog` so the property manager sees it natively.

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/callLog` | Call logs for a given homeowner |
| `POST /management/1/callLog` | Create a new call log |
| `PUT /management/1/callLog` | Create or update a call log |
| `GET /management/1/callLogAsignee` | Call-log assignees (sic — CINC's spelling, not a typo) |
| `GET /management/1/callLogCollectionHold` | Hold info for call logs (incl. days held) |

---

## Charges

| Method + path | Purpose |
|---------------|---------|
| `POST /management/1/charges` | Creates charges |

> Distinct from `/accounting/chargeAndAdjustments`. We haven't probed both to compare — likely `/charges` is a simpler create endpoint while `/chargeAndAdjustments` handles adjustments too. Probe before using if it matters.

---

## Documents

The "any file stored in CINC" download surface. Pairs with the upload endpoints in other categories (e.g. `InvoiceAttachments` returns an `ImageID` → fetch the binary via `GET /document/{ImageID}`).

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/documentIds` | All document ids |
| `GET /management/1/documents/{fileId}` | Documents for a given file id |
| `GET /management/1/document/{ImageID}` | A document by image/file id. **One File Id can map to multiple files** (e.g. scanned check front + back) |

> Note plural vs singular: `/documents/{fileId}` returns the *collection* for a file id (multiple images can share one fileId); `/document/{ImageID}` returns *one* specific image.

---

## FlaggedCollections

Homeowner accounts that have been flagged for collections. The `attachment` endpoint returns the correspondence (legal notices, demand letters) tied to those collection steps.

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/flaggedcollections` | Accounts in collection steps |
| `GET /management/1/flaggedcollections/attachment` | Correspondence attachments |
| `GET /management/1/flaggedcollections/collectionStatus` | Collection statuses for a specific association |
| `GET /management/1/flaggedCollections/homeownersInCollections` | Homeowners in various collection steps (note camelCase `C` mid-path) |

---

## HomeownerInfo

The largest category. Covers homeowner lookup, transactions (statements/ledgers), correspondence (letters, notices), addresses, contacts, and IVR-payment lookups. **Many v2 endpoints are marked [BETA]** — prefer v1 in production code; revisit v2 once GA.

### Lookup + listing

| Method + path | Purpose | Wrapper |
|---------------|---------|---------|
| `GET /management/1/associations/homeownerinfo` | Current homeowner info. Warns "may timeout for large databases" if no filters | |
| `GET /management/2/homeowners/homeownerinfo` | [BETA] Homeowner info by params | |
| `GET /management/1/homeowners/homeownerlookup` | Homeowner lookup. All params optional, at least one required | |
| `GET /management/2/homeowners/homeownerlookup` | [BETA] Lookup homeowner or contact by params | |
| `GET /management/1/homeowners/allByProperty` | All homeowner data | |
| `GET /management/2/homeowners/allByProperty` | [BETA] All homeowner data | |
| `GET /management/1/homeowners/status` | All homeowner statuses | |
| `GET /management/1/homeowners/activityLogs` | Activity logs | |

### Property + association links

| Method + path | Purpose | Wrapper |
|---------------|---------|---------|
| `GET /management/1/homeowners/propertyInformation` | Property info by property ID | |
| `GET /management/2/homeowners/propertyInformation` | [BETA] Same | |
| `GET /management/1/homeowners/associationWithProperty` | All property info for an association | (used by CINC sync) |
| `GET /management/2/homeowners/associationWithProperty` | [BETA] Same | |
| `PATCH /management/1/homeowners/{propertyId}/SetAchDate` | Update ACH start date for a property | |
| `PATCH /management/1/homeowners/{propertyAddressId}/ownerFlag` | Update owner flag based on property address id | |

### Addresses

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/homeowner/address` | Returns homeowner (single) |
| `GET /management/1/homeowners/mailingAddress` | Mailing addresses for a specific homeowner code |
| `POST /management/1/homeowners/mailingAddress` | Create address for specific property |
| `PUT /management/1/homeowners/mailingAddressPut` | Update address for specific property |
| `GET /management/1/homeowners/mailingAddress/id` | Mailing address for specific address ID |
| `GET /management/2/homeowners/mailingAddress` | [BETA] Addresses for a specific homeowner |
| `GET /management/1/homeowners/addressType` | All address types |
| `DELETE /management/1/homeowner/deleteAddress` | Deletes homeowner address. **If the address is the Property Address, that gets flagged as owner address first, then deleted** — read the API doc carefully before calling |

### Email/phone + billing

| Method + path | Purpose |
|---------------|---------|
| `PUT /management/1/homeowners/updateEmailPhone` | Updates email + phone |
| `PUT /management/1/homeowners/updateBillingType` | Update billing type |

### Transactions / ledger (KEY for task 7)

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/associations/{assocCode}/homeowners/{hoId}/homeownertransaction` | Homeowner transaction (one specific homeowner) |
| `GET /management/1/associations/{assocCode}/homeowners/{hoId}/homeownertransactionWithPropertyId` | Same, adding property ID as part of the parameters |
| `GET /management/1/homeowners/homeownerTransactionByAssociation` | Transactions by association. **Date range cannot exceed 366 days** |

### Correspondence (letters, notices)

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/homeowners/correspondencetype` | Correspondence types |
| `GET /management/1/homeowners/correspondence` | Correspondence types (yes, two endpoints with similar names) |
| `GET /management/1/homeowners/correspondencestatus` | Correspondence status |
| `GET /management/1/homeowners/correspondencenotetype` | Correspondence note type |
| `GET /management/1/homeowners/correspondencetemplate` | Correspondence template |
| `PUT /management/1/homeowners/accountCorrespondence` | Update account correspondence |
| `PUT /management/2/homeowners/accountCorrespondence` | Add a correspondence record for a homeowner |
| `GET /management/1/homeowners/correspondenceInfo` | All correspondence info for current homeowner (by hoId or propertyId) |
| `GET /management/1/homeowners/correspondenceFile` | **Binary data for a specific correspondence by file ID** |
| `GET /management/1/homeowners/correspondenceInfoByDateRange` | Correspondence info by date range |
| `PATCH /management/1/homeowners/{propertyId}/UpdateCorrespondenceStatus` | Update correspondence status |

### Collections hold

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/homeowners/homeownerHoldCollectionStatus` | CINC IDs for the Hold Collections Reason statuses |
| `PUT /management/1/homeowners/homeownerHoldCollectionStatusUpdate` | Update a homeowner's Hold Collections Status + Resume Collection date |

### Contacts & Consent (BETA — newer feature)

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/homeowners/propertyContacts` | [BETA] Contacts associated with a homeowner |
| `GET /management/1/homeowners/contactsFlag` | [BETA] Whether the Contacts & Consent feature is enabled for the customer |
| `PATCH /management/1/homeowners/propertyContact` | [BETA] Update details of a contact |
| `PUT /management/1/homeowners/propertyContactMailingAddressSelection` | [BETA] Assign/unassign a mailing address to a contact |
| `GET /management/1/homeowners/propertyContactTypes` | [BETA] All Property Contact Types |

### IVR / phone payment lookup

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/homeowners/getHomeownerDetailsForIVRPayment` | Looks up a homeowner for IVR (Phone) Payments. All params optional, at least one required |

---

## MiscInfo

Custom field categories per association — for data CINC doesn't model natively.

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/miscInfo/miscInfoFieldCategories` | Field categories that can be used to retrieve Misc Info |
| `GET /management/1/miscInfo/associationMiscInfo` | Miscellaneous Information for an association |

---

## Payment

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/payment/paymentEntryPoint` | Payment Entry Point for an association |
| `GET /management/1/payment/paymentTransactionCode` | Transactions + Transaction Code received from the payment provider |

---

## User

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/users/userSecurityGroup` | All security groups |
| `GET /management/1/users/userslist` | All users in the system |

---

## VendorInfo

Vendor master data + insurance documents + licenses. Insurance file uploads come in **four** variants — useful for choosing the right shape (form-data vs ByteArray, PATCH vs PUT).

### Vendor records + contacts

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/vendors` | All vendors, or one if vendorId provided |
| `POST /management/1/vendors` | Create new vendor |
| `GET /management/1/vendorsBasic` | Basic info for all vendors or one |
| `PATCH /management/1/vendors/vendor` | Update vendor with info provided |
| `GET /management/1/vendor/{vendorId}/contacts` | All vendor contact info |
| `GET /management/1/vendor/{vendorId}/accounts` | All vendor account info |
| `GET /management/1/vendors/correspondenceType` | All vendor correspondence types |
| `PUT /management/1/vendors/vendorContact` | Update or create vendor contact. Comments for primary contacts won't display in CINC |

### Insurance (file upload — 10 MB cap)

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/vendors/vendorInsurance` | List of vendor insurances |
| `PATCH /management/1/vendors/vendorInsuranceUpdate` | Update insurance + optional file (form-data, named "Input"). 10 MB max |
| `PUT /management/1/vendors/vendorInsuranceUpdate` | Same as above but PUT |
| `PATCH /management/1/vendors/vendorInsuranceUpdateByteArray` | Same but file as ByteArray. FilePath + FileSize fields determined programmatically. 10 MB max (pre-conversion) |
| `PUT /management/1/vendors/vendorInsuranceUpdateByteArray` | Same as above but PUT |
| `DELETE /management/1/vendors/vendorInsuranceAttachments` | Delete a collection of vendor insurance attachments |
| `GET /management/1/vendors/vendorInsuranceTypes` | List of vendor insurance types |

### Licenses

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/vendors/vendorLicenses` | List of vendor licenses |
| `POST /management/1/vendors/vendorLicense` | Create a vendor license |
| `PATCH /management/1/vendors/vendorLicense` | Update vendor license info |

### Coverage + status

| Method + path | Purpose |
|---------------|---------|
| `PUT /management/1/vendors/vendorStates` | Replace vendor states serviced with provided list |
| `PUT /management/1/vendors/vendorCities` | Replace vendor cities serviced. **Cities must match CINC's dropdown list** or an error is thrown |
| `GET /management/1/vendors/vendorStatus` | List of vendor statuses |
| `GET /management/1/vendors/vendorType` | List of vendor types |
| `GET /management/1/vendors/vendorAssociation` | Active vendors associated with a specific association |

---

## Violations

| Method + path | Purpose |
|---------------|---------|
| `GET /management/1/violations/homeownerViolations` | Violations reported against a homeowner |
| `GET /management/1/violations/violationTypes` | List of violation types |

---

## WorkOrders

### Full endpoint list

| Method + path | Purpose | Wrapper in `lib/integrations/cinc.ts` |
|---------------|---------|----------------------------------------|
| `GET /management/1/workOrderStatuses` | List of WO statuses (reference data) | (no wrapper yet) |
| `GET /management/1/workOrderTypes` | List of WO types (reference data) | `listWorkOrderTypes()`, `getDefaultWorkOrderTypeId()`, `getOpenWorkOrderStatusId()` |
| `GET /management/1/workOrders?workOrderId={id}` | Fetch one WO with notes + contacts + vendor (no attachments inline) | `getWorkOrderById()` |
| `GET /management/1/workOrders?createdFromDate={iso}` | List WOs created since a cursor | `listWorkOrdersCreatedSince()` |
| `GET /management/1/workOrderAttachments?workOrderId={id}` | List photos/files on a WO. Returns `FileContent` as **base64 inline** — no separate download URL | `listWorkOrderAttachments()` |
| `POST /management/1/workOrderNotes` | Add one or more notes to a WO (text only — no attachments via this endpoint) | `addWorkOrderNote()` |
| `POST /management/1/workOrderContacts` | Add one or more contacts to a WO | (no wrapper yet) |
| `POST /management/1/workOrderAttachment` | **Add an attachment to a WO. File as ByteArray, 25 MB max.** Singular `Attachment` — not plural | (no wrapper yet) |
| `POST /management/1/linkedWorkOrder` | Create a WO linked to a homeowner or common area | `createLinkedWorkOrder()` |
| `POST /management/1/unlinkedWorkOrder` | Create a WO for an unlinked work location (no homeowner/common-area link) | (no wrapper yet) |
| `PATCH /management/1/workOrderStatus` | Update WO status | `updateWorkOrderStatus()` |
| `PATCH /management/1/workOrderStatusReopen` | Reopen a closed/completed WO | (no wrapper yet) |
| `PATCH /management/1/workOrderDetails` | Update type, description, dates, work location. **Use the dedicated PATCH endpoints for status or vendor, not this one** | `updateWorkOrderDetails()` |

### Bidirectional photo sync opportunity (tasks 2 + 3)

`POST /workOrderAttachment` (note: singular — not the plural `workOrderAttachments` that lists) means MAIA can push photos *into* CINC, not just mirror them out. Implications:

- **Task 2 (email attachments → WO)**: when a vendor emails MAIA a photo and tags it to a WO, we could simultaneously (a) store it in our `work-order-photos` bucket and (b) push it to CINC so anyone using CINC's native UI sees it too.
- **Task 3 (staff direct upload)**: same idea. Staff uploads in the admin → optionally pushes to CINC.

Trade-off: doubles the storage (CINC + Supabase) and the WO will have the same photo twice if a vendor uploads in CINC AND emails MAIA. Dedupe is hard because CINC re-generates the filename on upload (we get back `file<hash>.png`). Possible mitigations: skip the push-to-CINC on `source='cinc'` (already from there), or add a "push to CINC" toggle in the upload UI.

### Response shapes

**`GET /workOrders` (single)** — top-level fields we've observed:

```
WorkOrderId, AssocId, AssocCode, AssociationName, HoID, PropertyId,
IsCommonArea, IsUnlinked, EnteredDate, CreatedDate, CreatedBy,
IssuedDate, DueDate, FollowUpDate, Description, EstimateTotal,
WorkOrderStatusId, WorkOrderStatus, WorkOrderTypId, WorkOrderType,
Contacts[], VendorId, Vendor, VendorContacts[], WorkLocationName,
AddressLine1, AddressLine2, City, State, Zip, Notes[]
```

Note `WorkOrderTypId` (sic) is CINC's spelling — not a typo on our end.

**`GET /workOrderAttachments`** — array of:

```json
{
  "FileName":    "file1a42d81c.png",
  "CreatedDate": "2026-05-17T16:01:58.12",
  "FileSize":    1318091,
  "FileContent": "<base64-encoded binary>"
}
```

Notable: no `AttachmentId`, no MIME type, no `IsImage` flag, no
distinct download URL. Dedupe on `(FileName, CreatedDate, FileSize)`.
Filter to images by file extension.

---

## Conventions

- Endpoint paths are namespaced under `/management/{version}/...`.
  Version `1` is the default; some collections expose a `2` variant
  (e.g. `/management/2/homeowners/associationWithProperty`) with a
  richer payload — try both when probing.
- Query params use camelCase (`assocCode`, `workOrderId`).
- Many endpoints accept either `assocCode` (string) or `assocId`
  (numeric) — try the string form first; fall back to the numeric form
  if you get a 400.
- `4xx` responses typically mean "no results" rather than an error.
  Existing wrappers swallow 4xx and return `[]` or `null`. 5xx is
  re-thrown.

---

## Probing new endpoints safely

Use `scripts/probe-cinc-work-orders.ts` as a template. It:

1. Loads creds from `.env.local`.
2. Hits N candidate endpoint shapes in parallel.
3. Redacts PII (names, emails, phones, addresses) before printing.
4. Prints a short summary table + full JSON dump.

To adapt for a new category: copy the script, change the candidate
endpoint list, and run with the relevant ID argument. All probes are
GETs only — never mutate during discovery.

---

## Contacts and Consent migration (announced 2025-12-19)

CINC is rolling out a "Contacts and Consent" feature that moves
homeowner contact info (Names, Email, Phone, BillingTypeID,
OwnerAddress flag, mailing-address selection) **out of the per-address
record** and into a separate **Contacts** module on the
Homeowner / Homeowner Information screen.

> **PERSONAS NOTE (Fabio, 2026-05-29):** CINC's `propertyContactTypes`
> introduces a subset of contact types — fewer than MAIA's persona
> model. MAIA tracks owner / tenant / board / agent / vendor; CINC's
> v2 module focuses on property-level contacts (owner-marked or not)
> with mailing-address selection. When CINC ships the v2 module we
> may want to bridge MAIA personas → CINC contact types where they
> overlap, but the two models aren't 1:1.

### Tenant status

Probed 2026-05-29 against PMITFP: `GET /management/1/homeowners/contactsFlag` →
`{ IsContactsFlagOn: false }`. So **MAIA is safe to keep using the v1
endpoints today**. The flag will flip when CINC turns the feature on
for our tenant — we poll it server-side from the CINC sync page and
log a console warning from `listAssociationProperties`.

Detection helper: `getContactsAndConsentFlag()` in `lib/integrations/cinc.ts`.
Admin polling endpoint: `GET /api/admin/cinc/contacts-flag`.

### MAIA blast radius (today)

**Only one call site is affected:** `listAssociationProperties()` in
`lib/integrations/cinc.ts:635`, which calls
`GET /management/1/homeowners/associationWithProperty`.

When the flag flips, this endpoint will return:
> `400 — "This endpoint is not available for customers who have
> turned OFF the Contacts & Consent feature in CINC. Use the GET
> /management/1/homeowners/associationWithProperty endpoint instead."`

…wait, actually it's the OPPOSITE direction: today the v2 endpoint
returns that 400 because the feature is OFF. Once CINC turns the
feature ON, the v1 endpoint we're calling will start returning the
mirror error pointing us at v2. **That's the failure mode to watch
for.** The advance warning banner on the CINC sync page surfaces the
flag flip BEFORE the sync starts failing.

### New v1 endpoints (brand new — version "1")

| Endpoint | Description |
|---|---|
| `GET /management/1/homeowners/contactsFlag` | Returns `{IsContactsFlagOn:boolean}` for the tenant. **Used by MAIA today** for detection. |
| `GET /management/1/homeowners/propertyContacts` | Returns the contacts on a homeowner's Contacts tab. **Will be needed** to populate name/email/phone when migrating `listAssociationProperties`. |
| `GET /management/1/homeowners/propertyContactTypes` | Lists every contact-type CINC's tenant supports (Owner, etc. — exact list TBD). |
| `PATCH /management/1/homeowners/propertyContact` | Updates a contact (name / email / phone / address selection). Replaces the obsolete `updateEmailPhone`. |
| `PUT /management/1/homeowners/propertyContactMailingAddressSelection` | Assigns / unassigns a mailing address to a contact. |

### v1 → v2 endpoint migration table

For each of these, **v1 stops working once the feature is enabled**;
the v2 endpoint must be used in its place AND a parallel call to
`propertyContacts` to get name/email/phone (which are no longer in the
address array).

| Original (v1) | New (v2) | Key changes |
|---|---|---|
| `GET /management/1/homeowners/propertyInformation` | `GET /management/2/homeowners/propertyInformation` | Names / Email / Phone / BillingTypeID / OwnerAddress no longer in address array. |
| `GET /management/1/associations/homeownerinfo` | `GET /management/2/homeowners/homeownerInfo` | URL path changes (`associations` → `homeowners`); response now 2 arrays not 3; paginated; "Owner" flag lives on Contacts. |
| `GET /management/1/homeowners/homeownerlookup` | `GET /management/2/homeowners/homeownerLookup` | Adds `isOwner` filter; response paginated. |
| `GET /management/1/homeowners/mailingAddress` | `GET /management/2/homeowners/mailingAddress` | Name/Email/Phone removed — must call `propertyContacts` separately. |
| `GET /management/1/homeowners/associationWithProperty` | `GET /management/2/homeowners/associationWithProperty` | **(MAIA uses this.)** Response 2 arrays not 3; Names/Email/Phone moved to Contacts. |
| `GET /management/1/homeowners/allByProperty` | `GET /management/2/homeowners/allByProperty` | Names/Email/Phone moved to Contacts. |

### Obsolete (cannot be used once feature is on)

- `PUT /management/1/homeowners/updateEmailPhone` — replaced by
  `PATCH /management/1/homeowners/propertyContact`.
  **MAIA doesn't call this**, so no action needed.

### Migration action list (when CINC flips the flag)

1. ☐ Add `CincPropertyContact` and `CincPropertyContactType` types from
   the live v2 Swagger (the doc dated 12/19/2025 says "Refer to Swagger
   documentation for the latest" — v2 shapes aren't in the static
   doc).
2. ☐ Implement `listPropertyContacts(propertyId)` calling
   `GET /management/1/homeowners/propertyContacts`.
3. ☐ Implement `listAssociationPropertiesV2(assocCode)` calling
   `GET /management/2/homeowners/associationWithProperty`, then
   joining with `listPropertyContacts()` per property to reconstruct
   the old shape (`CincPropertyAddress` with name/email/phone).
4. ☐ Route `listAssociationProperties()` to v1 or v2 based on
   `getContactsAndConsentFlag()`.
5. ☐ Remove the warning banner on the CINC sync page once the v2 path
   is shipping.
6. ☐ Decide whether to expose CINC's `propertyContactTypes` in MAIA
   admin UI so the persona model can be reconciled with CINC's
   contact-type vocabulary.

### Useful Swagger references (once feature is enabled)

The static doc gives the endpoint paths but not the response shapes
for the v2 endpoints. To get shapes:

```bash
curl https://integration.cincsys.io/api/swagger/docs/1.40.0 \
  | jq '.definitions | keys[] | select(test("PropertyContact|HomeownerV2"; "i"))'
```

…and check `definitions["<name>"].properties` for fields.

---

## Open questions / TODO

- (Add as we discover them.)
