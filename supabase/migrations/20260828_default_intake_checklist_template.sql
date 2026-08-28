-- =====================================================================
-- 20260828_default_intake_checklist_template.sql
--
-- User direction, 2026-08-28: "Create to all default template like
-- MANXI's existing ~20-row checklist minus the MANXI-specific stuff
-- (Affidavit, Lauderhill Certificate and Manors Club forms,
-- master-association items) ... we will have them all created in the
-- other associations as default so it will be easy to setup new
-- associations." Also carries the standing policy from earlier the same
-- day: every non-master association requires the Rules Knowledge
-- Acknowledgment + basic contact info; everything else defaults to
-- Optional and staff toggle it on per association via the existing
-- IntakeChecklistBox UI (app/admin/cinc-sync/[code]/IntakeChecklistBox.tsx).
--
-- Source: MANXI's real checklist, with these excluded (not copied):
--   - tenant_affidavit, occupant_affidavit  (the "Affidavit" exclusion —
--     MANXI's own notarization requirement, not assumed elsewhere)
--   - certificate_of_use                    (City of Lauderhill-specific)
--   - board_decision_page, landlord_email, homeowner_insurance
--     (MANXI-only legacy/workaround items, not generic)
--   - intl_police_clearance, intl_cpa_certification, intl_translation
--     (MANXI/international-applicant specific, not generic)
--   - pet_registration, assistance_animal_documentation, property_insurance
--     (already seeded association-wide by 20260815/20260816 — not re-touched)
--
-- SCOPE — associations NOT included, and why:
--   - MANXI            the source of the template, already has its own
--   - VPCI              already has its own real ~11-doc_key checklist
--                        from the earlier Venetian Park I onboarding —
--                        layering a generic template on top would collide
--   - LCLUB, VPREC       master_hoa — the user's own "besides the master"
--                        carve-out; no units, so no lease/purchase intake
--   - ESSI,KANE,MACO,WBP,WBPA   commercial_condo — this is a residential
--                        checklist (driver's license, background check,
--                        individual-buyer tax returns); the earlier
--                        property_insurance seed (20260816) already drew
--                        this exact same line, pending a commercial form
--
-- CAVEAT — flagged, not silently glossed over: this seeds the CHECKLIST
-- ROW for governing_docs_ack (Rules Knowledge Acknowledgment) and
-- maintenance_assessment_ack as required, but the actual e-signed CONTENT
-- those items send (the per-association rules text / assessment terms —
-- see lib/manxi-rules-ack.ts, lib/vpci-rules-ack.ts as the existing
-- pattern) does not exist yet for these 16 associations. The checklist
-- will show the item as required; nothing will actually be sendable to
-- fulfill it until that content is authored per association — a separate,
-- real follow-up task, not something to fabricate here.
--
-- Idempotent.
-- =====================================================================

INSERT INTO public.association_intake_documents
  (association_code, application_type, doc_key, label, provided_by, required, note, sort_order, condition_key, per_applicant, created_by)
SELECT a.association_code, t.application_type, t.doc_key, t.label, t.provided_by, t.required, t.note, t.sort_order, t.condition_key, t.per_applicant, 'maia_seed_20260828_template'
  FROM public.associations a
 CROSS JOIN (VALUES
   -- lease
   ('lease', 'signed_lease', 'Signed Lease Agreement', 'applicant', false, NULL, 10, NULL, false),
   ('lease', 'drivers_license', 'Driver''s License / Photo ID', 'applicant', false, NULL, 20, NULL, false),
   ('lease', 'military_service_disclosure', 'Military Service Member Disclosure (e-signed)', 'applicant', false, 'One yes/no disclosure question, per Florida Statute 83.682 / the federal Servicemembers Civil Relief Act.', 23, NULL, false),
   ('lease', 'car_registration', 'Vehicle Registration', 'applicant', false, NULL, 30, 'vehicle', true),
   ('lease', 'vehicle_insurance', 'Vehicle Insurance', 'applicant', false, NULL, 40, 'vehicle', true),
   ('lease', 'tax_returns_2yr', 'Last 2 Years'' Tax Returns', 'applicant', false, 'Tax return, not a W-2', 60, NULL, true),
   ('lease', 'landlord_tenant_agreement', 'Landlord–Tenant Agreement (e-signed)', 'landlord', false, 'The Agreement e-signed online by owner + tenant', 110, NULL, false),
   ('lease', 'governing_docs_ack', 'Rules Knowledge Acknowledgment (e-signed)', 'applicant', true, 'Signed by every adult who will occupy the unit.', 95, NULL, false),
   -- lease_renewal
   ('lease_renewal', 'signed_lease', 'Full Executed Lease', 'applicant', false, NULL, 10, NULL, false),
   ('lease_renewal', 'drivers_license', 'Updated Driver''s License (if expired)', 'applicant', false, NULL, 55, NULL, false),
   ('lease_renewal', 'military_service_disclosure', 'Military Service Member Disclosure (e-signed)', 'applicant', false, 'One yes/no disclosure question, per Florida Statute 83.682 / the federal Servicemembers Civil Relief Act.', 23, NULL, false),
   ('lease_renewal', 'car_registration', 'Vehicle Registration', 'applicant', false, NULL, 50, 'vehicle', true),
   ('lease_renewal', 'vehicle_insurance', 'Vehicle Insurance', 'applicant', false, NULL, 52, 'vehicle', true),
   ('lease_renewal', 'emergency_contact', 'Updated Emergency Contact List', 'applicant', false, NULL, 40, NULL, false),
   ('lease_renewal', 'background_credit', 'Background / Credit Reports', 'staff', false, NULL, 35, NULL, true),
   ('lease_renewal', 'governing_docs_ack', 'Rules Knowledge Acknowledgment (e-signed)', 'applicant', true, 'Signed by every adult who will occupy the unit.', 95, NULL, false),
   -- purchase
   ('purchase', 'signed_purchase', 'Signed Purchase Agreement', 'applicant', false, NULL, 10, NULL, false),
   ('purchase', 'drivers_license', 'Driver''s License / Photo ID', 'applicant', false, NULL, 20, NULL, false),
   ('purchase', 'ho6_quote', 'HO-6 Policy Quote (issued policy due after closing)', 'applicant', false, NULL, 20, NULL, false),
   ('purchase', 'escrow_deposit_letter', 'Escrow Deposit Letter (10% deposit held in escrow)', 'applicant', false, NULL, 21, NULL, false),
   ('purchase', 'condo_rider', 'Florida Board of Realtors Condominium Rider', 'agent', false, NULL, 22, NULL, false),
   ('purchase', 'military_service_disclosure', 'Military Service Member Disclosure (e-signed)', 'applicant', false, 'One yes/no disclosure question, per Florida Statute 83.682 / the federal Servicemembers Civil Relief Act.', 23, NULL, false),
   ('purchase', 'car_registration', 'Vehicle Registration', 'applicant', false, NULL, 30, 'vehicle', true),
   ('purchase', 'vehicle_insurance', 'Vehicle Insurance', 'applicant', false, NULL, 35, 'vehicle', true),
   ('purchase', 'tax_returns_2yr', 'Last 2 Years'' Tax Returns', 'applicant', false, 'Tax return, not a W-2', 40, NULL, true),
   ('purchase', 'governing_docs_ack', 'Rules Knowledge Acknowledgment (e-signed)', 'applicant', true, 'Signed by every adult who will occupy the unit.', 95, NULL, false),
   ('purchase', 'maintenance_assessment_ack', 'Maintenance Assessment Acknowledgment (e-signed)', 'applicant', false, 'Acknowledges the quarterly assessment and due dates before closing.', 96, NULL, false),
   -- additional_occupant
   ('additional_occupant', 'drivers_license', 'Driver''s License / Photo ID (each occupant 18+)', 'applicant', false, 'Under 18: name + age only, no documents', 10, NULL, true),
   ('additional_occupant', 'car_registration', 'Vehicle Registration', 'applicant', false, NULL, 20, 'vehicle', true),
   ('additional_occupant', 'vehicle_insurance', 'Vehicle Insurance', 'applicant', false, NULL, 30, 'vehicle', true),
   ('additional_occupant', 'background_credit', 'Background / Credit Reports', 'staff', false, NULL, 35, NULL, true),
   ('additional_occupant', 'military_service_disclosure', 'Military Service Member Disclosure (e-signed)', 'applicant', false, 'One yes/no disclosure question, per Florida Statute 83.682 / the federal Servicemembers Civil Relief Act.', 23, NULL, false),
   ('additional_occupant', 'background_check_consent', 'Background-Check Consent', 'applicant', false, NULL, 50, NULL, false),
   ('additional_occupant', 'lease_addendum', 'Lease Addendum (adds the occupant to the lease)', 'landlord', false, NULL, 60, NULL, false),
   ('additional_occupant', 'governing_docs_ack', 'Rules Knowledge Acknowledgment (e-signed)', 'applicant', true, 'Signed by every adult who will occupy the unit.', 95, NULL, false)
 ) AS t(application_type, doc_key, label, provided_by, required, note, sort_order, condition_key, per_applicant)
 WHERE a.association_code NOT IN ('MANXI', 'VPCI', 'LCLUB', 'VPREC', 'ESSI', 'KANE', 'MACO', 'WBP', 'WBPA')
ON CONFLICT (association_code, application_type, doc_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
