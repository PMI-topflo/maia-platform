// =====================================================================
// lib/rules-acknowledgment-pdf.tsx
// A signed acknowledgment certificate: which governing documents the
// applicant(s) reviewed, their signature (drawn image if captured,
// else typed name), printed name, date, and the audit trail (IP,
// geolocation, photo) captured at signing. Not a re-typeset copy of the
// Rules & Regulations themselves -- those are linked as the real PDF
// the applicant actually viewed, referenced by filename/version here.
// =====================================================================

import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'

const NAVY   = '#1f2a44'
const ORANGE = '#f26a1b'
const INK    = '#2b2f38'
const MUTED  = '#6b7280'
const LINE   = '#e5e7eb'

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: INK },
  header: { borderBottomWidth: 2, borderBottomColor: ORANGE, paddingBottom: 10, marginBottom: 18 },
  brand: { fontSize: 10, color: MUTED, fontFamily: 'Helvetica-Bold' },
  title: { fontSize: 16, color: NAVY, fontFamily: 'Helvetica-Bold', marginTop: 4 },

  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 6 },
  rowLabel: { width: 130, fontFamily: 'Helvetica-Bold', color: MUTED, fontSize: 9 },
  rowValue: { flex: 1, fontSize: 10 },

  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 20, marginBottom: 8 },
  sectionRule: { borderBottomWidth: 1.5, borderBottomColor: ORANGE, marginBottom: 10 },

  docRow: { flexDirection: 'row', marginBottom: 5 },
  docBullet: { width: 10, color: ORANGE },
  docText: { flex: 1, fontSize: 9.5 },

  sigBox: { marginTop: 12, borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 16 },
  sigImage: { width: 220, height: 80, objectFit: 'contain' },
  sigTyped: { fontSize: 22, fontFamily: 'Helvetica-Oblique', color: INK, marginBottom: 4 },
  sigLine: { borderBottomWidth: 1, borderBottomColor: '#9ca3af', width: 260, marginTop: 6, marginBottom: 4 },
  sigLabel: { fontSize: 8, color: MUTED },
  sigMeta: { fontSize: 9.5, marginTop: 10 },

  photoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 10 },
  photo: { width: 70, height: 70, objectFit: 'cover', borderRadius: 3 },

  auditBox: { marginTop: 20, paddingTop: 8, borderTopWidth: 1, borderTopColor: LINE },
  auditText: { fontSize: 7.5, color: MUTED, lineHeight: 1.5 },
})

export interface AckDocEntry {
  category: string
  categoryLabel: string
  filename: string | null
  effectiveDate: string | null
}

export interface RulesAcknowledgmentPdfProps {
  refId: string
  association: string
  applicantNames: string[]
  unit: string | null
  ackDocs: AckDocEntry[]
  signatureTyped: string | null
  signatureImageDataUrl: string | null
  applicantPhotoDataUrl: string | null
  agreedAt: string | null
  geolocation: { lat: number; lon: number; accuracy_meters: number } | null
  ip: string | null
}

export function RulesAcknowledgmentPdf(props: RulesAcknowledgmentPdfProps) {
  const {
    refId, association, applicantNames, unit, ackDocs,
    signatureTyped, signatureImageDataUrl, applicantPhotoDataUrl,
    agreedAt, geolocation, ip,
  } = props

  const agreedDate = agreedAt ? new Date(agreedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) : null

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <Text style={s.brand}>PMI TOP FLORIDA PROPERTIES</Text>
          <Text style={s.title}>Rules &amp; Regulations Acknowledgment</Text>
        </View>

        <View style={s.row}><Text style={s.rowLabel}>Reference</Text><Text style={s.rowValue}>{refId}</Text></View>
        <View style={s.row}><Text style={s.rowLabel}>Association</Text><Text style={s.rowValue}>{association}</Text></View>
        <View style={s.row}><Text style={s.rowLabel}>Applicant(s)</Text><Text style={s.rowValue}>{applicantNames.join(', ') || '—'}</Text></View>
        {unit && <View style={s.row}><Text style={s.rowLabel}>Unit</Text><Text style={s.rowValue}>{unit}</Text></View>}

        <Text style={s.sectionTitle}>Documents Reviewed &amp; Acknowledged</Text>
        <View style={s.sectionRule} />
        {ackDocs.length === 0 ? (
          <Text style={{ fontSize: 9.5, color: MUTED }}>No governing documents were on file to acknowledge at signing.</Text>
        ) : ackDocs.map((d, i) => (
          <View key={i} style={s.docRow}>
            <Text style={s.docBullet}>•</Text>
            <Text style={s.docText}>
              {d.categoryLabel}{d.filename ? ` — ${d.filename}` : ''}{d.effectiveDate ? ` (effective ${d.effectiveDate})` : ''}
            </Text>
          </View>
        ))}

        <Text style={s.sectionTitle}>Signature</Text>
        <View style={s.sectionRule} />
        <View style={s.sigBox}>
          {signatureImageDataUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image>, not an HTML <img>
            <Image src={signatureImageDataUrl} style={s.sigImage} />
          ) : signatureTyped ? (
            <Text style={s.sigTyped}>{signatureTyped}</Text>
          ) : (
            <Text style={{ fontSize: 10, color: MUTED }}>No signature on file.</Text>
          )}
          <View style={s.sigLine} />
          <Text style={s.sigLabel}>Signature</Text>
          <Text style={s.sigMeta}>
            Printed name: {signatureTyped ?? '—'}{'\n'}
            Signed: {agreedDate ?? '—'}
          </Text>
          {applicantPhotoDataUrl && (
            <View style={s.photoRow}>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image>, not an HTML <img> */}
              <Image src={applicantPhotoDataUrl} style={s.photo} />
              <Text style={{ fontSize: 8, color: MUTED }}>Applicant photo captured at the time of signing</Text>
            </View>
          )}
        </View>

        <View style={s.auditBox}>
          <Text style={s.auditText}>
            Audit trail — IP address: {ip ?? 'not captured'}
            {geolocation ? ` · Location: ${geolocation.lat.toFixed(5)}, ${geolocation.lon.toFixed(5)} (±${Math.round(geolocation.accuracy_meters)}m)` : ' · Location: not captured'}
          </Text>
        </View>
      </Page>
    </Document>
  )
}
