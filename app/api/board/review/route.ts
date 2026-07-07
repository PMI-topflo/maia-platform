// =====================================================================
// app/api/board/review/route.ts
// GET  ?token=XXX → validate token, return application + letter data
// POST            → submit decision (approve/reject), check threshold
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifySession, SESSION_COOKIE } from '@/lib/session';

interface Applicant {
  firstName?: string;
  lastName?: string;
  email?: string;
  [key: string]: unknown;
}

/** Everything both the real token path and the staff preview path need:
 *  signed document links, resolved governing-doc metadata, and linked
 *  collaborative stakeholders. Kept in one place so the two never drift. */
async function assembleBoardPackage(application: Record<string, unknown>, applicationId: string) {
  // 1. Documents — the stored values are private storage PATHS; sign them so
  //    the board can open each one (1-hour links).
  const docPaths: Record<string, string | null> = {
    govId:        (application.docs_gov_id_url as string | null)        ?? null,
    proofIncome:  (application.docs_proof_income_url as string | null)  ?? null,
    marriageCert: (application.docs_marriage_cert_url as string | null) ?? null,
    lease:        (application.docs_lease_url as string | null)         ?? null,
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
    .eq('detailed_application_id', applicationId)
    .maybeSingle();
  if (la) {
    const { data: sh } = await supabaseAdmin
      .from('application_stakeholders')
      .select('role, name, email, phone')
      .or(`application_id.eq.${la.id},listing_id.eq.${la.listing_id}`);
    stakeholders = sh ?? [];
  }

  // 4. Per-applicant Checkr status + report -- each applicant/principal has
  //    their own separate order, aligned by subject_index with the
  //    applicants/principals array order.
  const { data: subjectRows } = await supabaseAdmin
    .from('screening_subjects')
    .select('subject_index, name, status, report_url')
    .eq('application_id', applicationId)
    .order('subject_index', { ascending: true });
  const subjects = (subjectRows ?? []).map(s => ({ name: s.name as string | null, status: s.status as string | null, report_url: s.report_url as string | null }));

  return { documents, acknowledgedDocs, stakeholders, subjects };
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const previewId = req.nextUrl.searchParams.get('preview');

  // Staff preview -- lets staff see exactly what a board member sees,
  // without a real per-member token and without any way to submit a
  // decision through it.
  if (previewId) {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
    const session = sessionToken ? await verifySession(sessionToken) : null;
    if (!session || session.persona !== 'staff') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data: application, error: appError } = await supabaseAdmin
      .from('applications')
      .select('*')
      .eq('id', previewId)
      .single();
    if (appError || !application) {
      return NextResponse.json({ ok: false, error: 'Application not found' }, { status: 404 });
    }

    let associationCode: string | null = (application.association_code as string | null) ?? null;
    if (!associationCode && application.association) {
      const { data: assocRow } = await supabaseAdmin
        .from('associations')
        .select('association_code')
        .eq('association_name', application.association)
        .maybeSingle();
      associationCode = assocRow?.association_code ?? null;
    }

    const { data: config } = associationCode
      ? await supabaseAdmin.from('association_config').select('approval_letter_template').eq('association_code', associationCode).maybeSingle()
      : { data: null };

    const { documents, acknowledgedDocs, stakeholders, subjects } = await assembleBoardPackage(application, previewId);

    return NextResponse.json({
      ok: true,
      application,
      boardMember: { name: 'Staff Preview', email: '' },
      letterTemplate: config?.approval_letter_template ?? null,
      alreadyDecided: false,
      documents,
      acknowledgedDocs,
      stakeholders,
      subjects,
      preview: true,
    });
  }

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

  // A prior "more_info" request doesn't lock the token -- only a final
  // approved/rejected decision does.
  const alreadyDecided = review.decision === 'approved' || review.decision === 'rejected';

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

  const { documents, acknowledgedDocs, stakeholders, subjects } = await assembleBoardPackage(application, review.application_id);

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
    subjects,
    preview: false,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, decision, signature, notes } = body;

  if (!token || !decision) {
    return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
  }

  if (!['approved', 'rejected', 'more_info'].includes(decision)) {
    return NextResponse.json({ ok: false, error: 'Invalid decision' }, { status: 400 });
  }

  // "Request more info" is a lightweight comment channel, not a formal
  // sign-off -- free text instead of a signature.
  if (decision === 'more_info') {
    if (!notes?.trim()) {
      return NextResponse.json({ ok: false, error: 'Please describe what additional information is needed' }, { status: 400 });
    }
  } else if (!signature) {
    return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
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

  // A prior "more_info" request is non-final -- the same board member can
  // still come back and submit a real decision. Only a final approved/
  // rejected decision locks the token.
  if (review.decision === 'approved' || review.decision === 'rejected') {
    return NextResponse.json({ ok: false, error: 'Decision already submitted' }, { status: 409 });
  }

  // Save decision
  const { error: updateError } = await supabaseAdmin
    .from('application_board_reviews')
    .update({
      decision,
      signature: signature ?? null,
      notes: notes ?? null,
      decided_at: new Date().toISOString(),
    })
    .eq('token', token);

  if (updateError) {
    console.error('[board/review POST] update error', updateError);
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  // "Request more info" doesn't count toward the approval threshold -- it's
  // a side-channel back to staff, not a decision. Flag the application so
  // it's visible in the admin dashboard, notify staff with the free text,
  // and stop (no threshold/notification logic below applies to it).
  if (decision === 'more_info') {
    await supabaseAdmin
      .from('applications')
      .update({ board_decision: 'more_info_requested' })
      .eq('id', review.application_id)
      .neq('board_decision', 'approved')
      .neq('board_decision', 'rejected');

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? '';
    const refId = `PMI-${review.application_id.slice(0, 8).toUpperCase()}`;
    try {
      await fetch(`${appUrl}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'support@topfloridaproperties.com',
          subject: `Board requests more info — Ref ${refId}`,
          html: `<p><strong>${review.board_member_name}</strong> (${review.association_code}) requested more information on application <strong>${refId}</strong> before deciding:</p>
<blockquote style="border-left:3px solid #f26a1b;margin:12px 0;padding:8px 16px;color:#374151;">${(notes as string).replace(/\n/g, '<br>')}</blockquote>`,
        }),
      });
    } catch (e) {
      console.error('[board/review POST] more_info staff notification error', e);
    }

    return NextResponse.json({ ok: true, moreInfoRequested: true });
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
