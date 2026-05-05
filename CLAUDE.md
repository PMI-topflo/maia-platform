# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: Next.js Version

This project uses **Next.js 16.2.2** — a version with breaking changes from what you may know. Before writing any Next.js-specific code, read the relevant guide in `node_modules/next/dist/docs/`. Heed deprecation notices; APIs and conventions may differ from training data.

## Commands

```bash
npm run dev      # Start dev server (port 3000)
npm run build    # Production build
npm run lint     # ESLint 9
```

There is no test runner configured. Type-check with:
```bash
npx tsc --noEmit
```

## Tech Stack

- **Framework**: Next.js 16 App Router, React 19, TypeScript 5 (strict)
- **Database**: Supabase (PostgreSQL with Row Level Security)
- **Styling**: Tailwind CSS 4 + custom design tokens in `app/globals.css`
- **Email**: Resend (primary) + Gmail API OAuth (fallback)
- **SMS/WhatsApp**: Twilio
- **AI**: Anthropic Claude API (`@anthropic-ai/sdk`)
- **Payments**: Stripe
- **Deployment**: Vercel (Node 20.x required)

## Architecture

### Multi-Persona Access Control

Three authenticated personas, each with its own portal and session:
- `owner` → `/my-account`
- `board` → `/board`
- `staff` → `/admin` (can access all three portals)

`middleware.ts` guards these routes using HMAC-SHA256 session tokens stored in the `maia_session` HttpOnly cookie. Auth is handled in `lib/session.ts` using `globalThis.crypto.subtle` (Web Crypto API) — this must stay Edge-compatible. **Never use Node's `crypto` module in `lib/session.ts` or `middleware.ts`.**

OTP verification flow: `app/api/auth/` → OTP send → verify → `signSession()` → set cookie → redirect to persona portal.

### MAIA Email Command System

The core AI automation lives in `lib/maia-command-processor.ts` (~1000 lines). When a Gmail Pub/Sub webhook hits `app/api/maia-email/webhook/`:

1. Sender is validated (must be `@topfloridaproperties.com`, `@pmitop.com`, or `@mypmitop.com`)
2. Email body is scanned for trigger phrases (`@maia add owner`, `@maia new tenant`, etc.)
3. Claude Haiku parses the email into a typed JSON record
4. The record is upserted into Supabase with domain-specific side effects:
   - **New owner**: Archives previous owner for that unit, handles tenant conflicts, sends courtesy email
   - **New tenant**: Archives previous tenant, notifies all active board members
   - **Board/Agent/Vendor**: Simple insert
5. Attachments (COI, W-9, ACH) are uploaded to named Supabase storage buckets
6. An HTML reply is sent back with context-aware templates
7. If `@maia` is mentioned without a structured command, Claude Sonnet handles a freeform conversation (thread-aware via `general_conversations` table)

### Association Portals

25 named association routes (`/abbott`, `/brook`, `/venetian1`, etc.) are generated from `setup_pages.sh`. Each is an OTP-gated portal with a `[slug]` dynamic catch-all. The pages follow shared CSS classes defined in `globals.css` (`.assoc-page`, `.assoc-hero`, `.assoc-topbar`).

### Supabase Usage Pattern

- **User-facing queries**: Use the anon client — RLS enforced by Supabase policies
- **Admin/server operations**: Use `lib/supabase-admin.ts` (service role key, bypasses RLS)
- Unique constraint violations return Postgres error code `23505`; the codebase uses this for idempotent upserts

### Embeddable Widget

`/widget` route renders inside an iframe on external sites. `next.config.ts` sets permissive frame headers (`X-Frame-Options: ALLOWALL`, `frame-ancestors *`) scoped only to that route.

## Key Conventions

- **Path alias**: `@/*` maps to `./` (repo root) — use it for all internal imports
- **Supabase clients**: Never create inline clients; always import from `lib/supabase-admin.ts` (server) or instantiate with the public anon key (client components)
- **Session handling**: Only call `signSession`/`verifySession` from `lib/session.ts`; do not roll custom token logic
- **Rate limiting**: Use `lib/rate-limit.ts` for any new OTP or sensitive endpoints (3 attempts/hour by identifier)
- **Design tokens**: Colors, fonts, and spacing are CSS custom properties in `globals.css` — use them (`var(--navy)`, `var(--gold)`, etc.) instead of hardcoded values
- **Gmail watch**: Renewed every 6 days by a Vercel cron job defined in `vercel.json`; do not modify the cron schedule without updating the watch expiry logic

## Environment Variables

All required variables are documented with descriptions in `.env.example`. Key points:

- **`SUPABASE_SERVICE_KEY`** is the canonical name for the Supabase service role secret throughout this codebase (`lib/supabase-admin.ts`). Do not use `SUPABASE_SERVICE_ROLE_KEY`.
- **`NEXT_PUBLIC_APP_URL`** is the canonical public base URL (e.g. `https://www.pmitop.com`). Do not use `NEXT_PUBLIC_URL`.
- **`TWILIO_PHONE_NUMBER`** is the SMS sender; **`TWILIO_WHATSAPP_NUMBER`** is the WhatsApp-enabled number. These may be different values.
- **`CRON_SECRET`** is set automatically by Vercel for scheduled cron jobs — add it to your local `.env.local` for manual cron testing.
- **`INTERNAL_API_SECRET`** guards `/api/trigger-applycheck` from external calls; it is passed as the `x-internal-secret` header by the Stripe webhook handler.
