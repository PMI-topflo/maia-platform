-- Lafayette Arms (LFA) is a cooperative — its registered Sunbiz name does
-- not contain "COOPERATIVE", so the name-pattern classifier missed it.
-- Set explicitly so MAIA cites FS 719 (not FS 718) for this building.

UPDATE public.associations
   SET association_type = 'coop'
 WHERE association_code = 'LFA'
    OR association_name ILIKE '%LAFAYETTE ARMS%';
