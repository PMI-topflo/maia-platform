// =====================================================================
// lib/lease-packet-pdf.tsx
//
// The two per-unit statutory documents, association-agnostic (the full
// legal entity name is injected — swap it and the same form serves any
// association):
//
//   LeasePacketAgreementPdf — the "Landlord and Tenant Acknowledgment,
//   Certification, Electronic-Signature Consent, and Agreement". Owner
//   and tenant each e-sign in MAIA; their drawn signature (or typed
//   name), date, email, and IP audit trail are embedded on the signed
//   copy. Rendered blank (no signatures) it is the review copy.
//
//   RentDemandPdf — the "Notice and Demand for Direct Payment of Rent"
//   (§718.116(11), Fla. Stat.) served on a tenant when the owner is
//   delinquent, plus the companion "Notice to Unit Owner". Generated on
//   demand; blanks the association officer completes are left as lines.
//
// Rendered to bytes with @react-pdf/renderer's renderToBuffer() in the
// API routes (mirrors lib/rules-acknowledgment-pdf.tsx).
// =====================================================================

import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'

const NAVY  = '#1f2a44'
const ORANGE = '#f26a1b'
const INK   = '#2b2f38'
const MUTED = '#6b7280'
const LINE  = '#e5e7eb'

const s = StyleSheet.create({
  page: { paddingVertical: 40, paddingHorizontal: 44, fontSize: 9, fontFamily: 'Helvetica', color: INK, lineHeight: 1.4 },
  header: { borderBottomWidth: 2, borderBottomColor: ORANGE, paddingBottom: 8, marginBottom: 12 },
  brand: { fontSize: 8, color: MUTED, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 14, color: NAVY, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  subtitle: { fontSize: 9, color: MUTED, marginTop: 2 },

  metaLine: { fontSize: 8.5, color: MUTED, marginTop: 6 },

  sectionTitle: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 14, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: ORANGE, paddingBottom: 3 },

  infoRow: { flexDirection: 'row', borderBottomWidth: 0.6, borderBottomColor: LINE, paddingVertical: 3 },
  infoLabel: { width: 140, fontFamily: 'Helvetica-Bold', color: MUTED, fontSize: 8.5 },
  infoValue: { flex: 1, fontSize: 9 },

  clause: { marginBottom: 6 },
  clauseNum: { fontFamily: 'Helvetica-Bold', color: INK },
  clauseTitle: { fontFamily: 'Helvetica-Bold', color: INK },

  consentRow: { flexDirection: 'row', marginBottom: 4 },
  consentKey: { width: 16, fontFamily: 'Helvetica-Bold', color: ORANGE },
  consentText: { flex: 1, fontSize: 8.8 },

  certify: { marginTop: 10, marginBottom: 4, fontSize: 9, fontFamily: 'Helvetica-Bold', color: NAVY },

  sigGrid: { flexDirection: 'row', gap: 14, marginTop: 8, flexWrap: 'wrap' },
  sigBox: { width: '47%', borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 10, marginBottom: 10 },
  sigRole: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  sigImage: { width: 180, height: 54, objectFit: 'contain' },
  sigTyped: { fontSize: 18, fontFamily: 'Helvetica-Oblique', color: INK },
  sigRule: { borderBottomWidth: 1, borderBottomColor: '#9ca3af', width: '100%', marginTop: 4, marginBottom: 3 },
  sigMeta: { fontSize: 8, color: MUTED, marginTop: 2 },
  sigPending: { fontSize: 8.5, color: MUTED, fontFamily: 'Helvetica-Oblique', marginTop: 18 },

  fillLabel: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: MUTED, marginTop: 8 },
  fillLine: { borderBottomWidth: 0.8, borderBottomColor: '#9ca3af', width: 240, height: 12, marginTop: 2 },

  para: { marginBottom: 6, fontSize: 9 },
  small: { fontSize: 7.5, color: MUTED, lineHeight: 1.5 },
  auditBox: { marginTop: 14, paddingTop: 8, borderTopWidth: 1, borderTopColor: LINE },
})

