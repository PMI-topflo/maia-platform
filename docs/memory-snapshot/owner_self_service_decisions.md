---
name: owner-self-service-decisions
description: "Decided behavior for owner ledger delivery, owner payment rail, and the application-forms remaining gap (MAIA owner-facing track)."
metadata: 
  node_type: memory
  type: project
  originSessionId: c35ddde2-be05-4020-9cf7-5b48340de70b
---

Owner self-service track decisions (from user, 2026-06-02):

1. **Owner ledger delivery** — Owner is identified ONCE via the existing 2FA/OTP (owner persona on `/my-account`). After that first identification, the owner may **request their ledger by any channel: email, WhatsApp, or text (SMS)**. So ledger delivery is multi-channel, not in-portal-only. Build the CINC per-owner statement fetch + multi-channel delivery (Resend email / Twilio WhatsApp+SMS).

2. **Owner payments rail** — Owners do NOT pay via Stripe. They pay by **logging into CINC WebAxis**, OR **sending a check**, OR via **ACH forms**. **Stripe is ONLY used for the application-fee procedure.** So "owner online payments" = surface a CINC WebAxis link + check/ACH form info on `/my-account`; no Stripe owner-assessment flow.

3. **Application-forms gap** — The whole application system is already built. The ONLY remaining work: **add each association's rules into the existing MAIA application flow so the applicant acknowledges/signs them inside the application** (per-association rules content + acknowledgment step). Not a bug, not new infra.

**Why:** These set scope for the highest-value new track and prevent over-building (no Stripe owner payments, no in-portal-only ledger).
**How to apply:** When building owner self-service, reuse owner OTP for the one-time ID; deliver ledger via [[gmail_addon]]-style channels (Resend/Twilio); for the app-rules work, extend `/apply` with per-association rule acknowledgment, don't rebuild the form.

See [[next_session_priorities]] and the in-repo `docs/ROADMAP.md`.
