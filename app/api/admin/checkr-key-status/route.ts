// GET /api/admin/checkr-key-status
//
// Reports ONLY whether CHECKR_API_KEY is a test (sk_test_) or live
// (sk_live_) key -- never the key itself. Exists to resolve the one
// remaining gate on flipping any association to maia_checkr: the Vercel var
// is marked Sensitive (unreadable via the dashboard UI or API once set), so
// there was previously no way to confirm which mode was live short of
// triggering a real order and watching what happens. See docs/ROADMAP.md's
// Checkr entry -- this was listed as "offered, not built" until now.
//
// Real case, 2026-09-06: this checked for a 'ckr_sk_live_'/'ckr_sk_test_'
// prefix, which nobody had verified against an actual Checkr dashboard --
// the real prefix, confirmed live against Checkr's own masked key display
// (both the test and the freshly-generated live key), is 'sk_test_'/
// 'sk_live_' with no 'ckr_' prefix at all.
//
// Still-open case, same day: after the prefix fix above shipped and was
// confirmed live in production, this kept returning "unrecognized" for a
// freshly-set CHECKR_API_KEY that Checkr's own dashboard shows as
// sk_live_...2c6b. That rules out the prefix logic itself -- so the value
// Vercel is actually injecting must not literally start with "sk_live_"
// (a stray leading character from the copy/paste -- e.g. a zero-width
// space, a smart-quote, a wrapping quote character, or a leading newline
// -- would do exactly this while still "looking" right in a screenshot).
// Added length + the char codes of the first/last few characters below
// (never the key itself) so this can be confirmed from the JSON response
// instead of guessed at.
//
// Also reports CHECKR_PACKAGE_RESIDENTIAL's raw value (not a credential --
// it's a fixed package tier, not a secret, so no need to mask it). Added
// 2026-09-06 after staff couldn't find any "Packages" section in Checkr's
// dashboard matching this var -- Checkr's own Errors guide's example
// validation error is `"detail":"must be one of: starter, essential"` on
// `/order/package`, meaning package isn't a dashboard-configured slug at
// all, just one of those two literal enum values. Checking the raw value
// here confirms whether it's actually set to one of them before spending a
// real order on finding out.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function charCodes(s: string): number[] {
  return Array.from(s, (c) => c.codePointAt(0) ?? 0)
}

export async function GET() {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = process.env.CHECKR_API_KEY ?? ''
  const mode = !key ? 'unconfigured'
    : key.startsWith('sk_live_') ? 'live'
    : key.startsWith('sk_test_') ? 'test'
    : 'unrecognized'

  const pkg = process.env.CHECKR_PACKAGE_RESIDENTIAL ?? null
  const KNOWN_PACKAGES = ['starter', 'essential']

  return NextResponse.json({
    mode,
    length: key.length,
    // Never enough characters to reconstruct the key -- just enough to spot
    // a stray character (whitespace, quote marks, BOM) that a screenshot
    // can't reveal. Decode each code point at https://www.rapidtables.com/code/text/ascii-table.html
    // or just eyeball: 32=space, 34=", 39=', 8203/65279=invisible unicode.
    firstCharCodes: charCodes(key.slice(0, 6)),
    lastCharCodes: charCodes(key.slice(-4)),
    package: pkg,
    packageRecognized: pkg !== null && KNOWN_PACKAGES.includes(pkg),
  })
}