// ── The Agreement body (verbatim from the association template) ───────
const CLAUSES: { n: number; title: string; body: string }[] = [
  { n: 1, title: 'Receipt or Access to Governing Documents.', body: 'The Owner and each Tenant acknowledge that they have received, reviewed, or have been provided a reasonable opportunity and electronic access to review the Governing Documents currently in effect. Each signer agrees to request clarification from the Owner or Association before signing if any provision is not understood.' },
  { n: 2, title: 'Agreement to Comply.', body: 'The Owner and each Tenant agree to comply with the Governing Documents, the Florida Condominium Act, and all other applicable laws. Each Tenant further agrees that compliance is a continuing condition of occupancy and applies to the Tenant’s household members, authorized occupants, guests, invitees, contractors, agents, and any other person admitted to the condominium property through the Tenant or Unit.' },
  { n: 3, title: 'Future Rules, Amendments, and Updates.', body: 'This Agreement applies to the Governing Documents currently in effect and to all future amendments, supplements, rules, regulations, policies, procedures, resolutions, and other requirements that may be lawfully adopted, amended, approved, replaced, or repealed by the Board of Directors or the Association membership, as applicable, and made effective in accordance with the Governing Documents and Florida law. The Owner and each Tenant agree to comply with every such future change from its effective date, subject to any notice required by law or the Governing Documents.' },
  { n: 4, title: 'Owner’s Duty to Deliver Updates to Tenant.', body: 'The Owner shall promptly provide each Tenant with a complete and readable copy of every new or amended rule, regulation, policy, procedure, resolution, notice, or other update that is applicable to the lease, occupancy, conduct, or use of the Unit or condominium property. Delivery may be made electronically unless another method is required by law or the Governing Documents. The Owner must ensure that the Tenant receives or can readily access the update and has a reasonable opportunity to review it.' },
  { n: 5, title: 'Owner’s Full Responsibility for Communication.', body: 'As between the Owner and the Association, the Owner accepts full responsibility for communicating all current and future Governing Document updates to the Tenant and all other occupants of the Unit. The Owner’s failure to deliver or explain an update does not waive the Association’s rights or remedies. To the fullest extent permitted by the Governing Documents and applicable law, the Owner remains responsible to the Association for violations by the Tenant, occupants, guests, invitees, contractors, or agents, including violations arising from the Owner’s failure to provide an update.' },
  { n: 6, title: 'Direct Communications to Tenant.', body: 'The Owner and each Tenant authorize the Association and its management agent to send notices, rules, updates, violation communications, and other occupancy-related materials directly to the Tenant at the email address or other contact information provided in this Agreement. Direct communication by the Association is a supplemental courtesy and does not relieve the Owner of the duties and responsibilities stated in Sections 4 and 5.' },
  { n: 7, title: 'Accuracy and Completeness of Information.', body: 'The Owner and each Tenant certify, represent, and warrant that the lease, application, occupant information, contact information, and all supporting documents submitted to the Association are true, complete, current, and accurate. No separate or undisclosed agreement materially changes the rental term, occupants, use, consideration, or other information submitted to the Association.' },
  { n: 8, title: 'Continuing Duty to Update Information.', body: 'The Owner and each Tenant must promptly notify the Association in writing of any change to contact information, occupants, vehicles, lease dates, emergency contacts, or other material information previously submitted. No additional person may occupy the Unit unless permitted by the Governing Documents and approved when approval is required.' },
  { n: 9, title: 'Owner Responsibility for Tenant and Guests.', body: 'The Owner acknowledges that leasing the Unit does not transfer or reduce the Owner’s obligations to the Association. The Owner is responsible for the conduct of the Tenant, occupants, guests, invitees, contractors, and agents to the extent provided by the Governing Documents and applicable law.' },
  { n: 10, title: 'Direct Payment of Rent Upon Owner Delinquency.', body: 'If the Unit is occupied by a Tenant and the Owner becomes delinquent in paying any monetary obligation due to the Association, including regular or special assessments and any other amounts lawfully due, the Association may exercise the rights available under section 718.116(11), Florida Statutes, as amended. After the Association serves the Tenant with a separate written statutory demand, the Tenant must pay subsequent rental payments directly to the Association and continue making such payments until the Association releases the Tenant in writing or the tenancy ends. The Owner acknowledges that all rent timely paid to the Association must be credited against rent owed to the Owner, that the Tenant’s liability to the Association may not exceed the rent otherwise due to the Owner, and that the Owner may not claim or collect from the Tenant any rent timely paid to the Association. Payments received by the Association will be credited against the Owner’s monetary obligations related to the Unit until those obligations are paid in full. This Section is an acknowledgment of the Association’s statutory rights and is not itself a demand to redirect rent; the Tenant shall redirect rent only after receiving a separate written demand that complies with applicable law.' },
  { n: 11, title: 'Enforcement and Remedies.', body: 'The Association may enforce the Governing Documents and this Agreement and may exercise any remedy authorized by the Governing Documents and applicable law, including notices of violation, fines, suspension of use rights, injunctive relief, damages, recovery of costs and attorneys’ fees when authorized, and any action relating to lease or occupancy approval. Nothing in this Agreement creates a remedy that is not otherwise authorized by law or the Governing Documents.' },
  { n: 12, title: 'No Association Guarantee or Assumption of Liability.', body: 'Any review, approval, acknowledgment, or receipt by the Association does not guarantee the condition or safety of the Unit, the enforceability or legality of the lease, the financial ability or conduct of either party, or the performance of any obligation between Owner and Tenant. The Association is not a party to the lease and does not assume the duties of Owner or Tenant.' },
  { n: 13, title: 'No Waiver.', body: 'A delay or failure by the Association to enforce any provision on one occasion does not waive the right to enforce that provision or any other provision later. Any waiver must be in writing and signed by an authorized representative of the Association.' },
  { n: 14, title: 'Severability and Controlling Authority.', body: 'If any provision of this Agreement is held invalid or unenforceable, the remaining provisions remain effective to the fullest extent permitted by law. If this Agreement conflicts with the Declaration of Condominium, applicable Florida law, or another controlling authority, the controlling authority governs and this Agreement will be interpreted as closely as possible to its lawful purpose.' },
  { n: 15, title: 'Term and Survival.', body: 'This Agreement remains effective throughout the lease and any renewal, extension, holdover, or continued occupancy. Sections concerning accuracy of information, responsibility, enforcement, records, and electronic signatures survive expiration or termination to the extent necessary to enforce obligations arising during occupancy. This Agreement documents consent, acknowledgment, and agreement and is not a substitute for the lease, the Governing Documents, or legal advice.' },
]

