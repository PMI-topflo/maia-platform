'use client'

// Static reference diagram of the tenant/buyer application pipeline —
// app/apply (5-step wizard, all 5 types) → Stripe checkout → Checkr
// background check (per applicant/principal) → staff Applications
// dashboard → Send to Board Review → board Approve/Reject/Request More
// Info + e-sign → consensus → applicant notified. Two steps are EXTERNAL
// (the applicant filling out /apply, and the board member reviewing +
// deciding) plus a real, easy-to-miss gap in the board-reject path is
// called out explicitly (see boardReject) since this is exactly the kind
// of thing a new team member would otherwise have to discover the hard
// way.
//
// app/apply/page.tsx + components/ApplicationForm.tsx,
// app/api/create-checkout-session, app/api/webhooks/stripe,
// app/api/trigger-screening, app/api/checkr-webhook,
// app/admin/applications/ApplicationsTable.tsx,
// app/api/admin/applications/[id]/{send-to-board,decision},
// app/board/review/*, lib/screening/*, lib/rules-acknowledgment-pdf.tsx,
// lib/intl-applicant-docs-content.ts + lib/intl-cpa-guide-pdf.tsx.
//
// This is a maintained snapshot, not auto-generated — update it alongside
// the code when the flow changes (see the Voice Flow diagram's history:
// it drifted twice already after menu changes).

import { useState } from 'react'
import { COLOR, Box, Diamond, Arrow, ArrowheadDefs, NodeModal, Legend, type NodeDoc } from './FlowDiagramKit'

const APPLICANT = '#1d4ed8'  // applicant steps (external)
const BOARD     = '#7c3aed'  // board-member steps (external)

