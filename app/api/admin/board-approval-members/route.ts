// =====================================================================
// app/api/admin/board-approval-members/route.ts
// GET   ?code=XXX&purpose=application|invoice|estimate
//       → every active board member for the association, each tagged
//         with member_type ('decider' | 'voter' | null = not on committee)
// PATCH → replace the committee for (association_code, purpose) with
//         the given { board_member_id, member_type }[] set
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

  const [{ data: members, error: membersErr }, { data: committee, error: committeeErr }] = await Promise.all([
    supabaseAdmin
      .from('association_board_members')
      .select('id, name, email, role, sort_order, active')
      .eq('association_code', code)
      .eq('active', true)
      .order('sort_order', { ascending: true }),
    supabaseAdmin
      .from('board_approval_members')
      .select('board_member_id, member_type')
      .eq('association_code', code)
      .eq('purpose', purpose),
  ]);

  if (membersErr) {
    console.error('[board-approval-members/GET members]', membersErr);
    return NextResponse.json({ ok: false, error: membersErr.message }, { status: 500 });
  }
  if (committeeErr) {
    console.error('[board-approval-members/GET committee]', committeeErr);
    return NextResponse.json({ ok: false, error: committeeErr.message }, { status: 500 });
  }

  const typeByMemberId = new Map((committee ?? []).map(c => [c.board_member_id as string, c.member_type as string]));

  return NextResponse.json({
    ok: true,
    members: (members ?? []).map(m => ({
      ...m,
      member_type: typeByMemberId.get(m.id as string) ?? null,
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { association_code, purpose, members } = body as {
    association_code?: string;
    purpose?: string;
    members?: { board_member_id: string; member_type: 'decider' | 'voter' }[];
  };

  if (!association_code) {
    return NextResponse.json({ ok: false, error: 'Missing association_code' }, { status: 400 });
  }
  if (!isPurpose(purpose)) {
    return NextResponse.json({ ok: false, error: 'Missing or invalid purpose (application|invoice|estimate)' }, { status: 400 });
  }
  if (!Array.isArray(members)) {
    return NextResponse.json({ ok: false, error: 'Missing members array' }, { status: 400 });
  }

  // Replace the whole committee for this (association, purpose) in one
  // delete-then-insert — simpler and just as correct as a diff/upsert
  // since this is a small, staff-edited list, not a hot path.
  const { error: delErr } = await supabaseAdmin
    .from('board_approval_members')
    .delete()
    .eq('association_code', association_code)
    .eq('purpose', purpose);

  if (delErr) {
    console.error('[board-approval-members/PATCH delete]', delErr);
    return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
  }

  if (members.length > 0) {
    const rows = members.map(m => ({
      association_code,
      purpose,
      board_member_id: m.board_member_id,
      member_type: m.member_type,
    }));
    const { error: insErr } = await supabaseAdmin.from('board_approval_members').insert(rows);
    if (insErr) {
      console.error('[board-approval-members/PATCH insert]', insErr);
      return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
