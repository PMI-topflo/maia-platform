// GET /api/admin/checkr-key-status
//
// Reports ONLY whether CHECKR_API_KEY is a test (ckr_sk_test_) or live
// (ckr_sk_live_) key -- never the key itself. Exists to resolve the one
// remaining gate on flipping any association to maia_checkr: the Vercel var
// is marked Sensitive (unreadable via the dashboard UI or API once set), so
// there was previously no way to confirm which mode was live short of
// triggering a real order and watching what happens. See docs/ROADMAP.md's
// Checkr entry -- this was listed as "offered, not built" until now.
//
// Real case, 2026-09-06: this originally checked for 'ckr_sk_live_'/
// 'ckr_sk_test_', which is correct -- but a same-day "fix" changed it to
// 'sk_live_'/'sk_test_' with no 'ckr_' prefix, based on Checkr's dashboard
// TABLE showing a truncated "sk_live_••••xxxx" for a key row. That table
// display is a shortened presentation, not the real secret -- a raw
// copy-to-clipboard of an actual live key confirmed the true value is
// 'ckr_sk_live_<40 hex chars>' (52 characters total), 'ckr_' prefix very
// much included. The wrong fix then had staff strip the real 'ckr_' prefix
// to satisfy this broken check, which made this endpoint report "live"
// while actually sending Checkr a mangled key -- surfacing downstream as a
// real 401 "Invalid token" from Checkr's own /orders endpoint. Reverted
// back to the original, correct prefix.
//
// Length + the char codes of the first/last few characters are still
// reported below (never the key itself) so a future paste issue (a stray
// leading character, an accidental capitalization of 'ckr_') can be
// confirmed from the JSON response instead of guessed at.
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
    : key.startsWith('ckr_sk_live_') ? 'live'
    : key.startsWith('ckr_sk_test_') ? 'test'
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
