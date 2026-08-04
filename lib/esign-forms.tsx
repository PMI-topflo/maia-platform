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
}

// ── Shared PDF pieces ────────────────────────────────────────────────
const NAVY = '#1f2a44', MUTED = '#6b7280'
const s = StyleSheet.create({
  page: { padding: 44, fontSize: 11, fontFamily: 'Helvetica', color: '#1a1a1a', lineHeight: 1.5 },
  assoc: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 4, marginBottom: 2 },
  rule: { borderBottomWidth: 2, borderBottomColor: '#f26a1b', width: 60, marginTop: 6, marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 14, marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#f0f0f0', paddingVertical: 5 },
  rowKey: { color: MUTED }, rowVal: { fontFamily: 'Helvetica-Bold' },
  para: { marginTop: 8, color: '#333' },
  sigWrap: { flexDirection: 'row', gap: 16, marginTop: 14 },
  sigBox: { flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, padding: 12, minHeight: 120 },
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
  return (
    <>
      <Text style={s.sectionTitle}>Electronic Signatures</Text>
      <View style={s.sigWrap}>
        {def.roles.map(role => <EsignSigBlock key={role} label={def.roleLabel(role)} signer={doc.signers.find(x => x.role === role) ?? null} />)}
      </View>
    </>
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

const REGISTRY: Record<string, EsignFormDef> = {
  [associationAcknowledgment.kind]: associationAcknowledgment,
}

export function getFormDef(kind: string): EsignFormDef | null { return REGISTRY[kind] ?? null }
export function requiredRoles(kind: string): string[] { return REGISTRY[kind]?.roles ?? [] }
export function roleLabel(kind: string, role: string): string { return REGISTRY[kind]?.roleLabel(role) ?? role }
export function renderFormPdf(doc: EsignDoc): PdfElement | null { return REGISTRY[doc.kind]?.renderPdf(doc) ?? null }
