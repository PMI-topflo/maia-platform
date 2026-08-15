// =====================================================================
// lib/esign-forms.tsx
//
// The form registry for the shared e-sign engine. Each association form is
// a definition: which roles must sign, their labels, and how to render the
// signed PDF (which includes the shared verification certificate). Adding a
// new form = add a definition here — the generic table, token, verified-
// signing page, and routes handle the rest.
//
// Ships one built-in reference form ("association_acknowledgment") that
// proves the engine end-to-end; Pet Registration and others slot in next.
// =====================================================================

import { Document, Page, Text, View, Image, StyleSheet, type DocumentProps } from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import type { EsignDoc, EsignSigner } from '@/lib/esign'
import {
  effectiveBranch, asksServiceTaskDetail, asksDisabilityDocumentation, asksNeedDocumentation,
  asksProviderDetail, asksPerAnimalNeed, certificationFor, petRulesApply,
  REQUEST_TYPE_LABEL, type AnimalQuestionnaire,
} from '@/lib/animal-questionnaire'

type PdfElement = ReactElement<DocumentProps>

export interface EsignFormDef {
  kind: string
  label: string
  roles: string[]                         // required signer roles, in signing order
  roleLabel: (role: string) => string
  renderPdf: (doc: EsignDoc) => PdfElement
  /** Fillable forms (the animal questionnaire): the applicant enters their
   *  answers before signing. There is no printable blank counterpart — these
   *  forms branch, so a printed copy would ask the wrong questions. */
  fillable?: boolean
  /** Optional expiry (ISO date) filed on the compliance record when the doc
   *  completes and used by the renewal-alert cron. */
  computeExpiry?: (doc: EsignDoc) => string | null
}

// ── Shared PDF pieces ────────────────────────────────────────────────
const NAVY = '#1f2a44', MUTED = '#6b7280'
const s = StyleSheet.create({
  page: { padding: 34, fontSize: 10.5, fontFamily: 'Helvetica', color: '#1a1a1a', lineHeight: 1.45 },
  assoc: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 4, marginBottom: 2 },
  rule: { borderBottomWidth: 2, borderBottomColor: '#f26a1b', width: 60, marginTop: 5, marginBottom: 10 },
  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 9, marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#f0f0f0', paddingVertical: 3.5 },
  rowKey: { color: MUTED }, rowVal: { fontFamily: 'Helvetica-Bold' },
  para: { marginTop: 7, fontSize: 9.5, color: '#333' },
  sigWrap: { flexDirection: 'row', gap: 16, marginTop: 8 },
  sigBox: { flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, padding: 10, minHeight: 78 },
  sigRole: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  sigImage: { height: 40, marginBottom: 2, objectFit: 'contain' },
  sigTyped: { fontSize: 18, fontFamily: 'Helvetica-Oblique', marginBottom: 2 },
  sigRule: { borderBottomWidth: 1, borderBottomColor: '#9ca3af', width: '100%', marginTop: 4, marginBottom: 3 },
  sigMeta: { fontSize: 8, color: MUTED, marginTop: 2 },
  sigVerifyTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 2, marginBottom: 1 },
  sigPending: { fontSize: 8.5, color: MUTED, fontFamily: 'Helvetica-Oblique', marginTop: 18 },
  // Statutory notices sit in a boxed callout so they read as a legal notice the
  // signer must see, not as one more bullet among the house rules.
  notice: { borderWidth: 1, borderColor: '#fde68a', backgroundColor: '#fffbeb', borderRadius: 5, padding: 9, marginTop: 10 },
  noticeTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: '#92400e', marginBottom: 3 },
  noticeBody: { fontSize: 9, color: '#3a3f4a', lineHeight: 1.45 },
})

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'
}

/** The identity-verification certificate printed under a signature — the
 *  reusable heart of the verified-signature layer. */
