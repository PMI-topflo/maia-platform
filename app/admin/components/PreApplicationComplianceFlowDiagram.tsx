'use client'

// Reference diagram of the PLANNED Pre-Application Compliance flow — the
// verified-intake front end that precedes the existing Application Process
// (Checkr background check + board). One link for tenant/buyer/agent →
// self-ID → pick type → per-type document checklist → e-sign forms with a
// verified signature → PMI+Jonathan audit → on-site-manager/board pre-approval
// → into MAIA + Checkr → BOARD FINAL approval → Drive folder archived +
// compliance filed. Click any box for the actual page/form the person sees.
//
// NOT YET BUILT — this is a design reference (design + schema artifact
// 2cff34de-…). Built on application_stakeholders + Checkr + the generalized
// lease-packet e-sign engine + association_document_requirements. Update it
// alongside the code as the flow ships. See memory pre_application_compliance.

import { useState } from 'react'
import { COLOR, Box, Diamond, Arrow, ArrowheadDefs, NodeModal, Legend, type NodeDoc } from './FlowDiagramKit'

const APPLICANT = '#1d4ed8'  // applicant / buyer (external)
const AGENT     = '#0f766e'  // real-estate agent (external)
const BOARD     = '#7c3aed'  // on-site manager / board
const TEAL      = '#0f766e'

