-- =====================================================================
-- 20260908_owner_contact_history.sql
--
-- Real incident, 2026-09-08: MANXI 802's owner (Jorge Enrique Hernandez)
-- had a Shoreland owner's email (palhano@me.com) sitting in his own
-- `emails` field -- MAIA was correspondence-ready-scoped to the right
-- association/unit the whole time, the DATA on that row was just wrong.
-- Traced as far as code archaeology allows: `owners.created_at` shows
-- MANXI 505/802/708/711 and SP 10B/MANXI 207 were all bulk-inserted in
-- two exact-timestamp batches on 2026-04-16 -- a row-misalignment bug in
-- whatever one-time import script originally populated this table,
-- predating this repo's tracked history. `owners` had NO `updated_at`
-- column at all, so there was no way to even ask "when was this last
-- touched" after the fact, let alone by what.
--
-- Two things, so this is traceable going forward instead of only
-- discoverable by a staff member noticing a wrong recipient months
-- later:
--
--   1. owners.updated_at, stamped by a trigger on every UPDATE (not
--      just set-and-forget at write time, which a raw .update() call
--      could still bypass by accident).
--   2. owner_contact_history -- one row per changed emails/phone value,
--      old vs new, who/what changed it (a staff login email, or
--      'cinc_sync' for the CINC-authoritative sync's own apply step),
--      and when. Populated from both places owners.emails/phone can
--      actually change: lib/cinc-sync.ts's applySync() and
--      app/admin/actions.ts's updateOwner() (the manual staff edit
--      screen, EditModal.tsx).
--
-- Idempotent.
-- =====================================================================

ALTER TABLE public.owners
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.owners SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE public.owners ALTER COLUMN updated_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION public.set_owners_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_owners_updated_at ON public.owners;
CREATE TRIGGER trg_owners_updated_at
  BEFORE UPDATE ON public.owners
  FOR EACH ROW EXECUTE FUNCTION public.set_owners_updated_at();

CREATE TABLE IF NOT EXISTS public.owner_contact_history (
  id                bigint generated always as identity primary key,
  owner_id          integer not null references public.owners(id) on delete cascade,
  association_code  text,
  unit_number       text,
  field             text not null,             -- 'emails' | 'phone'
  old_value         text,
  new_value         text,
  changed_by        text not null,             -- a staff login email, or 'cinc_sync'
  changed_at        timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS owner_contact_history_owner_id_idx ON public.owner_contact_history(owner_id);
CREATE INDEX IF NOT EXISTS owner_contact_history_unit_idx ON public.owner_contact_history(association_code, unit_number);

NOTIFY pgrst, 'reload schema';
