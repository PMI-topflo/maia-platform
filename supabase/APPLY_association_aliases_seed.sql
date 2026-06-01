-- =====================================================================
-- APPLY_association_aliases_seed.sql   (NOT a migration — won't auto-run)
--
-- DRAFT common-name aliases per association, for detectAssociationCode.
-- Review/adjust the lists, then paste into the Supabase SQL editor and Run.
-- Re-runnable (each row is a full overwrite of match_aliases).
--
-- Rules baked in:
--  • Aliases are matched at WORD BOUNDARIES, case-insensitive.
--  • Keep each alias DISTINCTIVE — never add a bare "Venetian Park" or
--    "Wedgewood Business Park" (they'd be ambiguous across siblings).
--  • The matcher also derives a "core name" from the legal name at runtime,
--    so these aliases mainly cover nicknames/variants the core can't catch.
-- =====================================================================

update public.associations set match_aliases = '{"Abbott Avenue","7636 Abbott"}'                       where association_code = 'ABBOTT';
update public.associations set match_aliases = '{"Brook Haven","Brookhaven"}'                          where association_code = 'BHB';
update public.associations set match_aliases = '{"Crystal Hills"}'                                     where association_code = 'CHV';
update public.associations set match_aliases = '{"Delvista"}'                                          where association_code = 'DELA';
update public.associations set match_aliases = '{"Essington"}'                                         where association_code = 'ESSI';
update public.associations set match_aliases = '{"Fifth Miramar"}'                                     where association_code = 'FIFTH';
update public.associations set match_aliases = '{"Gold Key Villas","Gold Key Villas 7"}'              where association_code = 'GK7';
update public.associations set match_aliases = '{"Galleria Village"}'                                  where association_code = 'GVH';
update public.associations set match_aliases = '{"Island House North","Island House"}'                where association_code = 'ISLAND';
update public.associations set match_aliases = '{"Kane Concourse"}'                                    where association_code = 'KANE';
update public.associations set match_aliases = '{"Kimberly Garden","Kimberly Gardens"}'               where association_code = 'KGA';
update public.associations set match_aliases = '{"California Club","Lakeview of the California Club"}' where association_code = 'LCLUB';
update public.associations set match_aliases = '{"Lafayette Arms"}'                                    where association_code = 'LFA';
update public.associations set match_aliases = '{"Maco Commerce","Maco Commerce Center"}'             where association_code = 'MACO';
update public.associations set match_aliases = '{"Manors of Inverrary","Inverrary XI"}'               where association_code = 'MANXI';
update public.associations set match_aliases = '{"One Bay Harbor"}'                                    where association_code = 'ONE';
update public.associations set match_aliases = '{"Parcview Villas","Parcview"}'                       where association_code = 'PVV';
update public.associations set match_aliases = '{"Shoreland Estates","Shoreland"}'                    where association_code = 'SHORE';
update public.associations set match_aliases = '{"Serenity Place"}'                                    where association_code = 'SP';
update public.associations set match_aliases = '{"Venetian Park V","Venetian Park Condominium V"}'    where association_code = 'VPC5';
update public.associations set match_aliases = '{"Venetian Park I","Venetian Park Condominium I"}'    where association_code = 'VPCI';
update public.associations set match_aliases = '{"Venetian Park II","Venetian Park Condominium II"}'  where association_code = 'VPCII';
update public.associations set match_aliases = '{"Venetian Park Recreation"}'                          where association_code = 'VPREC';
update public.associations set match_aliases = '{"Wedgewood Business Park 57th Terrace","Wedgewood 57"}' where association_code = 'WBP';
update public.associations set match_aliases = '{"Wedgewood Business Park Ansin","Wedgewood Ansin"}'  where association_code = 'WBPA';

NOTIFY pgrst, 'reload schema';

-- Verify:
-- select association_code, match_aliases from public.associations order by association_code;
