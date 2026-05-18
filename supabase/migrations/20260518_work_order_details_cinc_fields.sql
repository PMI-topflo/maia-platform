-- =====================================================================
-- work_order_details — add CINC-sourced columns
--
-- The CINC inbound sync was inserting `tickets` rows but never creating
-- the matching `work_order_details` row, so the "Work order" card on
-- /admin/tickets/[id] was empty for every CINC-sourced WO. This adds
-- the columns we need to mirror the CINC payload faithfully:
--
--   - cinc_ho_id          → HoID    (billing account number; what staff cross-reference in CINC)
--   - cinc_property_id    → PropertyId (CINC's internal unit/property id)
--   - work_location_name  → WorkLocationName (homeowner name at the work location)
--   - address_line1/2     → AddressLine1/2 of the work location
--   - city / state / zip  → property address parts
--
-- Existing columns reused by the sync:
--   - vendor_name   ← CINC.Vendor
--   - scheduled_at  ← CINC.IssuedDate
--   - cost_cents    ← CINC.EstimateTotal × 100
--
-- The pre-existing `unit_id` TEXT column is left alone for Rentvine-
-- sourced WOs (a different id space).
-- =====================================================================

ALTER TABLE public.work_order_details
  ADD COLUMN IF NOT EXISTS cinc_ho_id          text,
  ADD COLUMN IF NOT EXISTS cinc_property_id    integer,
  ADD COLUMN IF NOT EXISTS work_location_name  text,
  ADD COLUMN IF NOT EXISTS address_line1       text,
  ADD COLUMN IF NOT EXISTS address_line2       text,
  ADD COLUMN IF NOT EXISTS city                text,
  ADD COLUMN IF NOT EXISTS state               text,
  ADD COLUMN IF NOT EXISTS zip                 text;

COMMENT ON COLUMN public.work_order_details.cinc_ho_id IS
  'CINC HoID — the homeowner billing account number. What staff would grep for in CINC when cross-referencing a complaint.';
COMMENT ON COLUMN public.work_order_details.cinc_property_id IS
  'CINC PropertyId — the internal unit/property id. Distinct from HoID, which is the current owner.';
COMMENT ON COLUMN public.work_order_details.work_location_name IS
  'CINC WorkLocationName — the human-readable name at the work location (typically the homeowner full name).';
