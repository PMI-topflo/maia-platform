import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/auth/gmail-staff/disconnect  { gmail_address: "..." }
export async function POST(req: NextRequest) {
  const { gmail_address } = await req.json() as { gmail_address?: string }
  if (!gmail_address) return NextResponse.json({ error: 'gmail_address required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('staff_gmail_accounts')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('gmail_address', gmail_address)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
