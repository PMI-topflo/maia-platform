-- =====================================================================
-- 20260626_maia_flow_tables.sql
--
-- Three more resident-flow tables that were missing from the live DB
-- (PGRST205) — same family as conversation_state / sticker_requests. The
-- webhook wrote to them but they didn't exist, so these flows silently
-- dropped everything:
--   • maintenance_requests   — maintenance flow (menu option 2)
--   • conversation_feedback  — thumbs/stars feedback capture
--   • agent_requests         — real-estate agent identification flow
--
-- Schemas are derived exactly from app/api/webhook/route.ts column usage.
-- Reached only via the service-role admin client → service_role grant +
-- RLS with a service_role policy (mirrors resident_language_prefs).
-- Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.maintenance_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       text,
  unit_id        text,
  association_id text,
  description    text,
  urgency        text        NOT NULL DEFAULT 'medium',
  status         text        NOT NULL DEFAULT 'open',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversation_feedback (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   text,
  phone_number      text,
  persona           text,
  language          text,
  division          text,
  channel           text,
  rating_type       text,
  thumbs_value      text,
  stars_value       int,
  comment           text,
  flow_type         text,
  handled_by        text,
  ai_sentiment      text,
  ai_tags           jsonb,
  ai_improvement    text,
  reviewed_by_staff boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_requests (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id                 text,
  representation_type      text,
  status                   text        NOT NULL DEFAULT 'new',
  channel                  text,
  property_address         text,
  listing_agreement_status text,
  request_notes            text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maintenance_requests_owner_idx ON public.maintenance_requests (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conversation_feedback_phone_idx ON public.conversation_feedback (phone_number, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_requests_agent_idx ON public.agent_requests (agent_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_requests  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_feedback TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_requests        TO service_role;

ALTER TABLE public.maintenance_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_requests        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_maintenance_requests" ON public.maintenance_requests;
CREATE POLICY "service_role_all_maintenance_requests"
  ON public.maintenance_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_conversation_feedback" ON public.conversation_feedback;
CREATE POLICY "service_role_all_conversation_feedback"
  ON public.conversation_feedback FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_agent_requests" ON public.agent_requests;
CREATE POLICY "service_role_all_agent_requests"
  ON public.agent_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