export function VerificationCertificate({ v }: { v: EsignSigner['verification'] }) {
  if (!v) return null
  const geo = v.geo && 'lat' in v.geo
    ? `${v.geo.lat.toFixed(4)}, ${v.geo.lon.toFixed(4)} (±${Math.round(v.geo.accuracy_meters)}m)`
    : (v.geo && 'denied' in v.geo ? 'declined — IP location on file' : null)
  return (
    <>
      <View style={s.sigRule} />
      <Text style={s.sigVerifyTitle}>Identity verification</Text>
      {v.emailVerifiedAt ? <Text style={s.sigMeta}>✓ Email verified {fmtDateTime(v.emailVerifiedAt)}</Text> : null}
      {v.phoneVerifiedAt ? <Text style={s.sigMeta}>✓ Phone verified via {v.phoneChannel === 'whatsapp' ? 'WhatsApp' : 'SMS'} {fmtDateTime(v.phoneVerifiedAt)}</Text> : null}
      {geo ? <Text style={s.sigMeta}>Location: {geo}</Text> : null}
      {v.ua ? <Text style={s.sigMeta}>Device: {v.ua.slice(0, 90)}</Text> : null}
    </>
  )
}

/** A signature block for one signer, with its verification certificate. */
export function EsignSigBlock({ label, signer }: { label: string; signer: EsignSigner | null }) {
  return (
    <View style={s.sigBox}>
      <Text style={s.sigRole}>{label}</Text>
      {signer && signer.signed_at ? (
        <>
          {signer.sig_image
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image>, not an HTML <img>
            ? <Image style={s.sigImage} src={signer.sig_image} />
            : <Text style={s.sigTyped}>{signer.sig_name ?? signer.name ?? ''}</Text>}
          <View style={s.sigRule} />
          <Text style={s.sigMeta}>Printed name: {signer.sig_name ?? signer.name ?? '—'}</Text>
          <Text style={s.sigMeta}>Date signed: {fmtDateTime(signer.signed_at)}</Text>
          {signer.email ? <Text style={s.sigMeta}>Email: {signer.email}</Text> : null}
          {signer.sig_ip ? <Text style={s.sigMeta}>Signed from IP {signer.sig_ip}</Text> : null}
          <VerificationCertificate v={signer.verification} />
        </>
      ) : (
        <>
          {/* Name the expected approver even before signing, so the letter shows
              WHO must sign (and at which address it was sent). */}
          {signer?.name ? <Text style={s.sigMeta}>Printed name: {signer.name}</Text> : null}
          {signer?.email ? <Text style={s.sigMeta}>Email: {signer.email}</Text> : null}
          <Text style={s.sigPending}>Awaiting electronic signature.</Text>
        </>
      )}
    </View>
  )
}

/** Render the signature row for a document's registered roles. */
function SignatureRow({ doc, def }: { doc: EsignDoc; def: EsignFormDef }) {
  // Render the document's ACTUAL signers (supports a variable number, e.g. two
  // board approvers); fall back to the form's static roles for the blank copy.
  const signers = doc.signers.length ? doc.signers : def.roles.map(role => ({ role } as EsignSigner))
  return (
    <View wrap={false}>
      <Text style={s.sectionTitle}>Electronic Signatures</Text>
      <View style={s.sigWrap}>
        {signers.map((sg, i) => <EsignSigBlock key={i} label={def.roleLabel(sg.role)} signer={doc.signers.find(x => x.role === sg.role) ?? null} />)}
      </View>
    </View>
  )
}

// ── Built-in reference form ──────────────────────────────────────────
// A generic association acknowledgment: a title + body statement + key/value
// details from payload, e-signed by one signer. Proves the engine; real forms
// (pet registration, board decision) follow the same shape.
const associationAcknowledgment: EsignFormDef = {
  kind: 'association_acknowledgment',
  label: 'Association Acknowledgment',
  roles: ['signer'],
  roleLabel: () => 'Signer',
  renderPdf: (doc) => {
    const p = doc.payload as { associationLegalName?: string; statement?: string; details?: { label: string; value: string }[] }
    return (
      <Document>
        <Page size="LETTER" style={s.page}>
          <Text style={s.assoc}>{p.associationLegalName ?? doc.association_code}</Text>
          <Text style={s.title}>{doc.title ?? 'Association Acknowledgment'}</Text>
          <View style={s.rule} />
          {(p.details ?? []).length > 0 && (
            <>
              <Text style={s.sectionTitle}>Details</Text>
              {(p.details ?? []).map((d, i) => (
                <View key={i} style={s.row}><Text style={s.rowKey}>{d.label}</Text><Text style={s.rowVal}>{d.value}</Text></View>
              ))}
            </>
          )}
          {p.statement ? <Text style={s.para}>{p.statement}</Text> : null}
          <SignatureRow doc={doc} def={associationAcknowledgment} />
        </Page>
      </Document>
    )
  },
}

