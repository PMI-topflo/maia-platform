# MAIA — Development Backlog

What's left to build. **MAIA is STAFF-ONLY today**; customer-facing items are deferred until a customer rollout. Cross-check against `docs/ROADMAP.md` + `docs/SESSION-HANDOFF.md` and the Claude memory files (`implementation_roadmap_2026_06.md`, `session_2026_06_18_personas_portals_docs.md`).

_Last updated: 2026-06-19 (after PRs #399–#406)._

---

## 0) Operational / manual (do first — no code, or quick)
- **Apply migration** `supabase/migrations/20260618_association_vendor_links.sql` by hand in the Supabase SQL editor. The vendor "Link to association" buttons (Personas + Hub Vendors tabs) no-op until this table exists. **Verify it's applied.**
- **Upload each association's documents INTO MAIA**: Admin → Associations → (association) → Documents. Google Drive was removed (#405), so every portal's Documents section is **empty until staff upload**. Categories: Condo Docs, Rules & Regulations, Application Forms, ACH Authorization, ARC, Financials, Budget, Insurance, Maintenance, Leases & Resale, Welcome Letters, FAQ.
- **Galleria Village (GVH)**: its old per-category Drive docs were **not** auto-migrated — re-upload into MAIA.
- Delete CINC test vendor **2121** ("ZZ DELETE…") in the CINC UI.
- Optional env `CINC_DEFAULT_LICENSE_TYPE` for onboarding license push.
- Set `OWNER_AUDIT_ENABLED=1` only when ready for owner-facing doc-request reminders (likely defer — staff-only today).

## 1) Phase 1 — Work Order workflow with Paola  ⬅ TOP PRIORITY
**Shipped:** per-WO "+ Add invoice", ACH/W-9 compliance gate (cc Paola = service@), board-approval popup, payment lifecycle (ready_for_payment→paid + auto-close), full vendor onboarding (createVendor + dedupe + portal + ACH-confirm), New Work Order creation form (#396), vendor search-before-create (#397), MAIA-local vendor↔association linking (#403/#406).

**Build next:**
1. **Estimate-comparison board report WITH IMAGES** — side-by-side vendors (amount / scope / photos) for a WO, for board approval. ⬅ **START HERE.**
2. **Service Issues PR2/3 UI** — complaint → routed to the vendor's next recurring-service visit → vendor resolution, with before/after photos. Backend table `service_issues` exists.
3. **Recurring-services control panel** — weekly vendor 🟢/🟠/🔴 status, "visits missing photos" report, monthly invoice rollup → ONE CINC work order (Phase 3c; verify CINC WO-create now that `CINC_SYNC_ENABLED=true`).
4. Verify the #394 **ACH-confirm** step end-to-end once a real vendor onboards.

## 2) Phase 2 — Application package (staff side)  ⬅ TOP PRIORITY
**Built:** `/apply` form (6 languages), Stripe application fee, `/admin/applications` review + board approve/reject, doc acknowledgment, e-signature, Applycheck screening **invite** on payment, "Application Forms" doc category as a temporary home (#405).

**Build next:**
1. **Applycheck RESULTS webhook** — `app/api/applycheck-webhook` is **MISSING**. Screening is invited but results never come back. Receive + store `applycheck_report_url` / status, mark the application complete. **The one functional gap in the pipeline.**
2. **Board-visible screening status + "view report" link** in `/admin/applications`; co-applicant re-invite flow.
3. **Application package assembly ("Jonathan compliance pkg")** — compile applicant docs + screening result + board decision into one downloadable/sendable package.
4. **Per-association application RULES** — staff-side config (rules per association); small migration. Applicant-facing display deferred to customer rollout.
5. Build the real **in-Maia application** so the temporary "Application Forms" upload category can retire.

## 3) Phase 5 — Compliance Phase 2 + smaller follow-ups
- **Vendor COI validation**: additional-insured + expiry checks; fuzzy-match insured name/address vs PMI + the association's property address → flag / block / auto-correction email to the vendor.
- **COI / license push UI** to CINC; a vendor-compliance **audit panel + page**.
- **Unit-level document uploads** (owner/tenant unit docs).
- **Reserve-study + D&O renewal tracking.**
- **Document Q&A (RAG)** over `association_documents` (also the foundation for voice later).
- **Gmail "forward invoice to maia@"** intake path.
- **True vendor name for CINC-native invoices** in reconciliation (currently shows the bank-account label).

## 4) Deferred — customer-facing (do NOT start until customer rollout)
- **Voice agent (Vapi)** — full decided design in `voice_plan.md` (Vapi + Twilio + bring-your-own-Claude stateless `/chat/completions` + Deepgram STT + Cartesia/ElevenLabs TTS + pgvector retrieval). Skip Alexa/Siri/OAuth device-linking. Early-startable piece that **also helps staff**: the pgvector knowledge base + association/persona-filtered retrieval.
- **Owner / resident self-service** — owner ledger/balance + payment links (CINC WebAxis / check / ACH; Stripe is application-fee ONLY), tenant self-service. See `owner_self_service_decisions.md`.

## 5) Tech debt / cleanups (from recent sessions)
- **Per-persona portal content**: the resident portal body is currently identical for owner/board/onsite-manager — the "View portal as" preview only changes the framing. If you want board-only content (e.g. financials) or onsite-manager-specific views, build per-persona content blocks.
- Pre-existing lint: `AssociationPortalGate.tsx` has 2 `<a href="/">` "Visit main site" warnings (use `next/link`) — cosmetic.
- CINC vendor↔association linkage is **READ-ONLY** in the API (Swagger v1.40.0) — the MAIA-local `association_vendor_links` table is the permanent workaround; CINC web UI deep link = `https://pmitfp.cincsys.com`.

---

**Standing reminders:** times always in Eastern Time · migrations applied by hand in Supabase (idempotent, literal SQL, register in `lib/migration-status.ts`) · push ALL commits before merging a PR (squash-merge strands later commits) · no association list on www.pmitop.com.
