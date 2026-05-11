-- Per-message idempotency for the freeform reply path. Companion to PR #24.
--
-- The freeform handler at lib/maia-command-processor.ts:921-944 inserts a
-- row into general_conversations keyed by gmail_message_id, and at line
-- 941 checks for Postgres error code 23505 (unique violation) to short-
-- circuit duplicate processing:
--
--     if (convErr.code === '23505') return  // already processed
--
-- That branch has been unreachable because there is no unique index on
-- gmail_message_id. INSERT always succeeds, the freeform pipeline runs
-- end-to-end, and the same inbound message can produce a fresh reply
-- every time the webhook fires (Pub/Sub retries, inbox-scan recovery
-- fallback in app/api/maia-email/webhook/route.ts:114-122, watch
-- renewals, etc.). This is the third compound cause of the
-- fsetton@gmail.com reply loop.
--
-- This migration:
--   1. Deletes pre-existing duplicate rows, keeping the oldest by id
--      (the row from the first time the message was processed).
--   2. Adds a partial unique index on gmail_message_id (excluding NULLs
--      — the column is nullable for non-Gmail channels such as the
--      web widget).
--
-- After this migration, the existing 23505-check at line 941 starts
-- functioning as designed and the same gmail_message_id can never be
-- replied to more than once.

-- Step 1: dedup. Keep the row with the smallest id (earliest insert).
-- Safe to re-run; idempotent because no duplicates remain after first run.
delete from public.general_conversations a
  using public.general_conversations b
  where a.gmail_message_id is not null
    and a.gmail_message_id = b.gmail_message_id
    and a.id > b.id;

-- Step 2: partial unique index. WHERE clause excludes NULLs so non-Gmail
-- channels (web widget, etc.) that omit gmail_message_id are unaffected.
create unique index if not exists general_conversations_gmail_message_id_uq_idx
  on public.general_conversations (gmail_message_id)
  where gmail_message_id is not null;
