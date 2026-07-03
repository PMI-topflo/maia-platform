'use client'

// Static reference diagram of the estimate request → vendor quotes → board
// comparison → e-sign approval flow (app/api/admin/work-orders/[id]/estimate-*,
// app/api/board/estimate/*, lib/estimate-approval-pdf.ts). Rebuilt 2026-07-03
// to a "board-picks" model — staff no longer pre-select a single vendor;
// they send the WHOLE comparison and each board signer independently picks
// which vendor they approve. The two EXTERNAL parties in this flow — the
// vendor and the board member — are called out explicitly since this is the
// flow most worth walking a new team member through.
//
// This is a maintained snapshot, not auto-generated — update it alongside
// the code when the flow changes (see the Voice Flow diagram's history:
// it drifted twice already after menu changes).

import { useState } from 'react'
import { COLOR, Box, Diamond, Arrow, ArrowheadDefs, NodeModal, Legend, type NodeDoc } from './FlowDiagramKit'

const BOARD = '#7c3aed'   // board-member steps (external)
const VENDOR = '#0d9488'  // vendor steps (external)

const DOC: Record<string, NodeDoc> = {
  createRequest: {
    title: '🧰 Staff — Request Estimates',
    lines: ['Staff open a work order, describe the scope, attach photos, and pick which vendors to invite.'],
    note: 'Creates one estimate_requests row (scope + photos) and one estimate_request_vendors row per invited vendor (status \'sent\'). Each vendor gets their own tokenized link.',
    source: 'app/api/admin/work-orders/[id]/estimate-request/route.ts',
  },
  vendorInvite: {
    title: '🔧 Vendor — Tokenized Invite',
    lines: ['Each invited vendor gets an emailed link (no login) to a page showing the scope, photos, and a respond-by date.'],
    note: 'EXTERNAL step. The vendor never sees MAIA\'s admin — just a public, token-scoped page for this one RFQ.',
    source: 'app/api/vendor/estimate/[token]/route.ts',
  },
  vendorAccepts: {
    title: 'Vendor accepts the invite?',
    note: 'Routing decision only. A vendor can Accept (status → \'accepted\', they\'ll submit a quote) or Decline (status → \'declined\', drops out of the comparison).',
    source: 'estimate_request_vendors.status',
  },
  vendorDeclined: {
    title: 'Declined',
    note: 'This vendor is excluded from the comparison staff eventually send to the board. No further action.',
    source: 'estimate_request_vendors.status = \'declined\'',
  },
  vendorSubmits: {
    title: '🔧 Vendor — Submits Estimate',
    lines: ['Vendor uploads their quote (PDF or photo) and enters the amount, on the same tokenized page.'],
    note: 'EXTERNAL step. Sets status → \'submitted\', extracted_amount, estimate_summary, estimate_path (→ work_order_attachments). A weekly cron chases vendors who haven\'t responded yet — see the followup note on this node\'s source.',
    source: 'app/api/vendor/estimate/[token]/route.ts + api/cron/estimate-followups',
  },
  staffCompare: {
    title: '🧰 Staff — Compare Estimates',
    lines: ['Every submitted quote shown side-by-side with an inline preview (PDF pages rendered as images — no download needed).'],
    note: 'Staff can optionally flag ONE vendor as "recommended" (the board sees this highlighted but is free to pick someone else) and choose which board members must sign.',
    source: 'app/admin/tickets/[id]/components/EstimatesComparison.tsx + lib/estimate-preview.ts',
  },
  staffSend: {
    title: '🧰 Staff — Send Comparison to Board',
    note: 'Creates ONE estimate_approvals row for the whole comparison (vendor_request_id stays NULL — nobody\'s picked yet) + one estimate_approval_reviews row per chosen signer, each with its own unique token. Emails each signer a review link.',
    source: 'app/api/admin/work-orders/[id]/send-estimate-to-board/route.ts',
  },
  boardReview: {
    title: '🏛️ Board — Reviews the Comparison',
    lines: ['Each signer opens their own link and sees every vendor\'s amount, scope, and estimate rendered inline — the staff recommendation and the lowest bid are both flagged.'],
    note: 'EXTERNAL step. Signers decide independently — two board members can (and sometimes do) pick different vendors.',
    source: 'app/board/estimate/EstimateApprovalClient.tsx',
  },
  boardDecision: {
    title: 'Approve or request revision?',
    note: 'Routing decision per signer. "Request revision" reverts the WHOLE approval (not just this signer\'s vote) — staff re-work the comparison and resend.',
    source: 'app/api/board/estimate/route.ts POST',
  },
  boardRevision: {
    title: '🏛️ Board — Revision Requested',
    lines: ['Signer leaves a comment on what needs to change.'],
    note: 'Sets estimate_approvals.status = \'revision_requested\'; emails Paola + logs an internal note. Staff address the feedback and send a fresh comparison (loops back to "Compare Estimates").',
    source: 'app/api/board/estimate/route.ts — decision === \'revision\'',
  },
  boardApprove: {
    title: '🏛️ Board — Approve & E-Sign',
    lines: ['Signer picks ONE vendor from the comparison, then signs (draws a new signature or reuses their saved one).'],
    note: 'EXTERNAL step. Records THIS signer\'s pick on estimate_approval_reviews.selected_vendor_request_id — it does NOT touch the approval\'s own vendor fields yet.',
    source: 'app/api/board/estimate/route.ts — decision === \'approve\'',
  },
  consensusCheck: {
    title: 'Enough signers picked the SAME vendor?',
    note: 'Counts approve-decisions for the specific vendor THIS signer just picked, and compares to estimate_approvals.required. Signers who disagree simply never push the same vendor over the threshold — nothing times out, it just stays pending until enough of them align.',
    source: 'app/api/board/estimate/route.ts — count query scoped to selected_vendor_request_id',
  },
  pendingConsensus: {
    title: '⏳ Pending — Awaiting Consensus',
    lines: ['Still waiting on more signers, or on signers to agree with each other.'],
    note: 'The approval row stays vendor_request_id = NULL. Staff can see the live tally (N/required signed) on the work order.',
    source: 'estimate_approvals.status = \'pending\'',
  },
  finalize: {
    title: '⚙️ MAIA — Finalize & File',
    lines: ['Stamps the winning vendor/amount onto the approval, builds an official signed PDF (the estimate + a Board Approval page with every agreeing signer\'s name, title, date, and signature), files it, and pushes it to the CINC work order.'],
    note: 'Best-effort — a PDF/CINC hiccup is caught and emailed to Paola instead of blocking the approval itself. Also closes the estimate_requests row so the weekly vendor-followup cron stops chasing.',
    source: 'lib/estimate-approval-pdf.ts finalizeEstimateApproval()',
  },
  vendorAwarded: {
    title: '🔧 Vendor — Awarded',
    lines: ['"Congratulations, you\'ve been selected" email with the signed copy.'],
    note: 'EXTERNAL. Also auto-checks the winning vendor\'s CINC compliance (ACH/W-9/COI/license) and requests anything missing via a deep-linked portal tab — before the work can be paid.',
    source: 'lib/estimate-approval-pdf.ts — award branch',
  },
  vendorNotSelected: {
    title: '🔧 Vendor — Not Selected',
    lines: ['"Thank you for quoting — we selected another vendor" email.'],
    note: 'EXTERNAL. Sets outcome = \'lost\' on every other submitted vendor so they\'re not chased by the followup cron either.',
    source: 'lib/estimate-approval-pdf.ts — loser-notification branch',
  },
  notifyBoardStaff: {
    title: '🏛️ Board + 🧰 Staff — Notified',
    lines: ['Signed copy download link + internal note on the work order.'],
    note: 'The work order shows "Board approved" with the final vendor/amount and signer count.',
    source: 'lib/estimate-approval-pdf.ts — board/Paola notification',
  },
}