const DOC: Record<string, NodeDoc> = {
  invite: {
    title: '✉️ Staff — Send Pre-Application Link',
    lines: ['One link, sent to a prospective tenant, buyer, or their agent.'],
    note: 'Staff, on-site manager, or board send a single login-free intake link. Anyone the link reaches identifies themselves; an agent is kept in the loop with a status link. Reuses the application_stakeholders foundation (roles: applicant / applicant_agent / listing_agent / owner).',
    source: 'PLANNED — new intake entry point on top of application_stakeholders',
    preview: {
      type: 'email', to: 'prospect@example.com',
      subject: 'Apply to The Manors of Inverrary XI — start your pre-application',
      html: `<p>Hello,</p>
        <p>You've been invited to start a pre-application for <strong>The Manors of Inverrary XI</strong>. You can apply yourself, or add your real estate agent so they can help.</p>
        <p><a href="#" style="display:inline-block;background:#f26a1b;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:700">Start pre-application →</a></p>
        <p style="font-size:12px;color:#6b7280">No account needed. PMI Top Florida Properties</p>`,
    },
  },
  selfId: {
    title: '🧑 Applicant / Agent — Identify Yourself',
    lines: ['Name, contact, and role — apply yourself or add your agent.'],
    note: 'Each party self-identifies. Choosing "agent" opens the agent branch (listing agreement + credentials). Writes an application_stakeholders row with the role + contact used later for the verified signature (email + phone).',
    source: 'PLANNED — /pre-application (self-identify step)',
    preview: {
      type: 'form', pageTitle: 'Tell us who you are',
      fields: [
        { label: 'Full legal name', kind: 'text', value: 'Yuhao Zhou' },
        { label: 'Email', kind: 'text', value: 'yuhao.zhou@example.com' },
        { label: 'Mobile (for a text or WhatsApp code)', kind: 'text', value: '+1 954 555 0142' },
        { label: 'I am the', kind: 'readonly', value: '○ Tenant   ○ Buyer   ○ Real-estate agent' },
        { label: '', kind: 'button', value: 'Continue' },
      ],
    },
  },
  agent: {
    title: '🤝 Agent — Listing Agreement + Credentials',
    lines: ['Upload the listing agreement + license; get a status link.'],
    note: 'When an agent is involved, they upload the listing agreement and their credentials and receive a status link to track the stages and see what documents are still missing — so they can help their applicant or the unit owner they represent.',
    source: 'PLANNED — agent branch (application_stakeholders role = listing_agent / applicant_agent)',
    preview: {
      type: 'form', pageTitle: 'Agent details',
      fields: [
        { label: 'Listing agreement', kind: 'file', value: 'Upload' },
        { label: 'Real-estate license #', kind: 'text', value: 'SL3491027' },
        { label: 'Brokerage', kind: 'text', value: 'Coastal Realty Group' },
        { label: '', kind: 'readonly', value: "You'll get a private status link to follow this application and see missing documents." },
        { label: '', kind: 'button', value: 'Save & continue' },
      ],
    },
  },
  pickType: {
    title: 'Which application type?',
    note: 'Lease · Purchase · Lease Renewal · Additional Occupant. The document checklist differs by type; the property rules are shown for all. Additional Occupant adds the age branch.',
    source: 'PLANNED — application.type (lease | purchase | renewal | addl_occupant)',
  },
  occupantAge: {
    title: 'Additional occupant — 18 or older?',
    note: 'For an additional occupant, the flow first asks whether it is for a current approved lease or a new lease, then each occupant\'s age. 18+ is screened as an additional occupant (Tenant Evaluation today, Checkr later); under 18 is recorded as name + age only, no check.',
    source: 'PLANNED — additional-occupant sub-flow',
  },
  checklist: {
    title: '📋 Applicant — Pre-Application Checklist',
    lines: ['Documents by type. Tax return is validated (not a W-2).'],
    note: 'Per-type document list (reconciled against the Manors XI slides). Renter/Lease shown here; Buyer, Renewal, and Additional Occupant have their own lists. Some items are the landlord\'s (property insurance, certificate of use). The rules layer (occupancy, income, no trust/LLC, credit → estoppel) is shown and acknowledged, not blocked. Per-association thresholds live in association settings, not hard-coded.',
    source: 'PLANNED — reuses association_document_requirements (per-association, occupancy-filtered)',
    preview: {
      type: 'form', pageTitle: 'Documents needed — Lease',
      fields: [
        { label: 'Signed lease agreement', kind: 'file', value: 'Upload' },
        { label: "Driver's license", kind: 'file', value: 'Upload' },
        { label: 'Car registration', kind: 'file', value: 'Upload' },
        { label: 'Last 2 tax returns (a tax return, not a W-2)', kind: 'file', value: 'Upload' },
        { label: 'Vehicle insurance', kind: 'file', value: 'Upload' },
        { label: 'Landlord email address', kind: 'text', value: 'owner@example.com' },
        { label: 'From your landlord: property insurance + certificate of use', kind: 'readonly', value: 'Owner HO policy (not renters) · Lauderhill certificate of use' },
        { label: '', kind: 'button', value: 'Continue to signing' },
      ],
    },
  },
  esign: {
    title: '✍️ Applicant + Owner — E-Sign Forms',
    lines: ['Landlord–Tenant Agreement, Board Decision, Pet (if a pet).'],
    note: 'All signable forms run through one engine (the generalized lease-packet e-sign flow). The Board Decision Page is e-signed with no notary. The Pet Registration is filled + e-signed and also offered as a downloadable blank PDF. Each signer signs with a verified identity (next step).',
    source: 'PLANNED — generalized lease_packets e-sign engine',
    preview: {
      type: 'form', pageTitle: 'Review & sign — Unit MANXI910',
      fields: [
        { label: 'Landlord–Tenant Agreement', kind: 'readonly', value: 'I have read and agree to abide by the Governing Documents of The Manors of Inverrary XI Condominium Association, Inc.' },
        { label: 'Board Decision acknowledgment', kind: 'readonly', value: 'I agree to be governed by the determination of the Board of Directors.' },
        { label: 'Your signature', kind: 'signature', value: 'Yuhao Zhou' },
        { label: '', kind: 'button', value: 'Verify & sign' },
      ],
    },
  },
  verified: {
    title: '🔒 Verified Signature',
    lines: ['Email code + phone code (text / WhatsApp) + location.'],
    note: 'Before a signature is recorded: a one-time code to the signer\'s email AND a code to their phone (SMS text or WhatsApp — WhatsApp for international applicants), plus device + location captured with consent. All surfaced on the signed PDF as a verification certificate the board can see. Reuses the OTP infra + the apply-form geolocation pattern.',
    source: 'PLANNED — verification layer (rate-limit OTP + WhatsApp template + geolocation)',
    preview: {
      type: 'form', pageTitle: "Confirm it's you",
      fields: [
        { label: 'Code sent to y•••@example.com', kind: 'text', value: '4 8 2 1' },
        { label: 'Code sent to +1 •••-•••-0142 (text or WhatsApp)', kind: 'text', value: '9 0 3 6' },
        { label: 'Location at signing', kind: 'readonly', value: '📍 Share my location (with consent) — recorded on the certificate' },
        { label: '', kind: 'button', value: 'Confirm & sign' },
      ],
    },
  },
  audit: {
    title: '🧰 Gate 1a — Audit (PMI + Jonathan)',
    lines: ['Everything is audited before it enters MAIA.'],
    note: 'PMI and Jonathan review the submitted documents + signatures before anything is populated into MAIA. Anything missing or incorrect goes back to the applicant/agent. This is the first of two gates — it clears the applicant to proceed to the background check.',
    source: 'PLANNED — audit queue (staff-only)',
    preview: {
      type: 'form', pageTitle: 'Audit — MANXI910 · Yuhao Zhou (Lease)',
      fields: [
        { label: 'Documents', kind: 'readonly', value: '✓ Lease  ✓ ID  ✓ Car reg  ✓ Tax returns (verified: tax return)  ✓ Vehicle insurance' },
        { label: 'Signatures', kind: 'readonly', value: '✓ Agreement (verified: email + WhatsApp + location)  ✓ Decision page' },
        { label: '', kind: 'button', value: 'Looks good — send to pre-approval' },
      ],
    },
  },
  preApproval: {
    title: '🏛️ Gate 1b — Pre-Approval (Manager or Board)',
    lines: ['On-site manager OR board — either can approve. Sees balance + ledger.'],
    note: 'The on-site manager or the board pre-approves (either can). The board also sees the unit\'s account balance + ledger here. This clears the applicant into MAIA and the background check. NOT the final decision — that comes after the check.',
    source: 'PLANNED — pre-approval step (units-portal auth: manager / board)',
    preview: {
      type: 'form', pageTitle: 'Pre-approval — MANXI910',
      fields: [
        { label: 'Account balance', kind: 'readonly', value: '$0.00 — current' },
        { label: 'Ledger', kind: 'readonly', value: 'View recent activity →' },
        { label: '', kind: 'button', value: 'Pre-approve' },
        { label: '', kind: 'button', value: 'Return for changes' },
      ],
    },
  },
  populate: {
    title: '⚙️ MAIA — Populate + Background Check',
    lines: ['Records into MAIA · kicks off the background check (18+).'],
    note: 'Once pre-approved, MAIA populates the unit records and runs the background check for each 18+ subject. Tenant Evaluation today; the MAIA + Checkr system we built takes over later. FROM HERE the existing Application Process flow continues (payment, Checkr status, board review).',
    source: 'PLANNED → joins app/api/trigger-screening + the Application Process flow',
  },
  boardFinal: {
    title: 'Gate 2 — Board FINAL approval?',
    note: 'After the background check, the board makes the actual application decision. Only THIS gate moves the Drive folder to the OLD/Archive and files the unit\'s compliance records. The folder stays in "On Going" the whole time until then.',
    source: 'PLANNED — board final decision',
  },
  approved: {
    title: '✅ Approved — Archived + Compliance Filed',
    lines: ['Drive folder → OLD/Archive · compliance records filed.'],
    note: 'On the board\'s final approval, the On Going folder (MANXI###/YYYY_MM_applicant) is merged into the unit\'s existing "MANXI### Last File <year>" folder in the OLD/Archive, and the unit\'s compliance items are filed (e.g. the e-signed Landlord–Tenant Agreement, expiry = lease end).',
    source: 'PLANNED — reuses the Organize On Going / archive move + compliance_records',
  },
  denied: {
    title: 'Not Approved — Applicant + Agent Notified',
    lines: ['Recorded; applicant and agent are told.'],
    note: 'A denied application is recorded and the applicant (and their agent, if any) is notified. The folder is not archived.',
    source: 'PLANNED — final notification',
  },
}

