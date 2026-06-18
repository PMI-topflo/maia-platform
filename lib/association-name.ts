// =====================================================================
// lib/association-name.ts
// Resolve an association's friendly NAME from its code, for vendor- and
// board-facing emails. Every vendor email about a work order must name the
// association it's for. Falls back to the code, then null.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

export async function getAssociationName(code: string | null | undefined): Promise<string | null> {
  const c = (code ?? '').trim()
  if (!c) return null
  const { data } = await supabaseAdmin
    .from('associations').select('association_name').eq('association_code', c).maybeSingle()
  return ((data?.association_name as string | null)?.trim()) || c
}
