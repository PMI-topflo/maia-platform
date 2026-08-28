// =====================================================================
// lib/application-guide-pdf.tsx
//
// Renders one ApplicationGuideData (lib/application-guide-data.ts) as a
// downloadable PDF. Pure — takes data, returns a react-pdf Document; no
// fetching here (mirrors lib/intl-cpa-guide-pdf.tsx's separation of data
// assembly from rendering).
// =====================================================================

import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { ApplicationGuideData, GuideChecklistRow } from '@/lib/application-guide-data'
import type { ApplicationType } from '@/lib/intake-documents'

const NAVY = '#1f2a44', ORANGE = '#f26a1b', MUTED = '#6b7280', INK = '#2b2f38'
const BLOCK = '#b91c1c', WARN = '#92400e'

// Rule/checklist text is live, staff-editable content (association_
// application_rules.label, association_intake_documents.label) — not
// authored for this PDF. The default Helvetica font only covers WinAnsi
// (Windows-1252), so a character like → (confirmed via a real generated
// PDF: it silently mangled into a stray glyph) has to be swapped for
// something the font actually has, rather than trusting every future edit
// in the admin UI to stay WinAnsi-safe.
function pdfSafe(text: string): string {
  return text.replace(/→/g, '->').replace(/←/g, '<-')
}

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9.5, fontFamily: 'Helvetica', color: INK, lineHeight: 1.4 },
  masthead: { borderBottomWidth: 2, borderBottomColor: ORANGE, paddingBottom: 10, marginBottom: 16 },
  kicker: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase', letterSpacing: 1 },
  assocName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 3 },
  meta: { fontSize: 8.5, color: MUTED, marginTop: 2 },
  dek: { fontSize: 9.5, color: INK, marginTop: 6 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, marginBottom: 4 },
  sectionNum: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: ORANGE },
  sectionTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: NAVY },
  sectionDek: { fontSize: 8.5, color: MUTED, marginBottom: 8 },

  ruleGroup: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 8, marginBottom: 3 },
  ruleRow: { flexDirection: 'row', marginTop: 3, gap: 6 },
  ruleRail: { width: 3, borderRadius: 1.5 },
  ruleText: { fontSize: 9, flex: 1, lineHeight: 1.4 },

  step: { flexDirection: 'row', gap: 8, marginTop: 7 },
  stepNum: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#fff', backgroundColor: ORANGE, width: 15, height: 15, borderRadius: 7.5, textAlign: 'center', paddingTop: 2.5 },
  stepBody: { flex: 1 },
  stepTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: NAVY },
  stepText: { fontSize: 9, color: INK, marginTop: 1, lineHeight: 1.4 },

  factBox: { borderWidth: 1, borderColor: '#fde68a', backgroundColor: '#fffbeb', borderRadius: 5, padding: 8, marginTop: 12, fontSize: 9 },

  tableHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: NAVY, paddingBottom: 3, marginTop: 6 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb', paddingVertical: 3 },
  colDoc: { flex: 2.6, fontSize: 8.5 },
  colFrom: { flex: 0.9, fontSize: 8.5, color: MUTED },
  colTypeHead: { flex: 0.75, fontSize: 8.5, textAlign: 'center' },
  colTypeWrap: { flex: 0.75, alignItems: 'center' },
  colType: { fontSize: 8.5, textAlign: 'center' },
  colTypeSub: { fontSize: 6, color: BLOCK, textAlign: 'center', marginTop: 1 },
  headText: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: NAVY, textTransform: 'uppercase' },
  legend: { fontSize: 7.5, color: MUTED, marginTop: 6, lineHeight: 1.5 },

  regRow: { flexDirection: 'row', marginTop: 5, gap: 6 },
  regTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: NAVY },
  regBody: { fontSize: 9, color: INK, flex: 1 },

  footer: { marginTop: 20, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e5e7eb', fontSize: 7.5, color: MUTED, lineHeight: 1.5 },
})

const TYPE_HEAD: { key: ApplicationType; label: string }[] = [
  { key: 'lease', label: 'Lease' }, { key: 'lease_renewal', label: 'Renewal' },
  { key: 'purchase', label: 'Purchase' }, { key: 'additional_occupant', label: "Add'l Occ." },
]

function RuleRow({ text, enforcement }: { text: string; enforcement: 'block' | 'warn' }) {
  return (
    <View style={s.ruleRow} wrap={false}>
      <View style={{ ...s.ruleRail, backgroundColor: enforcement === 'block' ? BLOCK : WARN }} />
      <Text style={s.ruleText}>{pdfSafe(text)}</Text>
    </View>
  )
}