export default function PreApplicationComplianceFlowDiagram() {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <div style={{ overflowX: 'auto', background: COLOR.bg, borderRadius: 8, padding: '1rem' }}>
      <svg viewBox="-40 0 1150 1780" width="100%" style={{ minWidth: 940, display: 'block' }} xmlns="http://www.w3.org/2000/svg">
        <ArrowheadDefs />

        <Box x={360} y={16} w={360} h={80} title="✉️ Staff — Send Pre-Application Link" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          lines={['One link → tenant, buyer, or agent']} nodeKey="invite" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,96 L540,136" />

        <Box x={380} y={136} w={320} h={80} title="🧑 Identify Yourself" fill="#eff6ff" stroke={APPLICANT}
          lines={['Name · contact · role']} nodeKey="selfId" onSelect={setSelected} doc={DOC} />
        <Arrow path="M700,176 L840,180" dashed label="if agent" labelX={740} labelY={168} />
        <Box x={840} y={140} w={270} h={90} title="🤝 Agent — Listing + Credentials" fill="#ecfdf5" stroke={AGENT}
          lines={['+ status link']} nodeKey="agent" onSelect={setSelected} doc={DOC} />
        <Arrow path="M975,230 L700,262" dashed />
        <Arrow path="M540,216 L540,256" />

        <Diamond x={400} y={256} w={280} h={100} label={['Which', 'application type?']} nodeKey="pickType" onSelect={setSelected} doc={DOC} />
        <Arrow path="M680,306 L780,306" dashed label="additional occupant" labelX={690} labelY={298} />
        <Diamond x={780} y={260} w={250} h={92} label={['Additional occupant', '18 or older?']} nodeKey="occupantAge" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,356 L540,396" />

        <Box x={350} y={396} w={380} h={100} title="📋 Pre-Application Checklist" fill="#eff6ff" stroke={APPLICANT}
          lines={['Documents by type', 'tax return validated (not a W-2)']} nodeKey="checklist" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,496 L540,536" />

        <Box x={360} y={536} w={360} h={90} title="✍️ E-Sign Forms" fill="#eff6ff" stroke={APPLICANT}
          lines={['Agreement + Decision Page + Pet']} nodeKey="esign" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,626 L540,666" />

        <Box x={360} y={666} w={360} h={90} title="🔒 Verified Signature" fill="#ecfdf5" stroke={TEAL}
          lines={['Email + phone code (text/WhatsApp) + location']} nodeKey="verified" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,756 L540,796" />

        <Diamond x={390} y={796} w={300} h={110} label={['Gate 1a — Audit', 'PMI + Jonathan']} nodeKey="audit" onSelect={setSelected} doc={DOC} />
        <Arrow path="M390,851 L120,851 L120,566 L360,566" dashed label="missing / incorrect" labelX={130} labelY={710} />
        <Arrow path="M540,906 L540,946" label="clean" labelX={550} labelY={928} />

        <Box x={370} y={946} w={340} h={90} title="🏛️ Gate 1b — Pre-Approval" fill="#faf5ff" stroke={BOARD}
          lines={['Manager OR board · sees balance + ledger']} nodeKey="preApproval" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,1036 L540,1076" />

        <Box x={350} y={1076} w={380} h={90} title="⚙️ MAIA — Populate + Background Check" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          lines={['→ continues to the Application Process flow']} nodeKey="populate" onSelect={setSelected} doc={DOC} />
        <Arrow path="M540,1166 L540,1206" />

        <Diamond x={390} y={1206} w={300} h={100} label={['Gate 2 — Board', 'FINAL approval?']} nodeKey="boardFinal" onSelect={setSelected} doc={DOC} />
        <Arrow path="M440,1306 L495,1356" label="approved" labelX={430} labelY={1338} />
        <Arrow path="M640,1306 L820,1356" label="denied" labelX={700} labelY={1330} />

        <Box x={330} y={1356} w={340} h={90} title="✅ Approved — Archived + Compliance" fill="#f0fdf4" stroke={COLOR.green}
          lines={['Folder → OLD/Archive · compliance filed']} nodeKey="approved" onSelect={setSelected} doc={DOC} />
        <Box x={720} y={1356} w={300} h={90} title="Not Approved — Notified" fill="#f0fdf4" stroke={COLOR.green}
          lines={['Applicant + agent told']} nodeKey="denied" onSelect={setSelected} doc={DOC} />

        <Legend x={20} y={1560} extra={
          <>
            <rect x={470} y={-14} width={14} height={14} rx={3} fill="#eff6ff" stroke={APPLICANT} />
            <text x={490} y={-3} fontSize={11} fill={COLOR.muted}>Applicant</text>
            <rect x={585} y={-14} width={14} height={14} rx={3} fill="#ecfdf5" stroke={AGENT} />
            <text x={605} y={-3} fontSize={11} fill={COLOR.muted}>Agent / verify</text>
            <rect x={710} y={-14} width={14} height={14} rx={3} fill="#faf5ff" stroke={BOARD} />
            <text x={730} y={-3} fontSize={11} fill={COLOR.muted}>Manager / board</text>
          </>
        } />
        <text x={20} y={1590} fontSize={11} fill={COLOR.muted}>Two gates: 1) PMI + Jonathan audit &amp; manager/board pre-approval → clears to the background check · 2) board FINAL approval → archives the folder + files compliance.</text>
        <text x={20} y={1610} fontSize={11} fill={COLOR.muted}>⚠️ Planned flow — not yet built. Click any box for the page/form the person sees.</text>
      </svg>

      {selected && <NodeModal nodeKey={selected} doc={DOC} onClose={() => setSelected(null)} />}
    </div>
  )
}
