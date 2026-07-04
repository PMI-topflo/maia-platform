-- Owner occupancy/insurance self-report survey: two new columns.
-- declared_type on compliance_records = the owner/tenant's self-reported
-- insurance policy type (independent of document review status).
-- commercial_use_type on unit_occupancy = business/usage type, commercial
-- association units only. Idempotent.

ALTER TABLE public.compliance_records ADD COLUMN IF NOT EXISTS declared_type text;
ALTER TABLE public.unit_occupancy ADD COLUMN IF NOT EXISTS commercial_use_type text;

NOTIFY pgrst, 'reload schema';