export default function EstimateApprovalFlowDiagram() {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div style={{ overflowX: 'auto', background: COLOR.bg, borderRadius: 8, padding: '1rem' }}>
      <svg viewBox="-40 0 1150 1700" width="100%" style={{ minWidth: 940, display: 'block' }} xmlns="http://www.w3.org/2000/svg">
        <ArrowheadDefs />

        {/* Row 1 — staff kicks it off */}
        <Box x={370} y={16} w={340} h={70} title="🧰 Staff — Request Estimates"
          lines={['Scope + photos + invited vendors']}
          fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          nodeKey="createRequest" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,86 L540,130" />

        {/* Row 2 — vendor invited (external) */}
        <Box x={400} y={130} w={280} h={80} title="🔧 Vendor — Tokenized Invite" fill="#f0fdfa" stroke={VENDOR}
          lines={['No login — public,', 'token-scoped RFQ page']}
          nodeKey="vendorInvite" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,210 L540,250" />

        {/* Row 3 — accept/decline branch */}
        <Diamond x={420} y={250} w={240} h={90} label={['Vendor accepts', 'the invite?']}
          nodeKey="vendorAccepts" onSelect={setSelected} doc={DOC} />
        <Arrow path="M420,295 L160,295 L160,360" label="declines" labelX={185} labelY={288} />
        <Arrow path="M660,295 L900,295 L900,360" label="accepts" labelX={780} labelY={288} />

        <Box x={40} y={360} w={220} h={70} title="Declined" fill={COLOR.card} stroke={COLOR.border}
          nodeKey="vendorDeclined" onSelect={setSelected} doc={DOC} />
        <Box x={770} y={360} w={260} h={90} title="🔧 Vendor — Submits Estimate" fill="#f0fdfa" stroke={VENDOR}
          lines={['Amount + file/photo', '+ short summary']}
          nodeKey="vendorSubmits" onSelect={setSelected} doc={DOC} />
        <Arrow path="M900,450 L620,530" />
        <Arrow path="M150,430 L500,530" dashed label="(excluded from comparison)" labelX={160} labelY={470} />

        {/* Row 4 — staff compares (convergence point across all invited vendors) */}
        <Box x={380} y={530} w={340} h={100} title="🧰 Staff — Compare Estimates" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          lines={['Inline previews · optional', '"recommend" flag · pick signers']}
          nodeKey="staffCompare" onSelect={setSelected} doc={DOC} />
        <Arrow path="M550,630 L550,670" />

        <Box x={380} y={670} w={340} h={70} title="🧰 Staff — Send Comparison to Board" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          nodeKey="staffSend" onSelect={setSelected} doc={DOC} />
        <Arrow path="M550,740 L550,780" />

        {/* Row 5 — board reviews (external) */}
        <Box x={370} y={780} w={360} h={90} title="🏛️ Board — Reviews the Comparison" fill="#faf5ff" stroke={BOARD}
          lines={['Every vendor shown inline —', 'recommendation + lowest bid flagged']}
          nodeKey="boardReview" onSelect={setSelected} doc={DOC} />
        <Arrow path="M550,870 L550,910" />

        <Diamond x={420} y={910} w={260} h={90} label={['Approve or', 'request revision?']}
          nodeKey="boardDecision" onSelect={setSelected} doc={DOC} />
        <Arrow path="M420,955 L160,955 L160,1020" label="revision" labelX={190} labelY={948} />
        <Arrow path="M680,955 L920,955 L920,1020" label="approve" labelX={790} labelY={948} />

        <Box x={40} y={1020} w={240} h={90} title="🏛️ Board — Revision Requested" fill="#faf5ff" stroke={BOARD}
          lines={['Comment on what', 'needs to change']}
          nodeKey="boardRevision" onSelect={setSelected} doc={DOC} />
        <Arrow path="M160,1020 L160,700 L560,670" dashed label="staff re-works & resends" labelX={170} labelY={850} />

        <Box x={790} y={1020} w={260} h={90} title="🏛️ Board — Approve & E-Sign" fill="#faf5ff" stroke={BOARD}
          lines={['Picks ONE vendor,', 'signs (drawn or saved)']}
          nodeKey="boardApprove" onSelect={setSelected} doc={DOC} />
        <Arrow path="M900,1110 L700,1170" />

        {/* Row 6 — consensus check */}
        <Diamond x={480} y={1170} w={280} h={100} label={['Enough signers picked', 'the SAME vendor?']}
          nodeKey="consensusCheck" onSelect={setSelected} doc={DOC} />
        <Arrow path="M480,1220 L200,1220 L200,1280" label="not yet" labelX={220} labelY={1213} />
        <Arrow path="M760,1220 L900,1280" label="yes" labelX={800} labelY={1213} />

        <Box x={60} y={1280} w={260} h={80} title="⏳ Pending — Awaiting Consensus" fill={COLOR.card} stroke={COLOR.border}
          nodeKey="pendingConsensus" onSelect={setSelected} doc={DOC} />
        <Arrow path="M190,1280 L190,950 L900,955" dashed label="next signer decides" labelX={210} labelY={1100} />

        <Box x={780} y={1280} w={300} h={110} title="⚙️ MAIA — Finalize & File" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          lines={['Stamp winner · signed PDF', '+ signatures · file · push CINC']}
          nodeKey="finalize" onSelect={setSelected} doc={DOC} />
        <Arrow path="M850,1390 L400,1470" />
        <Arrow path="M930,1390 L930,1470" />
        <Arrow path="M1000,1390 L700,1470" />

        {/* Row 7 — terminal outcomes */}
        <Box x={40} y={1470} w={300} h={110} title="🔧 Vendor (winner) — Awarded" fill="#f0fdf4" stroke={COLOR.green}
          lines={['Award email + auto-checks/', 'requests missing compliance docs']}
          nodeKey="vendorAwarded" onSelect={setSelected} doc={DOC} />
        <Box x={380} y={1470} w={280} h={110} title="🔧 Vendor(s) — Not Selected" fill="#f0fdf4" stroke={COLOR.green}
          lines={['"Thank you for quoting"', '— outcome = lost']}
          nodeKey="vendorNotSelected" onSelect={setSelected} doc={DOC} />
        <Box x={700} y={1470} w={300} h={110} title="🏛️ Board + 🧰 Staff — Notified" fill="#f0fdf4" stroke={COLOR.green}
          lines={['Signed copy link +', 'internal note on the WO']}
          nodeKey="notifyBoardStaff" onSelect={setSelected} doc={DOC} />

        {/* Legend */}
        <Legend x={20} y={1650} extra={
          <>
            <rect x={470} y={-14} width={14} height={14} rx={3} fill="#f0fdfa" stroke={VENDOR} />
            <text x={490} y={-3} fontSize={11} fill={COLOR.muted}>Vendor (external)</text>
          </>
        } />
        <text x={20} y={1680} fontSize={11} fill={COLOR.muted}>🏛️ purple border = board member (external) · 🔧 teal border = vendor (external) · 🧰 = staff · ⚙️ = MAIA itself.</text>
      </svg>

      {selected && <NodeModal nodeKey={selected} doc={DOC} onClose={() => setSelected(null)} />}
    </div>
  )
}
