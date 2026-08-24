-- User report, 2026-08-24 (MANXI, Angelique Philips / CINC #1093): CINC's
-- board-members endpoint holds a single, apparently stale/wrong email
-- (a Yahoo address she has trouble with) while MAIA correctly has her
-- real Gmail — the one she uses to e-sign approval letters. The sync
-- page proposed silently overwriting MAIA's working email with CINC's.
-- Probed CINC's raw boardMembers response directly (BoardMemberId 1093):
-- confirmed CINC genuinely exposes only ONE `Email` field for board
-- members (no second/secondary field anywhere in the response) — so
-- there's no "second CINC email" for MAIA to read instead; CINC's single
-- value is just wrong for this contact. email_locked lets staff mark a
-- board member's email as MAIA-authoritative so lib/cinc-sync.ts stops
-- proposing to overwrite it on every future sync.

alter table public.association_board_members
  add column if not exists email_locked boolean not null default false;
