// =====================================================================
// app/api/admin/applications/[id]/send-to-board/route.ts
// POST — send application to board members for review
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { APPLICATION_NOTIFY_CC, APPLICATION_REPLY_TO } from '@/lib/notify-recipients';

interface Applicant {
  firstName?: string;
  lastName?: string;
  email?: string;
  [key: string]: unknown;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const memberIdOverride: string[] | null = Array.isArray(body?.member_ids)
    ? body.member_ids.map(String).filter(Boolean)
    : null;

  // 1. Fetch the application
  const { data: app, error: appError } = await supabaseAdmin
    .from('applications')
    .select('*')
    .eq('id', id)
    .single();

  if (appError || !app) {
    console.error('[send-to-board] application not found', appError);
    return NextResponse.json({ ok: false, error: 'Application not found' }, { status: 404 });
  }

  // 2. Resolve association_code from the association name if needed
  let associationCode: string | null = app.association_code ?? null;
  const associationName: string = app.association ?? '';

  if (!associationCode && associationName) {
    const { data: assocRow } = await supabaseAdmin
      .from('associations')
      .select('association_code')
      .eq('association_name', associationName)
      .maybeSingle();
    associationCode = assocRow?.association_code ?? null;
  }

  if (!associationCode) {
    return NextResponse.json({ ok: false, error: 'Cannot determine association code' }, { status: 400 });
  }

  // 3. Fetch the configured committee (deciders + voters) for this purpose.
  // required_signatures (how many deciders must approve) is read by the
  // decision route (app/api/board/review/route.ts) at decision time, not
  // needed here — this route just sends to whoever is on the committee.
  const { data: committee, error: committeeError } = await supabaseAdmin
    .from('board_approval_members')
    .select('board_member_id, member_type, association_board_members(id, name, email, active, substitute_name, substitute_email, substitute_active)')
    .eq('association_code', associationCode)
    .eq('purpose', 'application');

  if (committeeError) {
    console.error('[send-to-board] committee fetch error', committeeError);
    return NextResponse.json({ ok: false, error: committeeError.message }, { status: 500 });
  }

  type CommitteeRow = {
    board_member_id: string;
    member_type: 'decider' | 'voter';
    association_board_members: {
      id: string; name: string; email: string; active: boolean;
      substitute_name: string | null; substitute_email: string | null; substitute_active: boolean;
    } | null;
  };

  let active = ((committee ?? []) as unknown as CommitteeRow[]).filter(c => c.association_board_members?.active);

  if (memberIdOverride && memberIdOverride.length > 0) {
    active = active.filter(c => memberIdOverride.includes(c.board_member_id));
  }

  if (active.length === 0) {
    return NextResponse.json({ ok: false, error: 'No committee configured for application approval on this association — set it up in Board Setup first' }, { status: 400 });
  }

  // 5. Resolve substitutes; keep the decider/voter type alongside each target
  const targets = active.map((c) => {
    const m = c.association_board_members!;
    return {
      name: m.substitute_active && m.substitute_name ? m.substitute_name : m.name,
      email: m.substitute_active && m.substitute_email ? m.substitute_email : m.email,
      memberType: c.member_type,
    };
  });

  // 6. Build applicant name for the email
  const applicants: Applicant[] = (app.applicants as Applicant[]) ?? [];
  const primaryApplicant = applicants[0];
  const applicantName =
    app.app_type === 'commercial' && app.entity_name
      ? app.entity_name
      : [primaryApplicant?.firstName, primaryApplicant?.lastName].filter(Boolean).join(' ') || 'Applicant';

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? '';
  const refId = `PMI-${id.slice(0, 8).toUpperCase()}`;
  const paymentStatus =
    app.stripe_payment_status === 'paid' || app.stripe_payment_status === 'succeeded'
      ? 'Confirmed'
      : app.stripe_payment_status ?? 'Pending';

  // 7. For each target, insert review row and send email
  let sent = 0;
  for (const target of targets) {
    const token = crypto.randomUUID();

    const { error: insertError } = await supabaseAdmin
      .from('application_board_reviews')
      .insert({
        application_id: id,
        association_code: associationCode,
        board_member_name: target.name,
        board_member_email: target.email,
        member_type: target.memberType,
        token,
      });

    if (insertError) {
      console.error('[send-to-board] insert review error', insertError);
      continue;
    }

    const reviewLink = `${appUrl}/board/review?token=${token}`;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 30px 0;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <div style="background: #0d0d0d; padding: 24px 32px;">
      <h1 style="color: #fff; margin: 0; font-size: 20px; font-weight: 700;">PMI Top Florida Properties</h1>
      <p style="color: #f26a1b; margin: 4px 0 0; font-size: 14px;">Board Review Required</p>
    </div>
    <div style="padding: 32px;">
      <p style="margin-top: 0;">Dear ${target.name},</p>
      <p>An application has been submitted for your review and approval. Please review the details below and click the button to submit your decision.</p>

      <table style="width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 14px;">
        <tr>
          <td style="padding: 8px 12px; background: #f9f9f9; font-weight: 600; width: 40%; border: 1px solid #eee;">Reference</td>
          <td style="padding: 8px 12px; border: 1px solid #eee;">${refId}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f9f9f9; font-weight: 600; border: 1px solid #eee;">Applicant</td>
          <td style="padding: 8px 12px; border: 1px solid #eee;">${applicantName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f9f9f9; font-weight: 600; border: 1px solid #eee;">Association</td>
          <td style="padding: 8px 12px; border: 1px solid #eee;">${associationName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f9f9f9; font-weight: 600; border: 1px solid #eee;">Application Type</td>
          <td style="padding: 8px 12px; border: 1px solid #eee;">${app.app_type ?? '—'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f9f9f9; font-weight: 600; border: 1px solid #eee;">Payment</td>
          <td style="padding: 8px 12px; border: 1px solid #eee;">${paymentStatus}</td>
        </tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${reviewLink}" style="display: inline-block; background: #f26a1b; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 700;">Review &amp; Sign Application</a>
      </div>

      <p style="font-size: 12px; color: #888; border-top: 1px solid #eee; padding-top: 16px; margin-bottom: 0;">
        This link is unique to you and should not be shared. If you did not expect this email, please contact <a href="mailto:support@topfloridaproperties.com" style="color: #f26a1b;">support@topfloridaproperties.com</a>.
      </p>
    </div>
  </div>
</body>
</html>`;

    try {
      await fetch(`${appUrl}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: target.email,
          bcc: APPLICATION_NOTIFY_CC,
          replyTo: APPLICATION_REPLY_TO,
          subject: `Board Review Required — ${associationName} · Ref ${refId}`,
          html,
          associationCode,
        }),
      });
      sent++;
    } catch (emailErr) {
      console.error('[send-to-board] email send error', emailErr);
    }
  }

  // 8. Update application to board_review status
  await supabaseAdmin
    .from('applications')
    .update({
      board_decision: 'board_review',
      board_decided_at: new Date().toISOString(),
    })
    .eq('id', id);

  return NextResponse.json({ ok: true, sent });
}
