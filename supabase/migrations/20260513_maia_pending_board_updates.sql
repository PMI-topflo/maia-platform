-- =====================================================================
-- maia_pending_board_updates
-- Two-step confirmation flow for the `@maia update board members` email
-- command. The command parses an email, lists current + proposed board
-- members, and emails a confirm/cancel magic link to the requester.
-- Nothing is written to association_board_members until the staff
-- member clicks the confirm link.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.maia_pending_board_updates (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  confirm_token      uuid        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  association_code   text        NOT NULL,
  association_name   text        NOT NULL,
  requester_email    text        NOT NULL,
  requester_name     text,
  new_members        jsonb       NOT NULL,
  current_members    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  gmail_message_id   text,
  gmail_thread_id    text,
  reply_subject      text,
  status             text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'applied', 'cancelled', 'expired')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  applied_at         timestamptz,
  cancelled_at       timestamptz
);

CREATE INDEX idx_maia_pending_board_updates_token  ON public.maia_pending_board_updates (confirm_token);
CREATE INDEX idx_maia_pending_board_updates_status ON public.maia_pending_board_updates (status);

ALTER TABLE public.maia_pending_board_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_maia_pending_board_updates"
  ON public.maia_pending_board_updates FOR ALL TO service_role USING (true);

-- =====================================================================
-- association_board_members.email — allow NULL
--
-- The new @maia update board members flow accepts just name + role
-- (the email address is typically filled in later via the UI). The
-- original schema required email NOT NULL; relax that. Existing rows
-- are unaffected.
-- =====================================================================
ALTER TABLE public.association_board_members
  ALTER COLUMN email DROP NOT NULL;
