import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

type EmailRow = {
  id:               string
  association_code: string
  subject:          string | null
  body_preview:     string | null
}

// Returns true only when the text contains an explicit account-number
// pattern for the given code (e.g. "ESSI16", "MANXI23").
// This matches the strict mode used by detectAssociationCode for email logging.
function hasExplicitAccountNumber(text: string, code: string): boolean {
  const upper   = text.toUpperCase()
  const escaped = code.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\d{1,3}\\b`).test(upper)
}

export async function POST(req: NextRequest) {
  let body: { dry_run?: boolean } = {}
  try { body = await req.json() } catch { /* ok */ }
  const dryRun = body.dry_run !== false  // default true for safety

  // Fetch all email_logs that currently have an association_code
  const PAGE = 500
  let offset = 0
  const toClean: string[] = []
  const toKeep:  string[] = []

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('email_logs')
      .select('id, association_code, subject, body_preview')
      .not('association_code', 'is', null)
      .range(offset, offset + PAGE - 1)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break

    for (const row of data as EmailRow[]) {
      const text = `${row.subject ?? ''} ${row.body_preview ?? ''}`
      if (hasExplicitAccountNumber(text, row.association_code)) {
        toKeep.push(row.id)
      } else {
        toClean.push(row.id)
      }
    }

    if (data.length < PAGE) break
    offset += PAGE
  }

  if (!dryRun && toClean.length > 0) {
    const BATCH = 100
    for (let i = 0; i < toClean.length; i += BATCH) {
      const batch = toClean.slice(i, i + BATCH)
      await supabaseAdmin
        .from('email_logs')
        .update({ association_code: null, updated_at: new Date().toISOString() })
        .in('id', batch)
    }
  }

  return NextResponse.json({
    ok:          true,
    dry_run:     dryRun,
    total_tagged: toClean.length + toKeep.length,
    kept:        toKeep.length,
    cleared:     toClean.length,
  })
}
