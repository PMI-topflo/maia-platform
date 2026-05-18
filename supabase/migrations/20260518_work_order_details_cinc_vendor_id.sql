-- =====================================================================
-- work_order_details — store CINC VendorId so outbound vendor
-- reassignment can pass it to PATCH /workOrderDetails
--
-- vendor_name is a display string; CINC needs an integer VendorId on
-- writes. Populated by the inbound sync from CINC.VendorId; written
-- by the vendor picker modal when staff reassigns.
-- =====================================================================

ALTER TABLE public.work_order_details
  ADD COLUMN IF NOT EXISTS cinc_vendor_id integer;

COMMENT ON COLUMN public.work_order_details.cinc_vendor_id IS
  'CINC VendorId — the integer ID required by PATCH /workOrderDetails when reassigning a vendor. Populated by cinc-inbound on mirror; written by the in-MAIA vendor picker.';