const CONSENT: { k: string; t: string }[] = [
  { k: 'A.', t: 'Consent. I consent to conduct this transaction and execute this Agreement electronically.' },
  { k: 'B.', t: 'Identity. I confirm that I am the person identified in my signature block and that I am signing in the stated capacity.' },
  { k: 'C.', t: 'Intent to Sign. I intend my electronic signature to authenticate this Agreement and to be legally binding to the same extent as my handwritten signature.' },
  { k: 'D.', t: 'Review and Opportunity to Correct. Before signing, I had the opportunity to review the complete Agreement and correct any inaccurate information.' },
  { k: 'E.', t: 'Electronic Records. I consent to the Association and its management agent creating, transmitting, receiving, storing, and relying upon this Agreement and related records in electronic form.' },
  { k: 'F.', t: 'Retention and Copy. I acknowledge that I can download, print, save, or request a copy of the completed Agreement.' },
  { k: 'G.', t: 'Audit Trail and Authentication. I consent to the electronic-signature platform recording information used to authenticate and document the transaction, which may include my email address, date and time, internet protocol address, device or session information, authentication steps, document history, and a tamper-evident completion certificate or audit trail.' },
  { k: 'H.', t: 'Electronic Communications. I consent to receive Association rules, updates, notices, and other occupancy-related communications electronically at the contact information provided below, except when a different delivery method is required by law or the Governing Documents.' },
  { k: 'I.', t: 'Counterparts. This Agreement may be signed in separate electronic counterparts, each of which is deemed an original and all of which together form one Agreement.' },
]

export interface SignerEvidence {
  name: string
  image: string | null      // PNG data URL of the drawn signature
  signedAt: string | null   // ISO
  email: string | null
  ip: string | null
}

