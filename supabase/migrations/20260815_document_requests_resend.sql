-- =====================================================================
-- 20260815_document_requests_resend.sql
--
-- Records when a document request was last RE-sent, and by whom.
--
-- A request can now be re-sent after staff attach an example of one of the
-- documents it asks for ("Please send me an example of this document you
-- want" was the reply that prompted it). The email is rebuilt from the
-- current checklist, so the resend carries the example while keeping the
-- SAME upload tokens — any link the recipient already has keeps working.
--
-- Without these columns there is no way to tell a request that went out once
-- from one that has been chased three times.
-- =====================================================================

ALTER TABLE public.document_requests ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;
ALTER TABLE public.document_requests ADD COLUMN IF NOT EXISTS last_sent_by text;

NOTIFY pgrst, 'reload schema';
