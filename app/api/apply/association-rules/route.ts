import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

export interface ApplicationRule {
  rule_key: string; value: unknown; label: string; enforcement: 'block' | 'warn'
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.json({ sections: [], applicationRules: [] })

  const [{ data: config }, { data: rules }] = await Promise.all([
    supabaseAdmin.from('association_config').select('rules_sections').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('association_application_rules').select('rule_key, value, label, enforcement')
      .eq('association_code', code).eq('active', true),
  ])

  return NextResponse.json({
    sections: (config?.rules_sections as string[] | null) ?? [],
    applicationRules: (rules ?? []) as ApplicationRule[],
  })
}