export interface LeasePacketAgreementProps {
  associationLegalName: string
  condominiumName?: string | null
  unitNumber: string | null
  propertyAddress?: string | null
  ownerName: string | null
  tenantNames: string[]
  otherOccupants?: string | null
  leaseStart: string | null
  leaseEnd: string | null
  effectiveDate?: string | null
  boardApprovalDate?: string | null
  ownerEmail?: string | null
  ownerMobile?: string | null
  tenantEmail?: string | null
  tenantMobile?: string | null
  emergencyContact?: string | null
  ownerSig?: SignerEvidence | null
  tenantSig?: SignerEvidence | null
  documentId?: string | null
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value && value.trim() ? value : '—'}</Text>
    </View>
  )
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' })
}
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
}

function SigBlock({ role, sig }: { role: string; sig: SignerEvidence | null | undefined }) {
  return (
    <View style={s.sigBox}>
      <Text style={s.sigRole}>{role}</Text>
      {sig && sig.signedAt ? (
        <>
          {sig.image
            ? <Image style={s.sigImage} src={sig.image} />
            : <Text style={s.sigTyped}>{sig.name}</Text>}
          <View style={s.sigRule} />
          <Text style={s.sigMeta}>Printed name: {sig.name}</Text>
          <Text style={s.sigMeta}>Date signed: {fmtDateTime(sig.signedAt)}</Text>
          {sig.email ? <Text style={s.sigMeta}>Email: {sig.email}</Text> : null}
          {sig.ip ? <Text style={s.sigMeta}>Signed from IP {sig.ip}</Text> : null}
        </>
      ) : (
        <Text style={s.sigPending}>Awaiting electronic signature.</Text>
      )}
    </View>
  )
}

export function LeasePacketAgreementPdf(props: LeasePacketAgreementProps) {
  const condo = props.condominiumName || props.associationLegalName
  return (
    <Document title="Landlord and Tenant Acknowledgment, Certification, Electronic-Signature Consent, and Agreement">
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <Text style={s.brand}>{props.associationLegalName}</Text>
          <Text style={s.title}>Landlord and Tenant Acknowledgment, Certification, Electronic-Signature Consent, and Agreement</Text>
          <Text style={s.metaLine}>
            Board Approval Date: {fmtDate(props.boardApprovalDate) || '____________'}    Effective Date: {fmtDate(props.effectiveDate) || '____________'}
            {props.documentId ? `    Document ID: ${props.documentId}` : ''}
          </Text>
        </View>

        <Text style={s.sectionTitle}>Property and Lease Information</Text>
        <Info label="Condominium / Building" value={condo} />
        <Info label="Unit Number" value={props.unitNumber} />
        <Info label="Property Address" value={props.propertyAddress} />
        <Info label="Lease Start Date" value={fmtDate(props.leaseStart)} />
        <Info label="Lease End Date" value={fmtDate(props.leaseEnd)} />
        <Info label="Unit Owner / Landlord" value={props.ownerName} />
        <Info label="Tenant(s)" value={props.tenantNames.join(', ')} />
        <Info label="Other Authorized Occupant(s)" value={props.otherOccupants} />

        <Text style={s.sectionTitle}>Purpose and Definitions</Text>
        <Text style={s.para}>This Landlord and Tenant Acknowledgment, Certification, Electronic-Signature Consent, and Agreement (the &ldquo;Agreement&rdquo;) is entered into by the undersigned Unit Owner/Landlord (&ldquo;Owner&rdquo;) and each undersigned Tenant in connection with the lease and occupancy of the Unit identified above.</Text>
        <Text style={s.para}>&ldquo;Association&rdquo; means {props.associationLegalName} &ldquo;Governing Documents&rdquo; means the Declaration of Condominium, Articles of Incorporation, Bylaws, current Rules and Regulations, and all lawful amendments, supplements, policies, resolutions, procedures, and other requirements applicable to the Unit, the Owner, the Tenant, occupants, guests, invitees, vehicles, and use of the condominium property.</Text>

        <Text style={s.sectionTitle}>Acknowledgments, Certifications, and Agreements</Text>
        {CLAUSES.map(c => (
          <Text key={c.n} style={s.clause}>
            <Text style={s.clauseNum}>{c.n}. </Text>
            <Text style={s.clauseTitle}>{c.title} </Text>
            <Text>{c.body}</Text>
          </Text>
        ))}

        <Text style={s.sectionTitle}>Consent to Electronic Transactions and Electronic Signatures</Text>
        <Text style={s.para}>By signing electronically, each signer knowingly and voluntarily agrees as follows:</Text>
        {CONSENT.map(c => (
          <View key={c.k} style={s.consentRow}>
            <Text style={s.consentKey}>{c.k}</Text>
            <Text style={s.consentText}>{c.t}</Text>
          </View>
        ))}
        <Text style={s.certify}>BY SIGNING BELOW, EACH SIGNER CERTIFIES THAT THE SIGNER HAS READ, UNDERSTANDS, AND AGREES TO THIS ENTIRE DOCUMENT.</Text>

        <Text style={s.sectionTitle}>Contact Information for Electronic Notices</Text>
        <Info label="Owner Email" value={props.ownerEmail} />
        <Info label="Owner Mobile" value={props.ownerMobile} />
        <Info label="Primary Tenant Email" value={props.tenantEmail} />
        <Info label="Primary Tenant Mobile" value={props.tenantMobile} />
        <Info label="Emergency Contact" value={props.emergencyContact} />

        <Text style={s.sectionTitle}>Electronic Signatures</Text>
        <View style={s.sigGrid}>
          <SigBlock role="Unit Owner / Landlord" sig={props.ownerSig} />
          <SigBlock role="Tenant" sig={props.tenantSig} />
        </View>

        <View style={s.auditBox}>
          <Text style={s.small}>
            Electronic signature audit trail captured by MAIA (PMI Top Florida Properties) under the Uniform Electronic Transactions Act
            and Fla. Stat. ch. 668. Each signature above records the signer&rsquo;s typed name, drawn signature, timestamp (Eastern Time),
            email, and originating IP address. This completed Agreement is retained electronically and a copy is available on request.
          </Text>
        </View>
      </Page>
    </Document>
  )
}

