-- =====================================================================
-- ownership_history
-- Explicit audit trail for unit ownership transfers. The existing
-- /admin/ownership-history page already reconstructs a chain from
-- `owners` rows where status='previous', but that's an implicit
-- log: no event timestamp distinct from the row's ownership_end_date,
-- no provenance (who triggered it, via which channel), no link to
-- the source MAIA email or admin actor.
--
-- This table records one row per transfer event. The MAIA owner
-- upsert flow writes here alongside its archive+insert pair, and
-- the migration backfills rows for every existing status='previous'
-- owner so the historical chain isn't lost.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ownership_history (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code         TEXT         NOT NULL,
  unit_number              TEXT,

  -- Snapshot of the outgoing owner (NULL when a unit is being assigned
  -- for the first time, e.g. an initial import).
  previous_owner_id        BIGINT       REFERENCES public.owners(id) ON DELETE SET NULL,
  previous_owner_name      TEXT,
  previous_owner_emails    TEXT,

  -- Snapshot of the incoming owner. NULL theoretically possible for a
  -- vacancy event but in practice we always set this.
  new_owner_id             BIGINT       REFERENCES public.owners(id) ON DELETE SET NULL,
  new_owner_name           TEXT,
  new_owner_emails         TEXT,

  transfer_date            DATE         NOT NULL DEFAULT CURRENT_DATE,
  source                   TEXT         NOT NULL DEFAULT 'unknown',
  actor_email              TEXT,
  maia_email_command_id    UUID         REFERENCES public.maia_email_commands(id) ON DELETE SET NULL,
  gmail_message_id         TEXT,
  notes                    TEXT,

  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_oh_source CHECK (
    source IN ('maia_email', 'admin_ui', 'manual', 'import', 'backfill', 'unknown')
  )
);

CREATE INDEX IF NOT EXISTS idx_oh_assoc_unit     ON public.ownership_history (association_code, unit_number);
CREATE INDEX IF NOT EXISTS idx_oh_transfer_date  ON public.ownership_history (transfer_date DESC);
CREATE INDEX IF NOT EXISTS idx_oh_prev_owner     ON public.ownership_history (previous_owner_id);
CREATE INDEX IF NOT EXISTS idx_oh_new_owner      ON public.ownership_history (new_owner_id);
CREATE INDEX IF NOT EXISTS idx_oh_created        ON public.ownership_history (created_at DESC);

ALTER TABLE public.ownership_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_ownership_history"
  ON public.ownership_history FOR ALL TO service_role USING (true);

-- =====================================================================
-- Backfill: one history row per existing status='previous' owner,
-- linked to whichever owner currently sits at the same assoc+unit
-- (if any). For previous owners with no successor (e.g. unit went
-- vacant), new_owner_id stays NULL.
--
-- transfer_date prefers the explicit ownership_end_date column on
-- the previous-owner row, falling back to the row's created_at date.
--
-- Idempotent on re-run via the NOT EXISTS guard.
-- =====================================================================

INSERT INTO public.ownership_history (
  association_code, unit_number,
  previous_owner_id, previous_owner_name, previous_owner_emails,
  new_owner_id, new_owner_name, new_owner_emails,
  transfer_date, source, notes
)
SELECT
  prev.association_code,
  prev.unit_number,
  prev.id,
  COALESCE(NULLIF(TRIM(BOTH ' ' FROM CONCAT_WS(' ', prev.first_name, prev.last_name)), ''), prev.entity_name),
  prev.emails,
  next_owner.id,
  COALESCE(NULLIF(TRIM(BOTH ' ' FROM CONCAT_WS(' ', next_owner.first_name, next_owner.last_name)), ''), next_owner.entity_name),
  next_owner.emails,
  COALESCE(prev.ownership_end_date, prev.created_at::date),
  'backfill',
  'Reconstructed from existing owners rows on ' || NOW()::date
FROM public.owners prev
LEFT JOIN LATERAL (
  SELECT id, first_name, last_name, entity_name, emails
  FROM public.owners successor
  WHERE successor.association_code = prev.association_code
    AND successor.unit_number      IS NOT DISTINCT FROM prev.unit_number
    AND (successor.status = 'active' OR successor.status IS NULL)
    AND successor.id <> prev.id
  ORDER BY successor.ownership_start_date NULLS LAST, successor.id
  LIMIT 1
) AS next_owner ON TRUE
WHERE prev.status = 'previous'
  AND NOT EXISTS (
    SELECT 1 FROM public.ownership_history oh
    WHERE oh.previous_owner_id = prev.id
  );
