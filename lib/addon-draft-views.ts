// =====================================================================
// lib/addon-draft-views.ts
//
// The Gmail add-on's Card UI has no clipboard-write API — the prior
// workaround (a multiline TextInput staff had to tap into and select by
// hand) wasn't discoverable enough. User direction, 2026-08-19 (asked
// twice): "there was not COPY button to copy and paste the Draft text."
//
// This is the handoff to a REAL webpage (app/addon/draft/[token]), opened
// via CardService's OpenLink so it runs as normal browser JS with full
// navigator.clipboard access. The token IS the credential — same model as
// every other public token-gated page in this app.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

/** Stash a drafted reply for the copy-page to serve. Returns the view
 *  token (null on failure — the caller still has the text itself for the
 *  TextInput fallback, so this is never fatal to the draft action). */
export async function saveDraftView(draftText: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('addon_draft_views').insert({ draft_text: draftText }).select('id').single()
  if (error || !data) return null
  return String(data.id)
}

export async function getDraftView(token: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('addon_draft_views').select('draft_text').eq('id', token).maybeSingle()
  return (data?.draft_text as string | null) ?? null
}