// ── Pet Registration ─────────────────────────────────────────────────
export interface Pet {
  type?: string; name?: string; breed?: string; color?: string; weight?: string
  age?: string; sex?: string; altered?: boolean; license?: string; rabiesDate?: string
  vaccinationDoc?: { path: string; filename: string } | null
  photo?: { path: string; filename: string } | null
  serviceAnimal?: boolean
}
export interface PetPayload {
  associationLegalName?: string
  petLimit?: number
  pets?: Pet[]
  vetName?: string
  vetPhone?: string
  rulesAck?: string
  /** The Animal Information & Reasonable Accommodation Questionnaire. Merged
   *  into this document rather than standing beside it: one form, three
   *  branches (pet / service animal / assistance animal). Absent on documents
   *  created before 2026-08-15, which render exactly as they always did. */
  questionnaire?: AnimalQuestionnaire
}

const PET_ACK_DEFAULT =
  'I certify the information above is true and complete. I have read and agree to comply with the Association’s pet rules and restrictions, I will keep each pet’s vaccinations current, and I understand registration may be revoked for violations.'

const petStyles = StyleSheet.create({
  petCard: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, padding: 7, marginTop: 6, fontSize: 9 },
  petTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: NAVY, marginBottom: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', paddingVertical: 1.5, flexDirection: 'row' },
  cellK: { color: MUTED, width: 82, fontSize: 9 }, cellV: { fontFamily: 'Helvetica-Bold', flex: 1, fontSize: 9 },
})

function petCell(k: string, v: string | undefined) {
  return (
    <View style={petStyles.cell}>
      <Text style={petStyles.cellK}>{k}</Text>
      <Text style={petStyles.cellV}>{v && v.trim() ? v : '—'}</Text>
    </View>
  )
}

function PetCard({ pet, index }: { pet: Pet | null; index: number }) {
  const p = pet ?? {}
  return (
    <View style={petStyles.petCard} wrap={false}>
      <Text style={petStyles.petTitle}>Pet {index + 1}</Text>
      <View style={petStyles.grid}>
        {petCell('Type', p.type)}
        {petCell('Name', p.name)}
        {petCell('Breed', p.breed)}
        {petCell('Color', p.color)}
        {petCell('Weight (lb)', p.weight)}
        {petCell('Age', p.age)}
        {petCell('Sex', p.sex)}
        {petCell('Spayed/Neutered', p.altered ? 'Yes' : 'No')}
        {petCell('License / Tag #', p.license)}
        {petCell('Rabies vax date', p.rabiesDate)}
        {petCell('Service/ESA', p.serviceAnimal ? 'Yes' : 'No')}
        {petCell('Vax record', p.vaccinationDoc?.filename ? 'on file' : 'not provided')}
        {petCell('Photo', p.photo?.filename ? 'on file' : 'not provided')}
      </View>
    </View>
  )
}

const yn = (v: string | undefined) => v === 'yes' ? 'Yes' : v === 'no' ? 'No' : v === 'unsure' ? 'Unsure' : v === 'na' ? 'Not applicable' : v === 'defer' ? 'Prefer that Management determine whether documentation is necessary' : '—'

/** The questionnaire section of the form. Only the branch the applicant
 *  actually reached is printed — a signed copy must not carry disability
 *  questions that were never asked, nor imply they were. */
