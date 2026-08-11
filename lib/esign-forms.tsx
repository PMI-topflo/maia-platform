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

type PdfElement = ReactElement<DocumentProps>

export interface EsignFormDef {
  kind: string
  label: string
  roles: string[]                         // required signer roles, in signing order
  roleLabel: (role: string) => string
  renderPdf: (doc: EsignDoc) => PdfElement
  /** Fillable forms (e.g. pet registration): the applicant enters data before
   *  signing. `renderBlank` produces a printable empty copy. */
  fillable?: boolean
  renderBlank?: (doc: EsignDoc) => PdfElement
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
        <Text style={s.sigPending}>Awaiting electronic signature.</Text>
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
}

const PET_ACK_DEFAULT =
  'I certify the information above is true and complete. I have read and agree to comply with the Association’s pet rules and restrictions, I will keep each pet’s vaccinations current, and I understand registration may be revoked for violations.'

const petStyles = StyleSheet.create({
  petCard: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, padding: 7, marginTop: 6, fontSize: 9 },
  petTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: NAVY, marginBottom: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', paddingVertical: 1.5, flexDirection: 'row' },
  cellK: { color: MUTED, width: 82, fontSize: 9 }, cellV: { fontFamily: 'Helvetica-Bold', flex: 1, fontSize: 9 },
  blankLine: { borderBottomWidth: 1, borderBottomColor: '#9ca3af', flex: 1, marginLeft: 4, height: 8 },
})

function petCell(k: string, v: string | undefined, blank: boolean) {
  return (
    <View style={petStyles.cell}>
      <Text style={petStyles.cellK}>{k}</Text>
      {blank ? <View style={petStyles.blankLine} /> : <Text style={petStyles.cellV}>{v && v.trim() ? v : '—'}</Text>}
    </View>
  )
}

function PetCard({ pet, index, blank }: { pet: Pet | null; index: number; blank: boolean }) {
  const p = pet ?? {}
  return (
    <View style={petStyles.petCard} wrap={false}>
      <Text style={petStyles.petTitle}>Pet {index + 1}</Text>
      <View style={petStyles.grid}>
        {petCell('Type', p.type, blank)}
        {petCell('Name', p.name, blank)}
        {petCell('Breed', p.breed, blank)}
        {petCell('Color', p.color, blank)}
        {petCell('Weight (lb)', p.weight, blank)}
        {petCell('Age', p.age, blank)}
        {petCell('Sex', p.sex, blank)}
        {petCell('Spayed/Neutered', blank ? undefined : (p.altered ? 'Yes' : 'No'), blank)}
        {petCell('License / Tag #', p.license, blank)}
        {petCell('Rabies vax date', p.rabiesDate, blank)}
        {petCell('Service/ESA', blank ? undefined : (p.serviceAnimal ? 'Yes' : 'No'), blank)}
        {petCell('Vax record', blank ? undefined : (p.vaccinationDoc?.filename ? 'on file' : 'not provided'), blank)}
      </View>
    </View>
  )
}

function renderPetPdf(doc: EsignDoc, blank: boolean): PdfElement {
  const p = (doc.payload ?? {}) as PetPayload
  const limit = Math.max(1, p.petLimit ?? 2)
  const pets: (Pet | null)[] = blank
    ? Array.from({ length: limit }, () => null)
    : (p.pets && p.pets.length ? p.pets : [null])
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <Text style={s.assoc}>{p.associationLegalName ?? doc.association_code}</Text>
        <Text style={s.title}>Pet Registration</Text>
        <View style={s.rule} />
        <View style={s.row}><Text style={s.rowKey}>Unit</Text><Text style={s.rowVal}>{doc.unit_ref ?? '—'}</Text></View>
        <View style={s.row}><Text style={s.rowKey}>Pets registered</Text><Text style={s.rowVal}>{blank ? `up to ${limit}` : String((p.pets ?? []).length)}</Text></View>

        <Text style={s.sectionTitle}>Pets</Text>
        {pets.map((pet, i) => <PetCard key={i} pet={pet} index={i} blank={blank} />)}

        <Text style={s.sectionTitle}>Veterinarian</Text>
        <View style={s.row}><Text style={s.rowKey}>Name</Text>{blank ? <View style={petStyles.blankLine} /> : <Text style={s.rowVal}>{p.vetName || '—'}</Text>}</View>
        <View style={s.row}><Text style={s.rowKey}>Phone</Text>{blank ? <View style={petStyles.blankLine} /> : <Text style={s.rowVal}>{p.vetPhone || '—'}</Text>}</View>

        <Text style={s.para}>{p.rulesAck || PET_ACK_DEFAULT}</Text>
        {!blank && <SignatureRow doc={doc} def={petRegistration} />}
        {blank && (
          <>
            <Text style={s.sectionTitle}>Signature</Text>
            <View style={s.row}><Text style={s.rowKey}>Applicant</Text><View style={petStyles.blankLine} /></View>
            <View style={s.row}><Text style={s.rowKey}>Date</Text><View style={petStyles.blankLine} /></View>
          </>
        )}
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
  label: 'Pet Registration',
  roles: ['applicant'],
  roleLabel: () => 'Applicant',
  renderPdf: (doc) => renderPetPdf(doc, false),
  renderBlank: (doc) => renderPetPdf(doc, true),
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

const REGISTRY: Record<string, EsignFormDef> = {
  [associationAcknowledgment.kind]: associationAcknowledgment,
  [petRegistration.kind]: petRegistration,
  [boardDecision.kind]: boardDecision,
}

export const PET_ACK = PET_ACK_DEFAULT

export function getFormDef(kind: string): EsignFormDef | null { return REGISTRY[kind] ?? null }
export function requiredRoles(kind: string): string[] { return REGISTRY[kind]?.roles ?? [] }
export function roleLabel(kind: string, role: string): string { return REGISTRY[kind]?.roleLabel(role) ?? role }
export function renderFormPdf(doc: EsignDoc): PdfElement | null { return REGISTRY[doc.kind]?.renderPdf(doc) ?? null }
export function renderFormBlank(doc: EsignDoc): PdfElement | null { return REGISTRY[doc.kind]?.renderBlank?.(doc) ?? null }
export function isFillable(kind: string): boolean { return !!REGISTRY[kind]?.fillable }
export function computeFormExpiry(doc: EsignDoc): string | null { return REGISTRY[doc.kind]?.computeExpiry?.(doc) ?? null }
