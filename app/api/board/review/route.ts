// =====================================================================
// app/api/board/review/route.ts
// GET  ?token=XXX → validate token, return application + letter data
// POST            → submit decision (approve/reject), check threshold
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface Applicant {
  firstName?: string;
  lastName?: string;
  email?: string;
  [key: string]: unknown;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Missing token' }, { status: 400 });
  }

  // Look up the review row
  const { data: review, error: reviewError } = await supabaseAdmin
    .from('application_board_reviews')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (reviewError) {
    console.error('[board/review GET]', reviewError);
    return NextResponse.json({ ok: false, error: reviewError.message }, { status: 500 });
  }

  if (!review) {
    return NextResponse.json({ ok: false, error: 'Invalid or expired token' }, { status: 404 });
  }

  const alreadyDecided = !!review.decision;

  // Fetch the application
  const { data: application, error: appError } = await supabaseAdmin
    .from('applications')
    .select('*')
    .eq('id', review.application_id)
    .single();

  if (appError || !application) {
    return NextResponse.json({ ok: false, error: 'Application not found' }, { status: 404 });
  }

  // Fetch approval letter template from association_config
  const { data: config } = await supabaseAdmin
    .from('association_config')
    .select('approval_letter_template')
    .eq('association_code', review.association_code)
    .maybeSingle();

  const letterTemplate = config?.approval_letter_template ?? null;

  // ── Assemble the full board package ──────────────────────────────────
  // 1. Documents — the stored values are private storage PATHS; sign them so
  //    the board can open each one (1-hour links).
  const docPaths: Record<string, string | null> = {
    govId:        application.docs_gov_id_url        ?? null,
    proofIncome:  application.docs_proof_income_url  ?? null,
    marriageCert: application.docs_marriage_cert_url ?? null,
    lease:        application.docs_lease_url         ?? null,
  };
  const documents: Record<string, string | null> = {};
  for (const [k, path] of Object.entries(docPaths)) {
    if (!path) { documents[k] = null; continue; }
    // Already a full URL (legacy rows)? pass through; else sign the path.
    if (/^https?:\/\//i.test(path)) { documents[k] = path; continue; }
    const { data: signed } = await supabaseAdmin.storage
      .from('application-docs')
      .createSignedUrl(path, 60 * 60);
    documents[k] = signed?.signedUrl ?? null;
  }

  // 2. Acknowledged governing documents — resolve the ids to names/dates.
  let acknowledgedDocs: { id: string; filename: string | null; category: string | null; effective_date: string | null }[] = [];
  const ackIds = (application.acknowledged_document_ids as string[] | null) ?? [];
  if (ackIds.length > 0) {
    const { data: docs } = await supabaseAdmin
      .from('association_documents')
      .select('id, filename, category, effective_date')
      .in('id', ackIds);
    acknowledgedDocs = docs ?? [];
  }

  // 3. Collaborative stakeholders — if this detailed application is linked to a
  //    listing application, surface everyone involved (listing agent, owner,
  //    applicant's agent, applicants).
  let stakeholders: { role: string; name: string | null; email: string | null; phone: string | null }[] = [];
  const { data: la } = await supabaseAdmin
    .from('listing_applications')
    .select('id, listing_id')
    .eq('detailed_application_id', review.application_id)
    .maybeSingle();
  if (la) {
    const { data: sh } = await supabaseAdmin
      .from('application_stakeholders')
      .select('role, name, email, phone')
      .or(`application_id.eq.${la.id},listing_id.eq.${la.listing_id}`);
    stakeholders = sh ?? [];
  }

  return NextResponse.json({
    ok: true,
    application,
    boardMember: {
      name: review.board_member_name,
      email: review.board_member_email,
    },
    letterTemplate,
    alreadyDecided,
    documents,
    acknowledgedDocs,
    stakeholders,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, decision, signature, notes } = body;

  if (!token || !decision || !signature) {
    return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
  }

  if (!['approved', 'rejected'].includes(decision)) {
    return NextResponse.json({ ok: false, error: 'Invalid decision' }, { status: 400 });
  }

  // Validate and fetch review
  const { data: review, error: reviewError } = await supabaseAdmin
    .from('application_board_reviews')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (reviewError || !review) {
    return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 404 });
  }

  if (review.decision) {
    return NextResponse.json({ ok: false, error: 'Decision already submitted' }, { status: 409 });
  }

  // Save decision
  const { error: updateError } = await supabaseAdmin
    .from('application_board_reviews')
    .update({
      decision,
      signature,
      notes: notes ?? null,
      decided_at: new Date().toISOString(),
    })
    .eq('token', token);

  if (updateError) {
    console.error('[board/review POST] update error', updateError);
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  // Fetch association config for required_signatures threshold
  const { data: config } = await supabaseAdmin
    .from('association_config')
    .select('required_signatures')
    .eq('association_code', review.association_code)
    .maybeSingle();

  const requiredSignatures: number = config?.required_signatures ?? 1;

  // Count approved decisions for this application
  const { count: approvedCount } = await supabaseAdmin
    .from('application_board_reviews')
    .select('id', { count: 'exact', head: true })
    .eq('application_id', review.application_id)
    .eq('decision', 'approved');

  const totalApproved = approvedCount ?? 0;
  const thresholdMet = totalApproved >= requiredSignatures;

  if (thresholdMet) {
    // Update application to approved
    await supabaseAdmin
      .from('applications')
      .update({
        board_decision: 'approved',
        board_decided_at: new Date().toISOString(),
      })
      .eq('id', review.application_id);

    // Fetch application for notification details
    const { data: application } = await supabaseAdmin
      .from('applications')
      .select('*')
      .eq('id', review.application_id)
      .single();

    if (application) {
      const applicants: Applicant[] = (application.applicants as Applicant[]) ?? [];
      const primaryApplicant = applicants[0];
      const applicantName =
        application.app_type === 'commercial' && application.entity_name
          ? application.entity_name
          : [primaryApplicant?.firstName, primaryApplicant?.lastName].filter(Boolean).join(' ') || 'Applicant';

      const associationName = application.association ?? 'the community';
      const refId = `PMI-${review.application_id.slice(0, 8).toUpperCase()}`;
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? '';

      // Notify staff
      const staffHtml = `
<p>The board has approved application <strong>${refId}</strong>.</p>
<p><strong>Applicant:</strong> ${applicantName}<br>
<strong>Association:</strong> ${associationName}<br>
<strong>Approved by:</strong> ${review.board_member_name} (${totalApproved}/${requiredSignatures} signatures)</p>
<p>The application status has been updated to Approved.</p>`;

      try {
        await fetch(`${appUrl}/api/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: 'support@topfloridaproperties.com',
            subject: `Application Approved — ${applicantName} · ${refId}`,
            html: staffHtml,
          }),
        });
      } catch (e) {
        console.error('[board/review POST] staff notification error', e);
      }

      // Notify applicant
      if (primaryApplicant?.email) {
        const applicantHtml = `
<p>Dear ${primaryApplicant.firstName ?? 'Applicant'},</p>
<p>We are pleased to inform you that your application for <strong>${associationName}</strong> (Ref: ${refId}) has been reviewed and approved by the board.</p>
<p>Welcome to the community. A member of our team will be in touch shortly with next steps.</p>
<p>PMI Top Florida Properties<br>
<a href="mailto:support@topfloridaproperties.com">support@topfloridaproperties.com</a></p>`;

        try {
          await fetch(`${appUrl}/api/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: primaryApplicant.email,
              subject: `Your application for ${associationName} has been approved`,
              html: applicantHtml,
            }),
          });
        } catch (e) {
          console.error('[board/review POST] applicant notification error', e);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, thresholdMet, approvedCount: totalApproved });
}