function QuestionnaireSection({ q }: { q: AnimalQuestionnaire }) {
  const branch = effectiveBranch(q)
  if (!branch) return null
  const e = q.esa ?? {}, sv = q.service ?? {}
  const row = (k: string, v: string) => <View style={s.row}><Text style={s.rowKey}>{k}</Text><Text style={s.rowVal}>{v}</Text></View>
  return (
    <>
      <Text style={s.sectionTitle}>Type of request</Text>
      <Text style={{ ...s.para, marginTop: 2 }}>{REQUEST_TYPE_LABEL[q.requestType ?? 'pet']}</Text>
      {q.requestType === 'service' && sv.isDog === 'no' && (
        <Text style={{ ...s.para, marginTop: 2, color: MUTED, fontSize: 9 }}>
          The animal is not a dog, so this request is reviewed as an assistance-animal accommodation request.
        </Text>
      )}

      {branch === 'unsure' && (
        <Text style={{ ...s.para, marginTop: 4 }}>
          The applicant is not sure which category applies. No disability questions were asked. Management to follow up.
        </Text>
      )}

      {branch === 'service' && (
        <>
          <Text style={s.sectionTitle}>Service animal</Text>
          {row('Is the animal a dog?', yn(sv.isDog))}
          {row('Work or task readily apparent?', yn(sv.taskApparent))}
          {asksServiceTaskDetail(q) ? (
            <>
              {row('Required because of a disability?', yn(sv.requiredForDisability))}
              {row('Work or task trained to perform', (sv.taskDescription ?? '').trim() || '—')}
            </>
          ) : (
            <Text style={{ ...s.para, marginTop: 2, color: MUTED, fontSize: 9 }}>
              The work or task is readily apparent, so no further inquiry into the disability was made.
            </Text>
          )}
          {row('Vaccinated and licensed as required by law?', yn(sv.vaccinatedAndLicensed))}
        </>
      )}

      {branch === 'esa' && (
        <>
          <Text style={s.sectionTitle}>Assistance animal — reasonable accommodation request</Text>
          {row('Requesting an accommodation because of a disability?', yn(e.requestingAccommodation))}
          {row('Disability readily apparent or already known?', yn(e.disabilityApparent))}
          {row('Need for this particular animal readily apparent?', yn(e.needApparent))}
          {row('Number of assistance animals requested', String(e.animalCount ?? 1))}
          {asksPerAnimalNeed(q) && (
            <Text style={{ ...s.para, marginTop: 2, color: MUTED, fontSize: 9 }}>
              More than one animal is requested; documentation of the disability-related need may be requested for each.
            </Text>
          )}
          {(asksDisabilityDocumentation(q) || asksNeedDocumentation(q)) ? (
            <>
              {e.documentation === 'attached' && (e.documentationFiles ?? []).length > 0 && (
                <Text style={{ ...s.para, marginTop: 2, fontSize: 9 }}>
                  Attached: {(e.documentationFiles ?? []).map(f => f.filename).join(', ')}
                </Text>
              )}
              {row('Supporting documentation', e.documentation === 'attached' ? 'Attached'
                : e.documentation === 'separate' ? 'Will be provided separately'
                : e.documentation === 'unnecessary' ? 'Believed unnecessary — disability and need are readily apparent'
                : e.documentation === 'none' ? 'None' : '—')}
              {asksProviderDetail(q) && (
                <>
                  <Text style={s.sectionTitle}>Healthcare professional</Text>
                  {row('Name', (e.provider?.name ?? '').trim() || '—')}
                  {row('Title', (e.provider?.title ?? '').trim() || '—')}
                  {row('License number', (e.provider?.licenseNumber ?? '').trim() || '—')}
                  {row('State of licensure', (e.provider?.licenseState ?? '').trim() || '—')}
                  {row('Contact', (e.provider?.contact ?? '').trim() || '—')}
                  {row('Obtained only from an online ESA registry/certificate?', yn(e.onlineRegistryOnly))}
                  {e.onlineRegistryOnly === 'yes' && (
                    <Text style={{ ...s.para, marginTop: 2, color: MUTED, fontSize: 9 }}>
                      An online registration, certificate, ID card, vest or patch is not by itself sufficient documentation
                      of a disability or of a disability-related need.
                    </Text>
                  )}
                  {(e.outOfState?.licenseState ?? '').trim() ? (
                    <>
                      {row('Provider licensed in', String(e.outOfState?.licenseState))}
                      {row('Has personally provided you care or services?', yn(e.outOfState?.hasTreatedYou))}
                      {row('In-person care on at least one occasion?', yn(e.outOfState?.inPersonAtLeastOnce))}
                    </>
                  ) : null}
                </>
              )}
            </>
          ) : (
            <Text style={{ ...s.para, marginTop: 2, color: MUTED, fontSize: 9 }}>
              The disability and the disability-related need are readily apparent, so no supporting documentation was requested.
            </Text>
          )}
          {row('Vaccinated and licensed as required by law?', yn(e.vaccinatedAndLicensed))}
        </>
      )}

      {branch === 'pet' && q.petVaccinated && row('Vaccinated as required by law?', yn(q.petVaccinated))}

      {branch !== 'pet' && branch !== 'unsure' && (
        <Text style={{ ...s.para, marginTop: 6, color: MUTED, fontSize: 9 }}>
          No diagnosis, severity of condition, or medical records were requested or provided. An approved service or
          assistance animal is not an ordinary pet and is not subject to a pet fee, pet deposit, surcharge, or breed or
          size restriction.
        </Text>
      )}
    </>
  )
}

