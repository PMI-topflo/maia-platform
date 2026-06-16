-- Work-order vendor-compliance gate. Before an invoice can be added to a work
-- order, the vendor must have ACH + W-9 on file in CINC. When Paola requests
-- the missing docs, the WO is flagged for follow-up; the flag clears when the
-- docs land. Idempotent.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS vendor_docs_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS vendor_docs_needed       text;   -- e.g. 'ach', 'w9', 'ach,w9'

NOTIFY pgrst, 'reload schema';
