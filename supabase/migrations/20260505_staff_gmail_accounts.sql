-- Staff Gmail accounts connected via OAuth for omnichannel email reading
CREATE TABLE IF NOT EXISTS public.staff_gmail_accounts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_address  text        NOT NULL UNIQUE,
  display_name   text,
  refresh_token  text        NOT NULL,
  access_token   text,
  token_expiry   timestamptz,
  history_id     text,
  watch_expiry   timestamptz,
  active         boolean     NOT NULL DEFAULT true,
  connected_by   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_gmail_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_staff_gmail" ON public.staff_gmail_accounts
  USING (auth.role() = 'service_role');