const DOC: Record<string, NodeDoc> = {
  applyStart: {
    title: '🧑 Applicant — Upload Lease/Deed & Pick Type',
    lines: ['/apply — Step 0 (lease/purchase agreement, auto-read to identify the property) + Step 1 (application type).'],
    note: 'Five types: Individual, Married Couple, Additional Resident, Commercial Entity, and Canadian/International — all $150 (couple is $150 total WITH a marriage certificate, $150 each / $300 total without one). Available in 7 languages (EN/ES/PT/FR/HT/HE/RU), Hebrew rendered RTL.',
    source: 'app/apply/page.tsx + components/ApplicationForm.tsx (steps 0–1)',
    preview: {
      type: 'form', pageTitle: 'Apply — PMI Top Florida Properties',
      fields: [
        { label: 'Upload Your Lease or Purchase Agreement', kind: 'file', value: "We'll read it to identify your property automatically" },
        { label: 'Application Type', kind: 'readonly', value: '○ Individual   ○ Married Couple   ○ Additional Resident   ○ Commercial Entity   ○ Canadian / International' },
        { label: '', kind: 'button', value: 'Continue' },
      ],
    },
  },
  applicantInfo: {
    title: '🧑 Applicant — Applicant Info',
    lines: ['/apply — Step 2: per-applicant/principal name, DOB, SSN, unit applying for.'],
    note: 'One entry per applicant (individual/couple/additional resident) or per principal (commercial, which has no SSN field — principals identify by name/title instead).',
    source: 'components/ApplicationForm.tsx (step 2)',
  },
  docsConsent: {
    title: '🧑 Applicant — Documents + Rules E-Sign',
    lines: ['/apply — Step 3: per-applicant Gov ID + Proof of Income uploads, plus reading and e-signing the Rules & Regulations.'],
    note: 'Gov ID/Proof of Income are PER-PERSON (not one shared upload for the whole application, shipped 2026-07-07) — uploaded directly to the public application-docs bucket client-side. Applicant must open every governing-document category (embedded PDF viewer) and click "I have read this document" before the signature field enables; captures a typed or drawn signature, a photo, and an audit trail (IP + geolocation).',
    source: 'components/ApplicationForm.tsx (step 3, uploadDoc() + rules e-sign block)',
    preview: {
      type: 'form', pageTitle: 'Documents + Consent — PMI Top Florida Properties',
      fields: [
        { label: 'Government-Issued ID — Jane Applicant', kind: 'file', value: 'Upload' },
        { label: 'Proof of Income — Jane Applicant', kind: 'file', value: 'Upload' },
        { label: '✍ Rules & Regulations', kind: 'readonly', value: 'I have read and agree to abide by the Rules and Regulations of Galleria Village Homeowners Association, Inc.' },
        { label: 'Your signature', kind: 'signature', value: 'Jane Applicant' },
        { label: '', kind: 'button', value: 'Continue to Payment' },
      ],
    },
  },
  intlCpa: {
    title: '🧑 Applicant — International: CPA Financial Certification',
    lines: ['Additional documents section — only shown when the application type is Canadian/International.'],
    note: 'Every applicant runs the same domestic Checkr Essential check; when a US credit/financial report is unavailable because the applicant lives abroad, they instead submit a Financial Certification prepared by a CPA/CA/licensed accountant in their home country (on letterhead, license #, seal, figures in local currency + USD equivalent). A downloadable requirements PDF (same content module as the in-app copy) is offered to hand to the accountant, in all 7 languages — Hebrew uses a bundled font since react-pdf\'s default Helvetica is Latin-1-only.',
    source: 'lib/intl-applicant-docs-content.ts (copy) + lib/intl-cpa-guide-pdf.tsx + app/api/apply/intl-cpa-guide/route.ts',
    preview: {
      type: 'form', pageTitle: 'Additional documents for international applicants',
      fields: [
        { label: 'Foreign police clearance certificate / criminal record', kind: 'file' },
        { label: 'CPA Financial Certification', kind: 'file' },
        { label: 'Notarized English translation (if any document above is in a foreign language)', kind: 'file' },
        { label: '', kind: 'button', value: 'Download CPA requirements (PDF) — send this to your accountant' },
      ],
    },
  },
  payment: {
    title: '🧑 Applicant — Payment (Stripe Checkout)',
    lines: ['/apply — Step 4: price breakdown, redirect to Stripe Checkout.'],
    note: 'One Stripe Checkout Session per application type (price IDs from env), metadata carries applicationId/applicationType/association/lang. success_url routes back to /apply/success with a PMI-XXXXXXXX reference; cancel_url returns to /apply.',
    source: 'app/api/create-checkout-session/route.ts',
    preview: {
      type: 'form', pageTitle: 'Payment — PMI Top Florida Properties',
      fields: [
        { label: 'Application fee', kind: 'readonly', value: '$150.00' },
        { label: '', kind: 'button', value: 'Pay with card →' },
      ],
    },
  },
  stripeWebhook: {
    title: '⚙️ MAIA — Payment Confirmed',
    lines: ['checkout.session.completed webhook.'],
    note: 'Marks applications.stripe_payment_status = \'paid\' + stripe_session_id/stripe_amount_paid, fires POST /api/trigger-screening (internal, x-internal-secret header) to start the Checkr orders, and sends TWO emails: the applicant confirmation below, plus an internal "[New Application] {association} · {ref}" notice to support@topfloridaproperties.com.',
    source: 'app/api/webhooks/stripe/route.ts',
    preview: {
      type: 'email', to: 'applicant@example.com',
      subject: 'Application Received — Galleria Village Homeowners Association, Inc. · PMI-A1B2C3D4',
      html: `<p>Dear Applicant,</p>
        <p>Your application for <strong>Galleria Village Homeowners Association, Inc.</strong> has been received.</p>
        <p><strong>Reference:</strong> PMI-A1B2C3D4<br><strong>Amount Paid:</strong> $150.00</p>
        <p>The board will review within 7-10 business days.</p>
        <p style="font-size:12px;color:#6b7280">PMI Top Florida Properties | (305) 900-5077 · WhatsApp (786) 686-3223</p>`,
    },
  },
  checkrOrder: {
    title: '⚙️ MAIA — Create Checkr Orders',
    lines: ['One background-check order per applicant/principal, created in parallel.'],
    note: 'Requires stripe_payment_status = \'paid\'. Builds a Checkr Subject per person + the association\'s street address, calls screening.createOrder() for each, and upserts one screening_subjects row per person (unique on application_id + subject_index). Rolls up applications.screening_status/screening_provider.',
    source: 'app/api/trigger-screening/route.ts + lib/screening/checkr.ts',
  },
  checkrWebhook: {
    title: '⚙️ MAIA — Checkr Status Updates',
    lines: ['Webhook fires as each candidate/report stage completes.'],
    note: 'Verifies the Tenant-Signature HMAC header, silently 200s Checkr\'s dashboard connectivity probe (empty body, no signature), ignores report.product.completed events (no order_id), and re-fetches the authoritative status via GET /orders/{id} — the webhook payload itself has no status field. Updates screening_subjects.status/result/completed_at, stores + links the report PDF once available, and rolls the aggregate onto applications.',
    source: 'app/api/checkr-webhook/route.ts + lib/screening/report-storage.ts',
  },
  staffDashboard: {
    title: '🧰 Staff — Applications Dashboard',
    lines: ['Per-applicant panel: Checkr status badge, Gov ID / Proof of Income, background report — plus the signed Rules Acknowledgment.'],
    note: 'Every document link here (Gov ID, Proof of Income, the Checkr report, the signed Rules Acknowledgment) pops up as an inline image instead of downloading a PDF (shipped 2026-07-08) — PDFs are rasterised server-side, images pass through, with a small "Download" fallback inside the popup. Also has a "👁 Preview Board View" button (renders the actual board page read-only) before anything is sent.',
    source: 'app/admin/applications/ApplicationsTable.tsx + /api/document-preview + rules-acknowledgment-pdf?preview=1',
  },
  sendToBoard: {
    title: '🧰 Staff — Send to Board Review',
    lines: ['Manual button click — not automatic.'],
    note: 'Reads association_config.required_signatures, targets active association_board_members (ordered, with substitute resolution), caps to the required count, inserts one application_board_reviews row per targeted member with its own token, and emails each one a review link.',
    source: 'app/api/admin/applications/[id]/send-to-board/route.ts',
    preview: {
      type: 'email', to: 'board.president@example.com',
      subject: 'Board Review Required — Galleria Village Homeowners Association, Inc. · Ref PMI-A1B2C3D4',
      html: `<p>Dear Test President,</p>
        <p>An application has been submitted for your review and approval. Please review the details below and click the button to submit your decision.</p>
        <table style="border-collapse:collapse;margin:14px 0;font-size:13px">
          <tr><td style="padding:4px 10px;color:#6b7280">Reference</td><td style="padding:4px 10px">PMI-A1B2C3D4</td></tr>
          <tr><td style="padding:4px 10px;color:#6b7280">Applicant</td><td style="padding:4px 10px">Jane Applicant</td></tr>
          <tr><td style="padding:4px 10px;color:#6b7280">Association</td><td style="padding:4px 10px">Galleria Village Homeowners Association, Inc.</td></tr>
          <tr><td style="padding:4px 10px;color:#6b7280">Application Type</td><td style="padding:4px 10px">Individual</td></tr>
          <tr><td style="padding:4px 10px;color:#6b7280">Payment</td><td style="padding:4px 10px">$150.00 paid</td></tr>
        </table>
        <p><a href="#" style="display:inline-block;background:#f26a1b;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700">Review &amp; Sign Application →</a></p>
        <p style="font-size:12px;color:#6b7280">This link is unique to you and should not be shared. If you did not expect this email, please contact support@topfloridaproperties.com.</p>`,
    },
  },
  boardReview: {
    title: '🏛️ Board — Reviews & Decides',
    lines: ['EXTERNAL — public, token-scoped page. Applicants + their docs, background report, rules acknowledgment, and the approval-letter template all shown inline.'],
    note: 'Every document link on this page (Gov ID, Proof of Income, the background report, the signed Rules Acknowledgment) pops up as an inline image rather than downloading (same /api/document-preview mechanism as the staff dashboard, shipped 2026-07-08). Staff can open the identical page read-only via a "Preview Board View" link (?preview=<id> instead of a real token).',
    source: 'app/board/review/page.tsx + app/api/board/review/route.ts',
    preview: {
      type: 'form', pageTitle: 'Board Review — PMI Top Florida Properties',
      fields: [
        { label: 'Reference / Applicant / Association / Type / Payment', kind: 'readonly', value: 'Ref PMI-A1B2C3D4 · Jane Applicant · Galleria Village HOA · Individual · $150.00 paid' },
        { label: '', kind: 'button', value: '✓ Approve' },
        { label: '', kind: 'button', value: '✗ Reject' },
        { label: '', kind: 'button', value: '? Request More Info' },
      ],
    },
  },
  boardDecision: {
    title: 'Approve, Reject, or Request More Info?',
    note: 'Three-way routing decision per signer, made on the same POST handler.',
    source: 'app/api/board/review/route.ts POST',
  },
  moreInfo: {
    title: '🏛️ Board — Request More Info',
    lines: ['Free-text notes.'],
    note: 'Does NOT lock this signer\'s token — sets applications.board_decision = \'more_info_requested\' and emails support@topfloridaproperties.com quoting the notes, but the signer can return later and still approve or reject.',
    source: "app/api/board/review/route.ts — decision === 'more_info'",
  },
  boardReject: {
    title: '🏛️ Board — Reject',
    note: 'A real, easy-to-miss gap: this records decision=\'rejected\' + the signer\'s signature on THIS signer\'s own application_board_reviews row only. There is no code path here that sets applications.board_decision=\'rejected\' or notifies anyone from a single reject vote — the applicant is only ever told "not approved" through the separate staff-side Final Decision step below.',
    source: "app/api/board/review/route.ts — decision === 'rejected' (no downstream propagation)",
  },
  boardApprove: {
    title: '🏛️ Board — Approve & E-Sign',
    lines: ['Typed full-legal-name signature (not drawn, unlike the applicant\'s rules-ack signature pad).'],
    note: 'Records decision=\'approved\' + signature + decided_at on this signer\'s row.',
    source: "app/api/board/review/route.ts — decision === 'approved'",
    preview: {
      type: 'form', pageTitle: 'Board Review — Electronic Signature',
      fields: [
        { label: 'Electronic Signature', kind: 'text' },
        { label: '', kind: 'readonly', value: 'Type your full legal name to sign this decision' },
        { label: '', kind: 'button', value: 'Submit decision' },
      ],
    },
  },
  consensusCheck: {
    title: 'Enough Approvals? (≥ required_signatures)',
    note: 'Counts application_board_reviews rows with decision=\'approved\' for this application, compares to association_config.required_signatures (default 1).',
    source: 'app/api/board/review/route.ts — thresholdMet check',
  },
  pendingConsensus: {
    title: '⏳ Pending — Awaiting More Signers',
    note: 'applications.board_decision stays \'board_review\' until enough signers approve.',
    source: "applications.board_decision = 'board_review'",
  },
  boardThresholdEmail: {
    title: '⚙️ MAIA — Threshold Met → Auto-Notify',
    lines: ['Sets applications.board_decision = \'approved\'.'],
    note: 'Emails staff ("Application Approved — {applicant} · {ref}") AND the applicant directly, automatically — no staff action needed. This is one of TWO independent approval-email paths in the codebase (see Final Decision below); both can fire for the same approval, worded slightly differently.',
    source: 'app/board/review/route.ts — thresholdMet branch',
    preview: {
      type: 'email', to: 'applicant@example.com',
      subject: 'Your application for Galleria Village Homeowners Association, Inc. has been approved',
      html: `<p>We are pleased to inform you that your application for Galleria Village Homeowners Association, Inc. (Ref: PMI-A1B2C3D4) has been reviewed and approved by the board. Welcome to the community.</p>
        <p>A member of our team will be in touch shortly with next steps.</p>`,
    },
  },
  staffFinalDecision: {
    title: '🧰 Staff — Final Decision',
    lines: ['Decision dropdown + notes on the Applications dashboard — can be set at any time, independent of the board-threshold auto-email above.'],
    note: 'PATCH updates applications.board_decision/board_decided_at/board_notes. For approved/rejected it sends its OWN, differently-worded email to the applicant — a second, independently-triggered notification path. This is the ONLY path that ever notifies a rejected applicant, since a lone board "Reject" vote alone does not (see boardReject).',
    source: 'app/api/admin/applications/[id]/decision/route.ts + ApplicationsTable.tsx handleSave()',
    preview: {
      type: 'email', to: 'applicant@example.com',
      subject: 'Application update — Galleria Village Homeowners Association, Inc.',
      html: `<p>Dear Jane,</p><p>Your application for <strong>Galleria Village Homeowners Association, Inc.</strong> has been reviewed. Unfortunately the board has decided not to proceed at this time.</p><p>PMI Top Florida Properties</p>`,
    },
  },
  applicantApproved: {
    title: '✅ Applicant — Approved / Welcome',
    lines: ['Fed by EITHER the auto board-threshold email OR staff\'s manual "approved" decision — both notify the applicant, worded slightly differently.'],
    note: 'Nothing further for the applicant to do at this stage — the outstanding backlog item is turning this into a real signed approval-letter PDF (currently template text on the board page) as part of a combined document package.',
    source: 'applications.board_decision = \'approved\'',
  },
  applicantRejected: {
    title: 'Applicant — Not Selected',
    lines: ['Fed ONLY by staff\'s manual Final Decision step.'],
    note: 'A board member\'s individual "Reject" vote alone never reaches the applicant — see boardReject\'s note. This is the one and only path that actually tells a rejected applicant.',
    source: 'applications.board_decision = \'rejected\'',
  },
}

