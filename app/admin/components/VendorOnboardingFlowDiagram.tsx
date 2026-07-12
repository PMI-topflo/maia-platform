'use client'

// Static reference diagram of the vendor onboarding flow (staff dedupe-check
// + create/link a CINC vendor → token-scoped self-service portal → W-9/COI/
// license auto-applied to CINC, ACH held for a staff fraud-control confirm).
// app/api/admin/vendors/onboard/route.ts, app/vendor/onboard/[token]/*,
// app/api/vendor/onboard/[token]/*, app/api/admin/vendors/onboarding/*.
//
// This is a maintained snapshot, not auto-generated — update it alongside
// the code when the flow changes (see the Voice Flow diagram's history:
// it drifted twice already after menu changes).
//
// Reviewed 2026-07-07: no drift found — nothing has touched the vendor
// onboarding routes/pages since this diagram was built (2026-07-03).

import { useState } from 'react'
import { COLOR, Box, Arrow, ArrowheadDefs, NodeModal, Legend, type NodeDoc } from './FlowDiagramKit'

const VENDOR = '#0d9488'  // vendor steps (external)
const GATE   = '#b45309'  // fraud-control checkpoint (amber)

const DOC: Record<string, NodeDoc> = {
  staffCreate: {
    title: '🧰 Staff — Check Duplicates & Create/Link Vendor',
    lines: ['"+ Onboard new vendor" on an association\'s Vendors tab (OnboardVendorModal).'],
    note: 'action=\'check\' searches ALL 600+ CINC vendors by name/DBA/email/phone/address before creating, so Paola never duplicates one. action=\'create\' makes a brand-new CINC vendor; action=\'link\' starts tracking against an EXISTING CINC vendor instead (gap-fill missing docs on a vendor CINC already has). "License required" is a checkbox here — it decides whether the License card even shows on the vendor\'s portal.',
    source: 'app/api/admin/vendors/onboard/route.ts + components/OnboardVendorModal.tsx',
  },
  vendorEmail: {
    title: '🔧 Vendor — Welcome Email',
    note: 'EXTERNAL, optional — only sent if staff typed an email in the modal. Without one, staff just copy the link and hand it to the vendor another way (text, in person).',
    source: 'app/api/admin/vendors/onboard/route.ts — sendEmail branch',
    preview: {
      type: 'email', to: 'vendor@example.com',
      subject: 'Welcome — a few documents to get you set up · PMI Top Florida Properties',
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">Hello Sunshine Roofing LLC,<br><br>
        Welcome! To get you set up for payment, please provide a few documents through this secure link — no account needed:<br>
        https://www.pmitop.com/vendor/onboard/••••••••<br><br>
        You can fill in your W-9 and banking (ACH) right in the form, and upload your insurance (COI) and license.<br><br>
        Thank you,<br>PMI Top Florida Properties</div>`,
    },
  },
  vendorPortal: {
    title: '🔧 Vendor — Onboarding Portal',
    note: 'EXTERNAL, no login. One card per document, each showing its own status ("On file" / "Needed") straight from the CINC vendor record — a vendor filling a GAP (started via action=\'link\') only sees what\'s actually missing. Vendor can do these in any order, any time; nothing is required all-at-once.',
    source: 'app/vendor/onboard/[token]/OnboardClient.tsx',
    preview: {
      type: 'form', pageTitle: 'Vendor onboarding — PMI Top Florida Properties',
      fields: [
        { label: 'W-9 (tax information)', kind: 'readonly', value: 'Needed' },
        { label: '', kind: 'button', value: 'Provide tax info' },
        { label: 'Direct deposit (ACH)', kind: 'readonly', value: 'Needed' },
        { label: '', kind: 'button', value: 'Provide bank details' },
        { label: 'Insurance (COI)', kind: 'file', value: 'Upload your Certificate of Insurance' },
        { label: 'License (if required)', kind: 'file', value: 'Upload your trade license' },
      ],
    },
  },
  w9Auto: {
    title: '⚙️ MAIA — Apply W-9 to CINC',
    lines: ['Applied immediately — no staff step.'],
    note: 'Low fraud risk (legal name + business name + TIN, no money movement). A signed Substitute W-9 PDF is generated + stored for the record, and applyW9ToCinc() writes the tax info straight to the CINC vendor. w9_status → \'applied\'.',
    source: 'app/api/vendor/onboard/[token]/w9/route.ts',
  },
  coiLicenseAuto: {
    title: '⚙️ MAIA — Extract & Apply COI/License to CINC',
    lines: ['Applied immediately — no staff step.'],
    note: 'Claude reads the uploaded PDF/photo (carrier, policy #, expiration — or license #, expiration) and applies it directly via applyCoiToCinc/applyLicenseToCinc. coi_status/license_status → \'applied\'. This is the same extraction the COI-validation engine later re-reads to gate invoice pushes.',
    source: 'app/api/vendor/onboard/[token]/route.ts + lib/vendor-doc-apply.ts',
  },
  achGate: {
    title: '🚧 Banking — Held for Staff Review',
    lines: ['ach_status → \'received\'. NOT yet written to CINC.'],
    note: 'Deliberate fraud control: banking changes require a human before touching CINC, unlike W-9/COI/license which are low-risk and auto-applied. The full routing/account number only exist inside the stored PDF — never persisted in the database in the clear.',
    source: 'app/api/vendor/onboard/[token]/ach/route.ts',
  },
  staffConfirmAch: {
    title: '🧰 Staff — Confirm Banking → CINC',
    lines: ['"Confirm banking → CINC" button on the onboarding tracker.'],
    note: 'Re-extracts the FULL routing/account from the stored PDF (transient — never persisted) and calls applyAchToCinc. ach_status → \'applied\'. This is the one document type a vendor can\'t push to CINC on their own.',
    source: 'app/api/admin/vendors/onboarding/[id]/confirm-ach/route.ts + app/admin/vendor-onboarding/VendorOnboardingClient.tsx',
  },
  vendorReady: {
    title: '✅ Vendor — Fully Onboarded',
    lines: ['All required docs applied to CINC: W-9, ACH, COI, and License (if required).'],
    note: 'The vendor is now payable and behaves like any other CINC vendor — available for estimate requests, work orders, recurring services. Nothing to do here; it\'s just the point where every tracked doc reaches \'applied\' (or \'na\' for a not-required license).',
    source: 'vendor_onboarding table — w9/ach/coi/license status all applied|na',
  },
}

export default function VendorOnboardingFlowDiagram() {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div style={{ overflowX: 'auto', background: COLOR.bg, borderRadius: 8, padding: '1rem' }}>
      <svg viewBox="-40 0 1120 900" width="100%" style={{ minWidth: 940, display: 'block' }} xmlns="http://www.w3.org/2000/svg">
        <ArrowheadDefs />

        {/* Row 1 — staff kicks it off */}
        <Box x={380} y={16} w={340} h={80} title="🧰 Staff — Check Duplicates & Create/Link Vendor"
          lines={['Dedupe search · create in CINC · or', 'link an existing CINC vendor']}
          fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          nodeKey="staffCreate" onSelect={setSelected} doc={DOC} />

        {/* Optional side path — vendor email */}
        <Box x={800} y={40} w={280} h={70} title="🔧 Vendor — Welcome Email" fill="#f0fdfa" stroke={VENDOR}
          lines={['Optional — only if staff', 'typed an email']}
          nodeKey="vendorEmail" onSelect={setSelected} doc={DOC} />
        <Arrow path="M720,56 L800,72" dashed label="optional, if email given" labelX={715} labelY={45} />
        <Arrow path="M900,110 L720,205" dashed />

        <Arrow path="M550,96 L550,200" label="or link handed to vendor directly" labelX={555} labelY={150} />

        {/* Row 2 — vendor portal (external, wide) */}
        <Box x={350} y={200} w={400} h={100} title="🔧 Vendor — Onboarding Portal" fill="#f0fdfa" stroke={VENDOR}
          lines={['No login — one card per document,', 'each showing what\'s actually missing']}
          nodeKey="vendorPortal" onSelect={setSelected} doc={DOC} />

        {/* Fan out to 3 parallel document branches */}
        <Arrow path="M470,300 L160,340" label="W-9" labelX={280} labelY={318} />
        <Arrow path="M550,300 L500,340" label="COI / License" labelX={555} labelY={318} />
        <Arrow path="M630,300 L850,340" label="ACH" labelX={740} labelY={318} />

        {/* Row 3 — three parallel reactions */}
        <Box x={20} y={340} w={280} h={90} title="⚙️ MAIA — Apply W-9 to CINC" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          lines={['Applied immediately —', 'no staff step']}
          nodeKey="w9Auto" onSelect={setSelected} doc={DOC} />
        <Box x={330} y={340} w={340} h={90} title="⚙️ MAIA — Extract & Apply COI/License to CINC" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          lines={['Applied immediately —', 'no staff step']}
          nodeKey="coiLicenseAuto" onSelect={setSelected} doc={DOC} />
        <Box x={700} y={340} w={300} h={90} title="🚧 Banking — Held for Staff Review" fill="#fffbeb" stroke={GATE}
          lines={['ach_status = \'received\',', 'NOT yet in CINC']}
          nodeKey="achGate" onSelect={setSelected} doc={DOC} />

        <Arrow path="M850,430 L850,470" />
        <Box x={700} y={470} w={300} h={90} title="🧰 Staff — Confirm Banking → CINC" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          lines={['Re-extracts full routing/account', 'from the stored PDF, applies']}
          nodeKey="staffConfirmAch" onSelect={setSelected} doc={DOC} />

        {/* Converge to terminal */}
        <Arrow path="M160,430 L420,650" />
        <Arrow path="M500,430 L550,650" />
        <Arrow path="M850,560 L680,650" />

        <Box x={350} y={650} w={400} h={100} title="✅ Vendor — Fully Onboarded" fill="#f0fdf4" stroke={COLOR.green}
          lines={['W-9 + ACH + COI + License (if required)', 'all applied to CINC']}
          nodeKey="vendorReady" onSelect={setSelected} doc={DOC} />

        {/* Legend */}
        <Legend x={20} y={800} extra={
          <>
            <rect x={470} y={-14} width={14} height={14} rx={3} fill="#f0fdfa" stroke={VENDOR} />
            <text x={490} y={-3} fontSize={11} fill={COLOR.muted}>Vendor (external)</text>
            <rect x={640} y={-14} width={14} height={14} rx={3} fill="#fffbeb" stroke={GATE} />
            <text x={660} y={-3} fontSize={11} fill={COLOR.muted}>Fraud-control checkpoint</text>
          </>
        } />
        <text x={20} y={830} fontSize={11} fill={COLOR.muted}>🔧 teal border = vendor (external) · 🧰 = staff · ⚙️ = MAIA itself · 🚧 amber = held pending a human before touching CINC.</text>
      </svg>

      {selected && <NodeModal nodeKey={selected} doc={DOC} onClose={() => setSelected(null)} />}
    </div>
  )
}
