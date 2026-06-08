# Spec — Association Hub (RentVine-style unified per-association view)

_Status: 🎨 mockup for review. Drafted 2026-06-07. Clickable mockup at
`/admin/associations/mockup` (sample data, no wiring)._

## Goal
RentVine gives one screen per property — header + **Actions** menu + tabbed
sections — so staff manage everything from one place. MAIA already has the
per-association data, scattered across pages. This unifies it into one hub by
**evolving `/admin/cinc-sync/[code]`** (decided 2026-06-07) into a property-style
view. The net-new build is vendor + board **communication & management**.

## Layout
- **Header**: breadcrumb · association name (with switcher) · `Run Monthly Report` · **Actions ▾** dropdown.
- **Actions menu**: New Work Order · Add Invoice/Bill · Message Board Members · Email a Vendor · Add Owner · Upload Document · Record Insurance/COI · Run Monthly Report · Reconcile Month · Sync from CINC · Edit Association.
- **Left identity rail** (always visible): financial snapshot (operating/reserve, open invoices, upcoming payments, open WOs, vendors, expiring COIs) + board officers.
- **Tabs**: Overview · Board & Owners · Vendors · Work Orders · Financials · Documents & Compliance · Communications · Reports.

## Tab → data source (most already built)
| Tab | Source | Status |
|---|---|---|
| Overview | aggregate of below (alerts, recent activity) | assemble |
| Board & Owners | CINC board members + `/admin/board-setup`; CINC homeowners + `/admin/owners` | ✅ exists |
| Vendors | CINC vendor compliance (COI/W-9/ACH/license) + request-for-estimate | 🟡 compliance read exists; estimate flow new |
| Work Orders | `tickets` (type=work_order) filtered to assoc | ✅ exists |
| Financials | CINC bank balances + invoice intake + reconciliation + forecast/budget | ✅ exists |
| Documents & Compliance | `/cinc-sync/[code]/documents` · `/insurance` · `/safety` | ✅ exists |
| Communications | vendor + board threads (email capture via maia@ + Gmail add-on) | 🔴 **net-new** |
| Reports | `/admin/reports/monthly?assoc=` | ✅ exists |

## Build phases (after mockup sign-off)
1. **Hub shell** — header + Actions + tabs on `/admin/cinc-sync/[code]`, wiring the ✅-exists tabs (Overview, Board & Owners, Work Orders, Financials, Documents, Reports).
2. **Vendors tab** — compliance RAG + per-vendor actions (request estimate, email from WO).
3. **Communications module** — the net-new piece; design informed by RentVine screenshots (thread list, composer, board/vendor contacts, email capture).

## Open inputs
- RentVine screenshots of vendor contact/management + board/tenant comms threads → shape the Communications module + Vendors actions.
- Confirm tab order / which land on Overview.
