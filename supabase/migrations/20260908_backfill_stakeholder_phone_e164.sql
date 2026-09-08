-- =====================================================================
-- 20260908_backfill_stakeholder_phone_e164.sql
--
-- User report, 2026-09-08 (screenshot, the staff Agents card): "Maia is
-- not normalizing phone numbers from agents for WhatsApp format" --
-- "954 830 2930" and "954-303-6111" shown side by side, neither in the
-- +1XXXXXXXXXX form the rest of the app already standardizes on
-- (lib/cinc-sync.ts's normalizePhone, used for owner/tenant phones).
--
-- Root cause: three of the four write paths into application_stakeholders
-- (the applicant's-agent and listing-agent self-serve forms, and the
-- mid-intake "add a collaborator" flow) never ran the phone through
-- normalizePhone at all -- only the staff Edit-agent route
-- (app/api/admin/pre-apply/[id]/agents/route.ts) did. Those code paths are
-- now fixed to normalize on every future write (lib/applications.ts's
-- addStakeholder, lib/preapply.ts's addStakeholders); this is the one-time
-- catch-up for rows already stored raw.
--
-- Applies the exact same normalizePhone logic in SQL: 10 digits -> a
-- +1-prefixed number, 11 digits starting with 1 -> +-prefixed as-is,
-- already-+-prefixed left alone, anything else -> +-prefixed digits-only.
-- Scoped to rows not already in clean "+digits" form, so a second run is a
-- no-op. A phone that strips to zero digits (garbage, not a real number)
-- is left completely untouched rather than guessed at or nulled --
-- normalizePhone itself would return null for that input, but silently
-- deleting a value nobody asked to delete is the wrong default for a
-- backfill; staff can review/correct it directly if it matters.
--
-- Idempotent -- re-running only touches rows that still qualify.
-- =====================================================================

UPDATE public.application_stakeholders
   SET phone = CASE
     WHEN length(regexp_replace(phone, '\D', '', 'g')) = 10
       THEN '+1' || regexp_replace(phone, '\D', '', 'g')
     WHEN length(regexp_replace(phone, '\D', '', 'g')) = 11
      AND left(regexp_replace(phone, '\D', '', 'g'), 1) = '1'
       THEN '+' || regexp_replace(phone, '\D', '', 'g')
     WHEN trim(phone) LIKE '+%'
       THEN trim(phone)
     ELSE '+' || regexp_replace(phone, '\D', '', 'g')
   END
 WHERE phone IS NOT NULL
   AND phone !~ '^\+[0-9]+$'
   AND regexp_replace(phone, '\D', '', 'g') <> '';

NOTIFY pgrst, 'reload schema';