// ── Rent Demand (§718.116(11)) ────────────────────────────────────────
export interface RentDemandProps {
  associationLegalName: string
  unitNumber: string | null
  ownerName: string | null
  ownerAddress?: string | null
  tenantNames: string[]
  rentAmount?: string | null
  rentDue?: string | null
  payableTo?: string | null
  paymentAddress?: string | null
  paymentContact?: string | null
  noticeDate?: string | null
}

function FillLine({ label, value, width = 240 }: { label: string; value?: string | null; width?: number }) {
  return (
    <View>
      <Text style={s.fillLabel}>{label}</Text>
      {value && value.trim()
        ? <Text style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold', marginTop: 2 }}>{value}</Text>
        : <View style={[s.fillLine, { width }]} />}
    </View>
  )
}

export function RentDemandPdf(props: RentDemandProps) {
  const tenants = props.tenantNames.join(', ')
  return (
    <Document title="Notice and Demand for Direct Payment of Rent">
      {/* Page 1 — demand served on the tenant */}
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <Text style={s.brand}>{props.associationLegalName}</Text>
          <Text style={s.title}>Notice and Demand for Direct Payment of Rent</Text>
          <Text style={s.subtitle}>Pursuant to Section 718.116(11), Florida Statutes</Text>
        </View>
        <Text style={[s.small, { marginBottom: 8 }]}>SERVICE INSTRUCTION: Deliver by hand or United States mail. Email should be supplemental only.</Text>

        <Info label="Date" value={fmtDate(props.noticeDate)} />
        <Info label="Method" value="[ ] Hand Delivery    [ ] U.S. Mail" />
        <Info label="Tenant(s)" value={tenants} />
        <Info label="Unit" value={props.unitNumber} />
        <Info label="Owner" value={props.ownerName} />
        <Info label="Rent / Due" value={`${props.rentAmount ? '$' + props.rentAmount : '$____________'} / ${props.rentDue || '____________'}`} />

        <Text style={[s.para, { marginTop: 10 }]}>Dear Tenant(s):</Text>
        <Text style={s.para}>The Unit Owner identified above is delinquent in paying monetary obligations due to the Association. The Association therefore exercises its rights under section 718.116(11), Florida Statutes.</Text>
        <Text style={s.para}>Pursuant to section 718.116(11), Florida Statutes, the Association demands that you pay your rent directly to the condominium association and continue doing so until the Association notifies you otherwise.</Text>
        <Text style={s.para}>Payment due the condominium association may be in the same form as you paid your landlord and must be sent by United States mail or hand delivery to the payment address stated below, payable to the payee stated below.</Text>
        <Text style={s.para}>Your obligation to pay your rent to the Association begins immediately, unless you already paid rent to your landlord for the current period before receiving this notice. In that case, provide the Association written proof of payment within 14 days after receiving this notice; your obligation to pay the Association then begins with the next rental period.</Text>
        <Text style={s.para}>Pursuant to section 718.116(11), Florida Statutes, payment of rent to the Association gives you complete immunity from any claim for the rent by your landlord for all amounts timely paid to the Association.</Text>

        <Text style={s.sectionTitle}>Payment Instructions</Text>
        <FillLine label="Payable To" value={props.payableTo || props.associationLegalName} />
        <FillLine label="Unit Memo" value={props.unitNumber} />
        <FillLine label="Address" value={props.paymentAddress} />
        <FillLine label="Contact" value={props.paymentContact} />

        <Text style={[s.para, { marginTop: 10 }]}>Important: Continue paying the Association until written release or the tenancy ends. Your liability cannot exceed rent otherwise due. The Owner must credit rent paid to the Association. Written receipts are available upon request. Failure to comply may permit remedies authorized by Florida law.</Text>
        <Text style={[s.para, { marginTop: 8 }]}>Sincerely,</Text>
        <Text style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold' }}>{props.associationLegalName.toUpperCase()}</Text>
        <FillLine label="By" width={240} />
        <FillLine label="Name / Title" width={240} />
        <FillLine label="Date" width={160} />
      </Page>

      {/* Page 2 — companion notice to the owner */}
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <Text style={s.brand}>{props.associationLegalName}</Text>
          <Text style={s.title}>Notice to Unit Owner of Tenant Rent Demand</Text>
          <Text style={s.subtitle}>Pursuant to Section 718.116(11)(a)2., Florida Statutes</Text>
        </View>

        <Info label="Date" value={fmtDate(props.noticeDate)} />
        <Info label="Mail" value="[ ] First-Class    [ ] Certified" />
        <Info label="Owner" value={props.ownerName} />
        <Info label="Unit" value={props.unitNumber} />
        <Info label="Address" value={props.ownerAddress} />
        <Info label="Tenant(s)" value={tenants} />

        <Text style={[s.para, { marginTop: 10, fontFamily: 'Helvetica-Bold' }]}>Re: Demand that your Tenant pay rent directly to the Association</Text>
        <Text style={s.para}>Dear Unit Owner:</Text>
        <Text style={s.para}>Because monetary obligations related to the Unit remain delinquent, the Association has served the Tenant identified above with a written demand under section 718.116(11), Florida Statutes, requiring subsequent rental payments to be paid directly to the Association. A copy of the Tenant demand is enclosed.</Text>
        <Text style={s.para}>The Tenant must pay the Association as stated in the enclosed demand until written release or termination of the tenancy. Rent timely paid to the Association must be credited against rent otherwise due to you, and the Tenant is immune from claims for rent timely paid to the Association. Do not demand or collect any rent already timely paid to the Association.</Text>
        <Text style={s.para}>Tenant payments will be credited against the monetary obligations related to the Unit. This demand does not waive or limit any other collection or enforcement right. The Association will send written notice when the Tenant is released from the direct-payment requirement.</Text>
        <Text style={s.para}>Please direct questions or payment arrangements to the Association or its authorized agent below.</Text>

        <Text style={s.sectionTitle}>Association / Agent Contact</Text>
        <FillLine label="Name" value={props.paymentContact} />
        <FillLine label="Address" value={props.paymentAddress} />

        <Text style={[s.para, { marginTop: 10 }]}>Sincerely,</Text>
        <Text style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold' }}>{props.associationLegalName.toUpperCase()}</Text>
        <FillLine label="By" width={240} />
        <FillLine label="Name / Title" width={240} />
        <FillLine label="Date" width={160} />

        <View style={s.auditBox}>
          <Text style={s.small}>Template note: Confirm account status, service, payment instructions, and current law before use. Counsel should review before eviction or other litigation.</Text>
        </View>
      </Page>
    </Document>
  )
}
