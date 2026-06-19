---
name: voice-plan
description: "Decided architecture for MAIA's natural multilingual voice agent — Vapi + Twilio + bring-your-own-Claude + Cartesia/Deepgram + pgvector; DEFERRED (customer-facing, MAIA is staff-only today). Skip Alexa/Siri/OAuth."
metadata: 
  node_type: memory
  type: project
  originSessionId: 0f966d35-5727-4b77-8261-7f0eced7619a
---

# MAIA voice agent — decided plan (DEFERRED: customer-facing)

MAIA is **staff-only today** (internal routines), so a customer-facing phone voice agent is **future, not now**. This records the decision so it isn't re-litigated.

## Platform decision: Vapi (Build plan, usage-based)
Researched 2026-06-18 (deep-research, 25 sources, adversarially verified). Winner = **Vapi**, decisively, because of ONE stack fact:
- **Vapi is the only option whose bring-your-own-LLM path is stateless HTTP** (OpenAI-compatible `/chat/completions` POST + SSE on the same request) → our Next.js-on-Vercel backend stays stateless.
- **Twilio ConversationRelay AND Retell both require a persistent WebSocket** we'd host; **Vercel does not support persistent WebSockets** (confirmed, even Fluid Compute) → both need separate always-on infra. Rejected.
- ConversationRelay also CANNOT drive Cartesia (only Google/Polly/ElevenLabs-Flash); Vapi + Retell can.

## Voice stack (all configured INSIDE Vapi — one platform to operate)
- **Telephony:** existing Twilio number — point its **Voice** config at Vapi; SMS/WhatsApp stay on the existing webhook (separate Messaging config).
- **LLM:** Claude via our **custom endpoint** (bring-your-own = $0 Vapi markup). We host a stateless `/api/voice/agent` shim: OpenAI-shaped `/chat/completions` → Claude Messages API → stream back OpenAI-style SSE.
- **STT:** Deepgram (per-language codes — fixes today's English-only `<Gather>` bug).
- **TTS:** Cartesia Sonic 3.5 primary, ElevenLabs fallback. **Hebrew has NO independent benchmark → must ear-test** per provider.
- **Pricing:** Vapi charges ONLY ~$0.05/min hosting; STT/LLM/TTS are "at cost / $0 with your own keys." ~1,000 min/mo ≈ $85–110 all-in (estimate, not verified — pull live). **Do NOT buy HIPAA ($2K/mo) or Zero-Data-Retention ($1K/mo)** — not needed for HOA data.

## Voice = "fast lane" (latency)
A full agentic multi-tool loop per turn breaks live voice. Voice path = persona (reuse `buildCallerContext`) → pgvector retrieve (fast) → ONE streamed Claude completion (tiny fast tool set) → SSE. Slow tools (WO status, balances) answered conversationally + fetched async. Keep `lib/anthropic-guard.ts` circuit breaker in front (post-runaway-incident). Text channels (SMS/WhatsApp/email) can use the fuller agentic loop.

## SKIP: Alexa / Siri / OAuth device-linking
A separate proposal pushed Alexa/Siri account-linking (OAuth `authorize`/`token`, `voice_devices`, `voice_link_codes`). **Skip unless smart speakers become a real goal** — (1) phone identity is caller-ID via existing `buildCallerContext` (no OAuth needed), (2) Alexa/Siri FORCE their own robotic voices (can't use Cartesia) → conflicts with the "most natural voice" goal.

## Don't double-build (already exists)
- Persona resolver = `buildCallerContext()` in `app/api/webhook/route.ts` (phone/email → owner/tenant/board/vendor/agent + language). EXTEND it; don't build a parallel `auth.ts`.
- Staff admin = `/admin/staff-setup` already exists. Reuse.
- Net-new + worth building (platform-agnostic, help staff too): **pgvector knowledge base + association/persona-filtered retrieval** (the accuracy lever), **voice_translation_cache**, **voice_audit_log**.

## Orchestration: Agent SDK + in-repo tools (not n8n)
Code-first shop → keep logic in-repo (Claude Agent SDK / tool-use + typed function-call tools; MCP only where a maintained server clearly wins — MAIA does NOT use MCP in-product today). n8n only if non-devs must edit flows visually. The pgvector retrieval layer is the durable asset; orchestrator choice is reversible.
