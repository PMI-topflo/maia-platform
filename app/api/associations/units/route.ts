import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.json([], { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('owners')
    .select('unit_number')
    .eq('association_code', code)
    .not('unit_number', 'is', null)
    .order('unit_number')

  if (error) {
    console.error('[associations/units]', error)
    return NextResponse.json([], { status: 500 })
  }

  const units = [...new Set((data ?? []).map((r) => r.unit_number as string).filter(Boolean))].sort()
  return NextResponse.json(units)
}