// occupant_affidavit is only required for occupants 18 and over — minors
// listed as additional occupants don't need one, so the Add'l Occ. column
// carries a small red reminder of that carve-out (user direction, 2026-08-28).
const OVER_18_NOTE_DOC_KEY = 'occupant_affidavit'

function ChecklistRow({ row }: { row: GuideChecklistRow }) {
  return (
    <View style={s.tableRow} wrap={false}>
      <Text style={s.colDoc}>{pdfSafe(row.label)}</Text>
      <Text style={s.colFrom}>{row.from}</Text>
      {TYPE_HEAD.map(t => (
        <View key={t.key} style={s.colTypeWrap}>
          <Text style={s.colType}>{row.cells[t.key]}</Text>
          {t.key === 'additional_occupant' && row.docKey === OVER_18_NOTE_DOC_KEY && (
            <Text style={s.colTypeSub}>(over 18yr.)</Text>
          )}
        </View>
      ))}
    </View>
  )
}

export function ApplicationGuidePdf({ data }: { data: ApplicationGuideData }) {
  const m = data.masthead
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <View style={s.masthead}>
          <Text style={s.kicker}>Application Guide</Text>
          <Text style={s.assocName}>{m.legalName}</Text>
          <Text style={s.meta}>{m.address} · {m.statute}</Text>
          <Text style={s.dek}>{m.dek}</Text>
        </View>

        <View style={s.sectionHead}><Text style={s.sectionNum}>§1</Text><Text style={s.sectionTitle}>Eligibility &amp; Restrictions</Text></View>
        <Text style={s.sectionDek}>Grouped by who it applies to — you only need to read what&apos;s relevant to your application.</Text>
        {data.ruleGroups.map(g => (
          <View key={g.key}>
            <Text style={s.ruleGroup}>{g.label}</Text>
            {g.rules.map((r, i) => <RuleRow key={`r${i}`} text={r.text} enforcement={r.enforcement} />)}
            {g.notes.map((n, i) => <RuleRow key={`n${i}`} text={n} enforcement="warn" />)}
          </View>
        ))}

        <View style={s.sectionHead}><Text style={s.sectionNum}>§2</Text><Text style={s.sectionTitle}>Application Process</Text></View>
        <Text style={s.sectionDek}>The same steps for every application type; purchases add an interview and one document-ordering step.</Text>
        {data.steps.map((st, i) => (
          <View key={i} style={s.step} wrap={false}>
            <Text style={s.stepNum}>{i + 1}</Text>
            <View style={s.stepBody}>
              <Text style={s.stepTitle}>{st.title}</Text>
              <Text style={s.stepText}>{st.body}</Text>
            </View>
          </View>
        ))}
        <View style={s.factBox} wrap={false}><Text>{data.renewalNote}</Text></View>

        <View style={s.sectionHead}><Text style={s.sectionNum}>§3</Text><Text style={s.sectionTitle}>Document Checklist</Text></View>
        <Text style={s.sectionDek}>What&apos;s needed, by application type. &quot;if applic.&quot; items only apply if you have a vehicle, a pet, or (for renewals) an expired ID.</Text>
        <View style={s.tableHead} wrap={false}>
          <Text style={{ ...s.colDoc, ...s.headText }}>Document</Text>
          <Text style={{ ...s.colFrom, ...s.headText }}>From</Text>
          {TYPE_HEAD.map(t => <Text key={t.key} style={{ ...s.colTypeHead, ...s.headText }}>{t.label}</Text>)}
        </View>
        {data.checklist.map((row, i) => <ChecklistRow key={i} row={row} />)}
        <Text style={s.legend}>Req = required · if applic. = only asked if you confirm it applies to you · Optional = helps your file, not required · — = not part of this application type</Text>

        <View style={s.sectionHead}><Text style={s.sectionNum}>§4</Text><Text style={s.sectionTitle}>After Your Approval</Text></View>
        <Text style={s.sectionDek}>Not part of the application — separate, move-in-only registrations sent alongside your approval letter once you&apos;re already approved.</Text>
        {data.afterApproval.map((r, i) => (
          <View key={i} style={s.regRow} wrap={false}>
            <Text style={s.regTitle}>{r.title}</Text>
            <Text style={s.regBody}>{r.body}</Text>
          </View>
        ))}

        <View style={s.footer}><Text>{data.footer}</Text></View>
      </Page>
    </Document>
  )
}