function renderPetPdf(doc: EsignDoc): PdfElement {
  const p = (doc.payload ?? {}) as PetPayload
  const q = p.questionnaire
  const branch = effectiveBranch(q)
  const pets: (Pet | null)[] = (p.pets && p.pets.length ? p.pets : [null])
  const title = branch === 'service' ? 'Service Animal Information'
    : branch === 'esa' ? 'Assistance Animal Accommodation Request'
    : branch === 'unsure' ? 'Animal Information'
    : 'Pet Registration'
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <Text style={s.assoc}>{p.associationLegalName ?? doc.association_code}</Text>
        <Text style={s.title}>{title}</Text>
        <View style={s.rule} />
        <View style={s.row}><Text style={s.rowKey}>Unit</Text><Text style={s.rowVal}>{doc.unit_ref ?? '—'}</Text></View>
        <View style={s.row}><Text style={s.rowKey}>Animals listed</Text><Text style={s.rowVal}>{String((p.pets ?? []).length)}</Text></View>

        {q && <QuestionnaireSection q={q} />}

        <Text style={s.sectionTitle}>{branch && branch !== 'pet' ? 'Animal' : 'Pets'}</Text>
        {pets.map((pet, i) => <PetCard key={i} pet={pet} index={i} />)}

        <Text style={s.sectionTitle}>Veterinarian</Text>
        <View style={s.row}><Text style={s.rowKey}>Name</Text><Text style={s.rowVal}>{p.vetName || '—'}</Text></View>
        <View style={s.row}><Text style={s.rowKey}>Phone</Text><Text style={s.rowVal}>{p.vetPhone || '—'}</Text></View>

        <Text style={s.para}>{p.rulesAck || (p.questionnaire ? certificationFor(p.questionnaire) : PET_ACK_DEFAULT)}</Text>
        {p.questionnaire && !petRulesApply(p.questionnaire) && (
          <Text style={{ ...s.para, marginTop: 3, color: MUTED, fontSize: 9 }}>
            The Association&apos;s ordinary pet rules, procedures and fees do NOT apply to an approved service or assistance animal.
          </Text>
        )}
        <SignatureRow doc={doc} def={petRegistration} />
      </Page>
    </Document>
  )
}

/** Pet registration expiry = one year after the EARLIEST rabies vaccination
 *  date across the pets (the soonest-to-lapse), so renewal is prompted before
 *  any pet's vaccination is out of date. Falls back to the applicant's signing
 *  date + 1yr when no rabies date is on file. */
