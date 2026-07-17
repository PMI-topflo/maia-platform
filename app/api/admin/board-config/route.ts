// =====================================================================
// app/api/admin/board-config/route.ts
// GET   ?code=XXX&purpose=application|invoice|estimate
//       → required_signatures + approval_letter_template + reminder_cadence
// PATCH → upsert board_approval_config for (association_code, purpose)
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const PURPOSES = ['application', 'invoice', 'estimate'] as const;
type Purpose = (typeof PURPOSES)[number];

function isPurpose(v: unknown): v is Purpose {
  return typeof v === 'string' && (PURPOSES as readonly string[]).includes(v);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const purpose = req.nextUrl.searchParams.get('purpose');
  if (!code) {
    return NextResponse.json({ ok: false, error: 'Missing code' }, { status: 400 });
  }
  if (!isPurpose(purpose)) {
    return NextResponse.json({ ok: false, error: 'Missing or invalid purpose (application|invoice|estimate)' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('board_approval_config')
    .select('required_signatures, approval_letter_template, reminder_cadence')
    .eq('association_code', code)
    .eq('purpose', purpose)
    .maybeSingle();

  if (error) {
    console.error('[board-config/GET]', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    required_signatures: data?.required_signatures ?? 1,
    approval_letter_template: data?.approval_letter_template ?? null,
    reminder_cadence: data?.reminder_cadence ?? 'off',
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { association_code, purpose, required_signatures, approval_letter_template, reminder_cadence } = body;

  if (!association_code) {
    return NextResponse.json({ ok: false, error: 'Missing association_code' }, { status: 400 });
  }
  if (!isPurpose(purpose)) {
    return NextResponse.json({ ok: false, error: 'Missing or invalid purpose (application|invoice|estimate)' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { association_code, purpose };
  if (required_signatures !== undefined) patch.required_signatures = required_signatures;
  if (approval_letter_template !== undefined) patch.approval_letter_template = approval_letter_template;
  if (reminder_cadence !== undefined) patch.reminder_cadence = reminder_cadence;

  const { error } = await supabaseAdmin
    .from('board_approval_config')
    .upsert(patch, { onConflict: 'association_code,purpose' });

  if (error) {
    console.error('[board-config/PATCH]', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
