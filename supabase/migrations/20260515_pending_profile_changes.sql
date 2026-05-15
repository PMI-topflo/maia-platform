-- =====================================================================
-- pending_profile_changes
-- Approval-gated email changes for non-staff personas. Staff edit
-- their own pmi_staff row directly via /admin/profile; owners /
-- board / tenants / unit-mgrs / bldg-mgrs can edit non-sensitive
-- fields directly, but any change to their login email goes here
-- first and only lands on the persona table after a staff approver
-- clicks the magic link in the notification email.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.pending_profile_changes (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  confirm_token       UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  reject_token        UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),

  persona             TEXT         NOT NULL,
  persona_record_id   TEXT         NOT NULL,   -- bigint for owners (cast to text), uuid for the others
  field               TEXT         NOT NULL DEFAULT 'email',

  current_value       TEXT,
  proposed_value      TEXT         NOT NULL,

  requester_email     TEXT         NOT NULL,
  requester_name      TEXT,
  association_code    TEXT,
  association_name    TEXT,

  status              TEXT         NOT NULL DEFAULT 'pending',
  approver_email      TEXT,
  decided_at          TIMESTAMPTZ,
  decision_notes      TEXT,

  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + interval '7 days'),

  CONSTRAINT chk_ppc_persona CHECK (persona IN ('owner','tenant','board','unit_manager','building_manager')),
  CONSTRAINT chk_ppc_field   CHECK (field   IN ('email')),
  CONSTRAINT chk_ppc_status  CHECK (status  IN ('pending','approved','rejected','expired'))
);

CREATE INDEX IF NOT EXISTS idx_ppc_confirm_token ON public.pending_profile_changes (confirm_token);
CREATE INDEX IF NOT EXISTS idx_ppc_reject_token  ON public.pending_profile_changes (reject_token);
CREATE INDEX IF NOT EXISTS idx_ppc_status        ON public.pending_profile_changes (status);
CREATE INDEX IF NOT EXISTS idx_ppc_persona       ON public.pending_profile_changes (persona, persona_record_id);

ALTER TABLE public.pending_profile_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_pending_profile_changes"
  ON public.pending_profile_changes FOR ALL TO service_role USING (true);
