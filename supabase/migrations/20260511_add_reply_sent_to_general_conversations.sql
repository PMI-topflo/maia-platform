-- ROOT CAUSE FIX for the fsetton@gmail.com loop.
--
-- The freeform handler in lib/maia-command-processor.ts has two safety
-- guards that BOTH query .eq('reply_sent', true) on general_conversations:
--   * per-thread loop guard (~line 883): "don't reply twice on the same
--     gmail_thread_id within 10 minutes"
--   * global rate limit (~line 906): "stop after 5 freeform replies in
--     any rolling 5-minute window"
--
-- The column was never added to this table — the original migration at
-- supabase/migrations/20260430_maia_email_commands.sql:17 added
-- reply_sent to maia_email_commands but the parallel addition on
-- general_conversations was missed. As a result:
--   * .eq('reply_sent', true) returns count=null silently
--   * (null ?? 0) >= LIMIT is false → guard fails OPEN
--   * .update({ reply_sent: true, ... }) on line 1040 also failed silently
--
-- This adds the missing column. No code changes are required; the
-- existing reads/writes start behaving as designed.

alter table public.general_conversations
  add column if not exists reply_sent boolean not null default false;

-- Backs the global rate-limit query: .eq('reply_sent', true).gte('updated_at', windowStart)
create index if not exists general_conversations_reply_sent_updated_at_idx
  on public.general_conversations (updated_at desc)
  where reply_sent = true;

-- Backs the per-thread guard: .eq('gmail_thread_id', X).eq('reply_sent', true).gte('updated_at', tenMinAgo)
create index if not exists general_conversations_thread_reply_sent_updated_at_idx
  on public.general_conversations (gmail_thread_id, updated_at desc)
  where reply_sent = true;
