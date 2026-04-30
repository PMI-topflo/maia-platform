-- Fix 1: Security Definer View
-- Recreate owner_verification_directory with security_invoker so RLS on
-- homeowner_directory_raw is enforced when queried by non-service roles.
DROP VIEW IF EXISTS public.owner_verification_directory;
CREATE VIEW public.owner_verification_directory
WITH (security_invoker = true) AS
SELECT
    id,
    association_code,
    association_name,
    account_number,
    first_name,
    last_name,
    TRIM(BOTH FROM (COALESCE(first_name, ''::text) || ' '::text) || COALESCE(last_name, ''::text)) AS owner_full_name,
    unit_number,
    city,
    state,
    zip_code,
    COALESCE(NULLIF(phone, ''::text), NULLIF(phone_2, ''::text), NULLIF(phone_3, ''::text)) AS primary_phone,
    phone,
    phone_2,
    phone_3,
    emails,
    TRIM(BOTH FROM (COALESCE(street_number, ''::text) || ' '::text) || COALESCE(address, ''::text)) AS property_address
FROM homeowner_directory_raw;

-- Fix 2: applications — overly permissive "always true" policies
-- Removes anon SELECT (any unauthenticated user could read all application data).
-- Tightens INSERT to stripe_payment_status = 'pending' (form always sets this,
-- but the expression is no longer trivially true).
DROP POLICY IF EXISTS "allow_select" ON public.applications;
DROP POLICY IF EXISTS "allow_insert" ON public.applications;

CREATE POLICY "allow_insert" ON public.applications
    FOR INSERT TO anon, authenticated
    WITH CHECK (stripe_payment_status = 'pending');

CREATE POLICY "service_role_applications" ON public.applications
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Fix 3: storage.objects — application-docs bucket
-- Make bucket private: ID scans and income documents must not be publicly accessible.
-- Restrict file listing to service_role; anon INSERT kept for form uploads.
UPDATE storage.buckets SET public = false WHERE name = 'application-docs';

DROP POLICY IF EXISTS "read_docs" ON storage.objects;

CREATE POLICY "service_role_read_docs" ON storage.objects
    FOR SELECT TO service_role
    USING (bucket_id = 'application-docs');

-- Fix 4: homeowner_directory_raw — RLS enabled with no policies
-- Table was completely inaccessible (even to service_role via policy, though
-- service_role bypasses RLS anyway). Explicit policy added for consistency.
CREATE POLICY "service_role_homeowner_directory_raw" ON public.homeowner_directory_raw
    FOR ALL TO service_role USING (true) WITH CHECK (true);
