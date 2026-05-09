-- Tag each association with its Florida governance type so MAIA can cite
-- the correct statute (FS 718 condos, FS 719 co-ops, FS 720 HOAs).
-- Rows are left NULL until staff classify them; the chat/email surfaces
-- only inject the type when it's known.

ALTER TABLE public.associations
  ADD COLUMN IF NOT EXISTS association_type text
  CHECK (association_type IN ('condo', 'coop', 'hoa'));

CREATE INDEX IF NOT EXISTS associations_type_idx
  ON public.associations (association_type);
