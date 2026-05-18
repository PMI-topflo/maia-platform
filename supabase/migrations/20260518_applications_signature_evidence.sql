-- =====================================================================
-- applications — signature evidence columns
--
-- Stores everything we capture at the moment the applicant signs the
-- rules acknowledgment: the drawn signature image, a webcam photo of
-- the applicant (if they granted camera permission), the client IP
-- the server saw, and the browser-reported geolocation.
--
-- All columns are nullable so applications submitted before this
-- feature shipped (or applicants who decline camera / geo permission)
-- still flow through cleanly. The existing rules_signature (typed
-- name) and rules_agreed_at (timestamp) stay as-is.
-- =====================================================================

ALTER TABLE public.applications
  -- Drawn signature image. base64-encoded PNG data URL written
  -- directly by the client. Sized small (<50 KB) so storing inline
  -- is fine; no need for a separate storage object.
  ADD COLUMN IF NOT EXISTS rules_signature_image    text,

  -- Webcam photo taken at sign time. Same base64-PNG inline storage,
  -- typically ~50-200 KB. NULL when the applicant declined camera
  -- permission or their device has no camera.
  ADD COLUMN IF NOT EXISTS rules_applicant_photo    text,

  -- IP address the request came from. Captured server-side from
  -- the x-forwarded-for / x-real-ip headers Vercel sets. Useful for
  -- fraud review.
  ADD COLUMN IF NOT EXISTS rules_signed_ip          text,

  -- User-agent + browser metadata. Pure text blob — keeps record
  -- without a complex schema for properties we may not need later.
  ADD COLUMN IF NOT EXISTS rules_signed_user_agent  text,

  -- Browser geolocation (navigator.geolocation). JSONB so we keep
  -- accuracy + lat/lon together. Shape: { lat, lon, accuracy_meters,
  -- timestamp_ms }. NULL when the applicant declined.
  ADD COLUMN IF NOT EXISTS rules_signed_geolocation jsonb;

COMMENT ON COLUMN public.applications.rules_signature_image    IS 'Drawn signature as a base64 PNG data URL.';
COMMENT ON COLUMN public.applications.rules_applicant_photo    IS 'Webcam capture of the applicant at sign time, base64 PNG data URL.';
COMMENT ON COLUMN public.applications.rules_signed_ip          IS 'Client IP at signature time, from x-forwarded-for / x-real-ip.';
COMMENT ON COLUMN public.applications.rules_signed_user_agent  IS 'Raw User-Agent header at signature time.';
COMMENT ON COLUMN public.applications.rules_signed_geolocation IS 'navigator.geolocation snapshot: { lat, lon, accuracy_meters, timestamp_ms }.';