export function petRegistrationExpiry(payload: PetPayload, signedAtIso?: string | null): string | null {
  const dates = (payload.pets ?? []).map(p => p.rabiesDate).filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  const base = dates[0] ?? (signedAtIso ? signedAtIso.slice(0, 10) : null)
  if (!base) return null
  const d = new Date(base + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

const petRegistration: EsignFormDef = {
  kind: 'pet_registration',
  label: 'Animal Information & Accommodation Request',
  roles: ['applicant'],
  roleLabel: () => 'Applicant',
  renderPdf: (doc) => renderPetPdf(doc),
  fillable: true,
  computeExpiry: (doc) => petRegistrationExpiry(doc.payload as PetPayload, doc.signers.find(sg => sg.role === 'applicant')?.signed_at ?? null),
}

// ── Board Decision Page ──────────────────────────────────────────────
export interface BoardDecisionPayload {
  associationLegalName?: string
  propertyAddress?: string
  applicant?: string
  occupants?: string[]
  unit?: string
  applicationType?: string
  decision?: string        // Approved | Approved with conditions | Declined
  conditions?: string
  leaseStart?: string
  leaseEnd?: string
  reason?: string
}

const APP_TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease renewal', additional_occupant: 'Additional occupant' }
const fmtDate = (iso: string | null | undefined) => { if (!iso) return null; const d = new Date(iso + 'T00:00:00Z'); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) }

const boardDecision: EsignFormDef = {
  kind: 'board_decision',
  label: 'Board Decision',
  roles: ['approver'],
  roleLabel: () => 'Board / Authorized Approver',
  renderPdf: (doc) => {
    const p = doc.payload as BoardDecisionPayload
    const declined = /declin/i.test(p.decision ?? '')
    const isLease = p.applicationType === 'lease' || p.applicationType === 'lease_renewal'
    const verb = p.applicationType === 'purchase' ? 'purchase' : p.applicationType === 'additional_occupant' ? 'add the occupant(s) to' : 'lease'
    const start = fmtDate(p.leaseStart), end = fmtDate(p.leaseEnd)
    return (
      <Document>
        <Page size="LETTER" style={s.page}>
          <Text style={s.assoc}>{p.associationLegalName ?? doc.association_code}</Text>
          <Text style={s.title}>Board Decision</Text>
          <View style={s.rule} />
          <View style={s.row}><Text style={s.rowKey}>Date</Text><Text style={s.rowVal}>{new Date(doc.created_at ?? Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</Text></View>
          <View style={s.row}><Text style={s.rowKey}>Property</Text><Text style={s.rowVal}>{p.propertyAddress ?? (p.unit ? `Unit ${p.unit}` : doc.unit_ref ?? '—')}</Text></View>
          <View style={s.row}><Text style={s.rowKey}>Application type</Text><Text style={s.rowVal}>{APP_TYPE_LABEL[p.applicationType ?? ''] ?? p.applicationType ?? '—'}</Text></View>
          <View style={s.row}><Text style={s.rowKey}>Applicant</Text><Text style={s.rowVal}>{p.applicant ?? '—'}</Text></View>
          {isLease && (
            <View style={s.row}><Text style={s.rowKey}>Term</Text><Text style={s.rowVal}>{start && end ? `${start} — ${end}` : '—'}</Text></View>
          )}
          {isLease && end && (
            <View style={s.row}><Text style={s.rowKey}>Expires</Text><Text style={{ ...s.rowVal, color: '#b45309' }}>{end}</Text></View>
          )}
          <View style={s.row}><Text style={s.rowKey}>Decision</Text><Text style={{ ...s.rowVal, color: declined ? '#991b1b' : '#166534' }}>{p.decision ?? 'Approved'}</Text></View>

          <Text style={s.sectionTitle}>Approved occupants</Text>
          {(p.occupants ?? []).length > 0
            ? (p.occupants ?? []).map((o, i) => <Text key={i} style={{ ...s.rowVal, fontSize: 10.5, marginTop: 1 }}>• {o}</Text>)
            : <Text style={{ ...s.para, marginTop: 2 }}>{p.applicant ?? '—'}</Text>}

          <Text style={s.para}>
            The Association&apos;s Board of Directors (or authorized approver) hereby {declined ? 'DECLINES' : 'APPROVES'} the {APP_TYPE_LABEL[p.applicationType ?? '']?.toLowerCase() ?? ''} application of {p.applicant ?? 'the applicant'} to {verb} the property identified above{isLease && start && end ? `, for the term ${start} through ${end}` : ''}, for the occupant(s) listed.
          </Text>
          {p.conditions ? <Text style={s.para}>Conditions: {p.conditions}</Text> : null}
          {p.reason ? <Text style={s.para}>{p.reason}</Text> : null}
          <SignatureRow doc={doc} def={boardDecision} />
        </Page>
      </Document>
    )
  },
}

// ── Rules Knowledge Acknowledgment ───────────────────────────────────
// Replaces the print-sign-scan packet. Two instructions from the paper form
// are deliberately gone: "complete, sign and email it to support@" and
// "complete the application and background check online at …" — MAIA collects
// the documents and orders the background check, so telling the applicant to
// do both somewhere else is now wrong. The four Name/Signature/Date rules at
// the end, and the "___ has been screened on ___" line, are replaced by the
// verified electronic signature block.
//
// The rules themselves are the association's, carried in the payload rather
// than hard-coded, so each association supplies its own.
export interface RulesAckPayload {
  associationLegalName?: string
  propertyAddress?: string
  unit?: string
  applicationType?: string
  applicants?: string[]
  rules?: string[]
  instructions?: string[]
  rulesRevision?: string
  /** Statutory notices the signer is acknowledging — e.g. the §718.116(11)
   *  rent-demand right on a delinquent unit. Set apart from the house rules
   *  because these bind the tenant by statute, not by the Association's
   *  discretion, and a tenant who signs this needs to have actually seen it. */
  statutoryNotices?: { title: string; body: string }[]
}

const rulesKnowledgeAck: EsignFormDef = {
  kind: 'rules_knowledge_ack',
  label: 'Rules Knowledge Acknowledgment',
  roles: ['applicant'],
  roleLabel: () => 'Applicant / Lessee',
  renderPdf: (doc) => {
    const p = doc.payload as RulesAckPayload
    return (
      <Document>
        <Page size="LETTER" style={s.page}>
          <Text style={s.assoc}>{p.associationLegalName ?? doc.association_code}</Text>
          <Text style={s.title}>Rules Knowledge Acknowledgment</Text>
          <View style={s.rule} />
          <View style={s.row}><Text style={s.rowKey}>Property</Text><Text style={s.rowVal}>{p.propertyAddress ?? (p.unit ? `Unit ${p.unit}` : doc.unit_ref ?? '—')}</Text></View>
          <View style={s.row}><Text style={s.rowKey}>Application type</Text><Text style={s.rowVal}>{APP_TYPE_LABEL[p.applicationType ?? ''] ?? p.applicationType ?? '—'}</Text></View>
          <View style={s.row}><Text style={s.rowKey}>Applicant(s)</Text><Text style={s.rowVal}>{(p.applicants ?? []).join(', ') || '—'}</Text></View>
          {p.rulesRevision ? <View style={s.row}><Text style={s.rowKey}>Rules revision</Text><Text style={s.rowVal}>{p.rulesRevision}</Text></View> : null}

          {(p.instructions ?? []).length > 0 && (
            <>
              <Text style={s.sectionTitle}>Instructions</Text>
              {(p.instructions ?? []).map((t, i) => (
                <Text key={i} style={{ ...s.para, marginTop: 3 }}>{i + 1}. {t}</Text>
              ))}
            </>
          )}

          <Text style={s.sectionTitle}>Key rules every applicant must acknowledge</Text>
          {(p.rules ?? []).map((r, i) => (
            <Text key={i} style={{ ...s.para, marginTop: 2 }}>•  {r}</Text>
          ))}

          {(p.statutoryNotices ?? []).map((n, i) => (
            <View key={i} style={s.notice} wrap={false}>
              <Text style={s.noticeTitle}>{n.title}</Text>
              <Text style={s.noticeBody}>{n.body}</Text>
            </View>
          ))}

          <Text style={{ ...s.para, color: MUTED, fontSize: 9 }}>
            The Association&apos;s full Rules and Regulations follow this page and form part of this document.
          </Text>
        </Page>

        {/* The acknowledgment and signatures are a SEPARATE page on purpose. The
            board's own Rules and Regulations pages are spliced in between these
            two (see buildRulesAckPdf), so the signer signs after them — and the
            governing text stays the board's verbatim pages, never retyped. */}
        <Page size="LETTER" style={s.page}>
          <Text style={s.assoc}>{p.associationLegalName ?? doc.association_code}</Text>
          <Text style={s.title}>Acknowledgment</Text>
          <View style={s.rule} />
          <Text style={s.para}>
            I/We, the purchaser(s)/tenant(s) of {p.propertyAddress ?? (p.unit ? `Unit ${p.unit}` : 'the unit identified above')},
            have read and understand all of the foregoing Rules and Regulations and agree to abide by them.
            This acknowledgment does not replace the full Rules and Regulations, Declaration, By-Laws and
            Articles of Incorporation on file with the Association, all of which govern in case of any conflict.
          </Text>
          <SignatureRow doc={doc} def={rulesKnowledgeAck} />
        </Page>
      </Document>
    )
  },
}

const REGISTRY: Record<string, EsignFormDef> = {
  [associationAcknowledgment.kind]: associationAcknowledgment,
  [petRegistration.kind]: petRegistration,
  [boardDecision.kind]: boardDecision,
  [rulesKnowledgeAck.kind]: rulesKnowledgeAck,
}

export const PET_ACK = PET_ACK_DEFAULT

export function getFormDef(kind: string): EsignFormDef | null { return REGISTRY[kind] ?? null }
export function requiredRoles(kind: string): string[] { return REGISTRY[kind]?.roles ?? [] }
export function roleLabel(kind: string, role: string): string { return REGISTRY[kind]?.roleLabel(role) ?? role }
export function renderFormPdf(doc: EsignDoc): PdfElement | null { return REGISTRY[doc.kind]?.renderPdf(doc) ?? null }
export function isFillable(kind: string): boolean { return !!REGISTRY[kind]?.fillable }
export function computeFormExpiry(doc: EsignDoc): string | null { return REGISTRY[doc.kind]?.computeExpiry?.(doc) ?? null }