export default function ApplicationProcessFlowDiagram() {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div style={{ overflowX: 'auto', background: COLOR.bg, borderRadius: 8, padding: '1rem' }}>
      <svg viewBox="-40 0 1150 2340" width="100%" style={{ minWidth: 940, display: 'block' }} xmlns="http://www.w3.org/2000/svg">
        <ArrowheadDefs />

        {/* Row 1 — applicant starts the form (external) */}
        <Box x={370} y={16} w={340} h={90} title="🧑 Applicant — Upload Lease/Deed & Pick Type" fill="#eff6ff" stroke={APPLICANT}
          lines={['5 types · 7 languages']}
          nodeKey="applyStart" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,106 L540,146" />

        <Box x={380} y={146} w={320} h={70} title="🧑 Applicant — Applicant Info" fill="#eff6ff" stroke={APPLICANT}
          nodeKey="applicantInfo" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,216 L540,256" />

        {/* Row 3 — docs + rules e-sign, with the international CPA side branch */}
        <Box x={350} y={256} w={380} h={110} title="🧑 Applicant — Documents + Rules E-Sign" fill="#eff6ff" stroke={APPLICANT}
          lines={['Per-applicant Gov ID / Proof of Income', '+ e-sign the Rules & Regulations']}
          nodeKey="docsConsent" onSelect={setSelected} doc={DOC} />
        <Arrow path="M730,290 L860,300" dashed label="if international type" labelX={735} labelY={278} />
        <Box x={860} y={270} w={260} h={100} title="🧑 International — CPA Certification" fill="#eff6ff" stroke={APPLICANT}
          lines={['Optional docs +', 'downloadable requirements PDF']}
          nodeKey="intlCpa" onSelect={setSelected} doc={DOC} />
        <Arrow path="M990,370 L700,406" dashed />
        <Arrow path="M540,366 L540,406" />

        {/* Row 4 — payment */}
        <Box x={380} y={406} w={320} h={80} title="🧑 Applicant — Payment (Stripe Checkout)" fill="#eff6ff" stroke={APPLICANT}
          nodeKey="payment" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,486 L540,526" />

        {/* Row 5 — Stripe webhook */}
        <Box x={350} y={526} w={380} h={120} title="⚙️ MAIA — Payment Confirmed" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          lines={['Applicant + internal-team email,', 'kicks off Checkr']}
          nodeKey="stripeWebhook" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,646 L540,690" />

        {/* Row 6-7 — Checkr order + webhook */}
        <Box x={370} y={690} w={340} h={90} title="⚙️ MAIA — Create Checkr Orders" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          lines={['One order per applicant/principal']}
          nodeKey="checkrOrder" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,780 L540,820" />

        <Box x={370} y={820} w={340} h={90} title="⚙️ MAIA — Checkr Status Updates" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          lines={['Webhook, per subject']}
          nodeKey="checkrWebhook" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,910 L540,950" />

        {/* Row 8 — staff dashboard */}
        <Box x={350} y={950} w={380} h={100} title="🧰 Staff — Applications Dashboard" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          lines={['Per-applicant status + docs —', 'preview pops an image, no download']}
          nodeKey="staffDashboard" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,1050 L540,1090" />

        {/* Row 9 — send to board */}
        <Box x={370} y={1090} w={340} h={80} title="🧰 Staff — Send to Board Review" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          nodeKey="sendToBoard" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,1170 L540,1210" />

        {/* Row 10 — board reviews (external) */}
        <Box x={350} y={1210} w={380} h={100} title="🏛️ Board — Reviews & Decides" fill="#faf5ff" stroke={BOARD}
          lines={['Every doc previewed inline —', 'no download needed here either']}
          nodeKey="boardReview" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,1310 L540,1350" />

        {/* Row 11 — three-way decision */}
        <Diamond x={390} y={1350} w={300} h={110} label={['Approve, Reject, or', 'Request More Info?']}
          nodeKey="boardDecision" onSelect={setSelected} doc={DOC} />
        <Arrow path="M390,1405 L170,1405 L170,1500" label="more info" labelX={195} labelY={1398} />
        <Arrow path="M540,1460 L480,1500" label="reject" labelX={545} labelY={1478} />
        <Arrow path="M690,1405 L830,1405 L830,1500" label="approve" labelX={715} labelY={1398} />

        <Box x={40} y={1500} w={260} h={90} title="🏛️ Board — Request More Info" fill="#faf5ff" stroke={BOARD}
          lines={['Free text — token stays open']}
          nodeKey="moreInfo" onSelect={setSelected} doc={DOC} />
        <Arrow path="M170,1500 L170,1170 L560,1210" dashed label="signer returns later" labelX={180} labelY={1340} />

        <Box x={350} y={1500} w={260} h={90} title="🏛️ Board — Reject" fill="#faf5ff" stroke={BOARD}
          lines={['This signer\'s row only']}
          nodeKey="boardReject" onSelect={setSelected} doc={DOC} />
        <Arrow path="M480,1590 L60,1590 L60,1980 L380,1980" dashed label="no auto follow-through — only staff finalizes a reject" labelX={65} labelY={1760} />

        <Box x={700} y={1500} w={280} h={100} title="🏛️ Board — Approve & E-Sign" fill="#faf5ff" stroke={BOARD}
          lines={['Typed full-legal-name signature']}
          nodeKey="boardApprove" onSelect={setSelected} doc={DOC} />
        <Arrow path="M840,1600 L840,1640" />

        {/* Row 12 — consensus */}
        <Diamond x={700} y={1640} w={280} h={100} label={['Enough approvals?', '(≥ required_signatures)']}
          nodeKey="consensusCheck" onSelect={setSelected} doc={DOC} />
        <Arrow path="M700,1690 L420,1690 L420,1780" label="not yet" labelX={430} labelY={1683} />
        <Arrow path="M980,1690 L970,1780" label="yes" labelX={985} labelY={1683} />

        <Box x={290} y={1780} w={260} h={80} title="⏳ Pending — Awaiting More Signers" fill={COLOR.card} stroke={COLOR.border}
          nodeKey="pendingConsensus" onSelect={setSelected} doc={DOC} />
        <Arrow path="M420,1780 L420,1160 L550,1210" dashed label="next signer decides" labelX={430} labelY={1500} />

        <Box x={820} y={1780} w={300} h={100} title="⚙️ MAIA — Threshold Met → Auto-Notify" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          lines={['Emails staff + applicant, no', 'staff action needed']}
          nodeKey="boardThresholdEmail" onSelect={setSelected} doc={DOC} />
        <Arrow path="M970,1880 L620,2010" label="auto-approved" labelX={760} labelY={1960} />

        {/* Row 13 — independent staff step */}
        <Box x={350} y={1950} w={420} h={110} title="🧰 Staff — Final Decision" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          lines={['Independent manual step — dashboard', 'dropdown, any time']}
          nodeKey="staffFinalDecision" onSelect={setSelected} doc={DOC} />
        <Arrow path="M730,1010 L1080,1010 L1080,1955 L800,1955" dashed label="staff can decide any time — independent of board" labelX={1000} labelY={1450} />
        <Arrow path="M550,2060 L540,2100" label="approved" labelX={555} labelY={2085} />
        <Arrow path="M650,2060 L870,2100" label="rejected" labelX={700} labelY={2085} />

        {/* Row 14 — terminal */}
        <Box x={380} y={2100} w={320} h={100} title="✅ Applicant — Approved / Welcome" fill="#f0fdf4" stroke={COLOR.green}
          nodeKey="applicantApproved" onSelect={setSelected} doc={DOC} />
        <Box x={760} y={2100} w={300} h={100} title="Applicant — Not Selected" fill="#f0fdf4" stroke={COLOR.green}
          nodeKey="applicantRejected" onSelect={setSelected} doc={DOC} />

        {/* Legend */}
        <Legend x={20} y={2260} extra={
          <>
            <rect x={470} y={-14} width={14} height={14} rx={3} fill="#eff6ff" stroke={APPLICANT} />
            <text x={490} y={-3} fontSize={11} fill={COLOR.muted}>Applicant (external)</text>
            <rect x={650} y={-14} width={14} height={14} rx={3} fill="#faf5ff" stroke={BOARD} />
            <text x={670} y={-3} fontSize={11} fill={COLOR.muted}>Board (external)</text>
          </>
        } />
        <text x={20} y={2290} fontSize={11} fill={COLOR.muted}>🧑 blue border = applicant (external) · 🏛️ purple border = board member (external) · 🧰 = staff · ⚙️ = MAIA itself.</text>
      </svg>

      {selected && <NodeModal nodeKey={selected} doc={DOC} onClose={() => setSelected(null)} />}
    </div>
  )
}
