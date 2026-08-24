// =====================================================================
// app/api/admin/board-members/[id]/route.ts
// PATCH → update board member fields
// DELETE → soft-delete (set active = false)
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const allowed = [
    'name',
    'email',
    'role',
    'sort_order',
    'active',
    'substitute_name',
    'substitute_email',
    'substitute_active',
    'email_locked',
  ];

  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('association_board_members')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[board-members/[id]/PATCH]', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, member: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { error } = await supabaseAdmin
    .from('association_board_members')
    .update({ active: false })
    .eq('id', id);

  if (error) {
    console.error('[board-members/[id]/DELETE]', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
