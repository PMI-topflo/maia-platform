-- =====================================================================
-- 20260915_lease_renewal_checks_normalize_labels.sql
--
-- Clean up the account-number-keyed lease_renewal_checks rows.
--
-- How they were made: both reminder crons key the check row on
-- 'owner?.unitNumber || account'. Before PR #850 (2026-09-09) the owner
-- lookup '.maybeSingle()'d 'owners' and threw PGRST116 on every CO-OWNED
-- unit, which callers swallowed into a silent null — so for a co-owned unit
-- the crons fell back to the raw CINC account number and minted a SECOND
-- row, "MANXI710" beside "710", with no owner name and no owner email.
--
-- Measured 2026-09-15: 19 such rows, ALL created in August (newest
-- 2026-08-31, none since the #850 fix), NONE carrying any answer,
-- application or occupancy. 14 of them shadow a correct row.
--
-- The code-side fallback is fixed in the same PR ('unitLabelFor()' in
-- lib/lease-renewal-check.ts strips the association prefix instead of
-- keying on the account), so this only has to clear the historical debris.
--
--   * a shadow (a correctly-labelled twin exists)  -> DELETE
--   * an orphan (no twin)                          -> RELABEL, keeping its
--     tokens; the next cron run heals its owner name/email in place
--
-- Scoped hard to rows created before the #850 fix that carry NO resident
-- answer, so nothing a resident actually submitted can be touched.
-- Idempotent: re-running finds nothing left to match.
-- =====================================================================

-- ── 1. Shadows: a correctly-labelled row already exists ──────────────
DELETE FROM public.lease_renewal_checks c
 WHERE c.created_at < '2026-09-09'
   AND upper(c.unit_label) LIKE upper(c.association_code) || '%'
   AND length(c.unit_label) > length(c.association_code)
   AND c.owner_occupancy IS NULL AND c.owner_response IS NULL
   AND c.tenant_response IS NULL AND c.application_id IS NULL
   AND EXISTS (
     SELECT 1 FROM public.lease_renewal_checks t
      WHERE t.association_code = c.association_code
        AND t.lease_end        = c.lease_end
        AND t.id             <> c.id
        AND upper(t.unit_label) = upper(substring(c.unit_label from length(c.association_code) + 1))
   );

-- ── 2. Orphans: no twin — keep the row and its tokens, fix the label ──
UPDATE public.lease_renewal_checks c
   SET unit_label = substring(c.unit_label from length(c.association_code) + 1),
       updated_at = now()
 WHERE c.created_at < '2026-09-09'
   AND upper(c.unit_label) LIKE upper(c.association_code) || '%'
   AND length(c.unit_label) > length(c.association_code)
   AND c.owner_occupancy IS NULL AND c.owner_response IS NULL
   AND c.tenant_response IS NULL AND c.application_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.lease_renewal_checks t
      WHERE t.association_code = c.association_code
        AND t.lease_end        = c.lease_end
        AND t.id             <> c.id
        AND upper(t.unit_label) = upper(substring(c.unit_label from length(c.association_code) + 1))
   );

NOTIFY pgrst, 'reload schema';
