import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET /api/admin/gmail-accounts  – returns connected staff Gmail accounts (no tokens)
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('staff_gmail_accounts')
    .select('id, gmail_address, display_name, active, watch_expiry, connected_by, created_at')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ accounts: data ?? [] })
}
