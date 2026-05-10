-- Flag the five buildings PMI manages in commercial condo mode.
-- Names per the property manager:
--   Essington, Kane, Maco, Wedgewood Ansin, Wedgewood 57.
--
-- Match by association_code where it's unambiguous, plus by name pattern
-- so this also catches any rows whose codes differ from what we expect.

UPDATE public.associations
   SET association_type = 'commercial_condo'
 WHERE association_code IN ('ESSI', 'KANE', 'MACO', 'WBPA', 'WBP')
    OR association_name ILIKE '%ESSINGTON%'
    OR association_name ILIKE '%KANE%'
    OR association_name ILIKE '%MACO%'
    OR association_name ILIKE '%WEDGEWOOD%ANSIN%'
    OR association_name ILIKE '%WEDGEWOOD%57%';
