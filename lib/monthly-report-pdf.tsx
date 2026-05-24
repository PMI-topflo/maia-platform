// =====================================================================
// lib/monthly-report-pdf.tsx
//
// Server-side PDF of the monthly management report (@react-pdf/renderer).
// Unlike browser "Save as PDF", this produces a true PDF with a real
// repeating header bar on every page after the first, deterministic
// page breaks, and consistent margins.
// =====================================================================

import {
  Document, Page, View, Text, Image, StyleSheet,
} from '@react-pdf/renderer'
import type { ReactNode } from 'react'

import type { FinancialFigures } from '@/lib/report-financials'

const NAVY   = '#1f2a44'
const ORANGE = '#f26a1b'
const INK    = '#2b2f38'
const MUTED  = '#6b7280'
const LINE   = '#e5e7eb'

// Page padding-top reserves space for the running header bar (pages 2+).
const TOP = 58

const s = StyleSheet.create({
  page: { paddingTop: TOP, paddingBottom: 44, fontSize: 10, fontFamily: 'Helvetica', color: INK },

  // Running header — pages 2+
  runBar: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 40,
    backgroundColor: NAVY, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 40,
  },
  runLogo: { height: 17 },
  runText: { color: '#aab3c5', fontSize: 7, letterSpacing: 0.5 },

  // Hero — page 1 (negative margin pulls it flush above the page padding)
  hero: { backgroundColor: NAVY, paddingHorizontal: 40, paddingTop: 34, paddingBottom: 26, marginTop: -TOP },
  heroLogo: { height: 46 },
  heroTitle: { color: '#ffffff', fontSize: 23, fontFamily: 'Helvetica-Bold', marginTop: 16 },
  heroSub: { color: '#d7dbe4', fontSize: 11, marginTop: 4 },

  content: { paddingHorizontal: 40, paddingTop: 16 },

  // Stat cards
  statRow: { flexDirection: 'row', gap: 7, marginBottom: 4 },
  stat: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 5, paddingVertical: 9, alignItems: 'center' },
  statN: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: NAVY },
  statL: { fontSize: 6.5, color: MUTED, marginTop: 2, textTransform: 'uppercase' },

  // Sections
  section: { marginTop: 16 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { width: 16, height: 16, borderRadius: 8, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 8, fontFamily: 'Helvetica-Bold' },
  sectionTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: NAVY },
  sectionRule: { borderBottomWidth: 1.5, borderBottomColor: ORANGE, marginTop: 4 },

  para: { fontSize: 9.5, lineHeight: 1.5, marginTop: 6, color: '#3a3f4a' },
  h3:   { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 8 },

  bullets: { marginTop: 5 },
  bulletRow: { flexDirection: 'row', marginTop: 3 },
  dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: ORANGE, marginTop: 5, marginRight: 7 },
  bulletText: { fontSize: 9.5, lineHeight: 1.5, flex: 1, color: '#3a3f4a' },

  footer: { marginTop: 22, paddingTop: 8, borderTopWidth: 1, borderTopColor: LINE },
  footerText: { fontSize: 7.5, color: MUTED },

  // Financial summary
  finBlock: { marginTop: 16 },
  finTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: NAVY },
  finRule:  { borderBottomWidth: 1.5, borderBottomColor: ORANGE, marginTop: 4 },
  finGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  finCard:  { width: '32%', borderWidth: 1, borderColor: LINE, borderRadius: 5, paddingVertical: 7, paddingHorizontal: 8 },
  finValue: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', color: NAVY },
  finLabel: { fontSize: 6, color: MUTED, marginTop: 2, textTransform: 'uppercase' },
  finNote:  { fontSize: 5.5, color: MUTED, marginTop: 1 },
  finNotes: { fontSize: 8, color: MUTED, marginTop: 7 },
})

/** Inline **bold** within a line. */
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <Text key={i} style={{ fontFamily: 'Helvetica-Bold' }}>{part.slice(2, -2)}</Text>
      : <Text key={i}>{part}</Text>,
  )
}

/** Parse the report markdown into react-pdf elements. */
function renderNarrative(md: string): ReactNode[] {
  const lines = md.split(/\r?\n/)
  const out: ReactNode[] = []
  let bullets: string[] = []
  let sectionNum = 0
  let key = 0

  const flushBullets = () => {
    if (bullets.length === 0) return
    const items = bullets
    bullets = []
    out.push(
      <View key={`b${key++}`} style={s.bullets}>
        {items.map((b, i) => (
          <View key={i} style={s.bulletRow} wrap={false}>
            <View style={s.dot} />
            <Text style={s.bulletText}>{inline(b)}</Text>
          </View>
        ))}
      </View>,
    )
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (/^[-*]\s+/.test(line)) { bullets.push(line.replace(/^[-*]\s+/, '')); continue }
    flushBullets()
    if (!line) continue

    if (line.startsWith('## ')) {
      sectionNum += 1
      const text = line.slice(3).replace(/^\d+[.)]\s*/, '')
      out.push(
        <View key={`h${key++}`} style={s.section} minPresenceAhead={54}>
          <View style={s.sectionHead}>
            <View style={s.badge}><Text style={s.badgeText}>{sectionNum}</Text></View>
            <Text style={s.sectionTitle}>{inline(text)}</Text>
          </View>
          <View style={s.sectionRule} />
        </View>,
      )
    } else if (line.startsWith('### ')) {
      out.push(<Text key={`x${key++}`} style={s.h3}>{inline(line.slice(4))}</Text>)
    } else if (line.startsWith('# ')) {
      out.push(<Text key={`x${key++}`} style={[s.sectionTitle, { marginTop: 10 }]}>{inline(line.slice(2))}</Text>)
    } else {
      out.push(<Text key={`p${key++}`} style={s.para}>{inline(line)}</Text>)
    }
  }
  flushBullets()
  return out
}

export interface MonthlyReportPdfProps {
  scopeLabel:    string
  monthLabel:    string
  markdown:      string
  generatedLine: string
  logoDataUri:   string
  totals: {
    ticketsReceived: number; ticketsClosed: number
    workOrdersReceived: number; workOrdersClosed: number
    emailThreadsReceived: number
    maiaResolved: number
  }
  financials?:   FinancialFigures | null
}

/** The PMI logo, or a text fallback if the image couldn't be loaded. */
function Logo({ src, height }: { src: string; height: number }) {
  // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image>, not an HTML <img>
  if (src) return <Image src={src} style={{ height }} />
  return (
    <Text style={{ color: '#ffffff', fontFamily: 'Helvetica-Bold', fontSize: Math.max(8, height * 0.42) }}>
      PMI TOP FLORIDA PROPERTIES
    </Text>
  )
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statN}>{n}</Text>
      <Text style={s.statL}>{label}</Text>
    </View>
  )
}

/** The "Financial Summary" block — figures extracted from the uploaded
 *  CINC statement. Renders nothing when there are no figures. */
function Financials({ figures }: { figures: FinancialFigures }) {
  if (figures.headline.length === 0) return null
  const title = `Financial Summary${figures.period_label ? ` — ${figures.period_label}` : ''}`
  return (
    <View style={s.finBlock} minPresenceAhead={80}>
      <Text style={s.finTitle}>{title}</Text>
      <View style={s.finRule} />
      <View style={s.finGrid}>
        {figures.headline.map((f, i) => (
          <View key={i} style={s.finCard} wrap={false}>
            <Text style={s.finValue}>{f.value}</Text>
            <Text style={s.finLabel}>{f.label}</Text>
            {f.note ? <Text style={s.finNote}>{f.note}</Text> : null}
          </View>
        ))}
      </View>
      {figures.notes ? <Text style={s.finNotes}>{figures.notes}</Text> : null}
    </View>
  )
}

export function MonthlyReportPdf(p: MonthlyReportPdfProps) {
  const runText = `MONTHLY MANAGEMENT REPORT  ·  ${p.scopeLabel}  ·  ${p.monthLabel}`.toUpperCase()
  return (
    <Document>
      <Page size="LETTER" style={s.page}>

        {/* Running header — repeats on every page; hidden on page 1. */}
        <View
          fixed
          render={({ pageNumber }) => pageNumber === 1 ? null : (
            <View style={s.runBar}>
              <Logo src={p.logoDataUri} height={17} />
              <Text style={s.runText}>{runText}</Text>
            </View>
          )}
        />

        {/* Hero — page 1 */}
        <View style={s.hero}>
          <Logo src={p.logoDataUri} height={46} />
          <Text style={s.heroTitle}>Monthly Management Report</Text>
          <Text style={s.heroSub}>{p.scopeLabel}  ·  {p.monthLabel}</Text>
        </View>

        <View style={s.content}>
          {/* Month at a glance */}
          <View style={s.statRow}>
            <Stat n={p.totals.ticketsReceived}      label="Tickets recd" />
            <Stat n={p.totals.ticketsClosed}        label="Tickets closed" />
            <Stat n={p.totals.workOrdersReceived}   label="Work orders" />
            <Stat n={p.totals.workOrdersClosed}     label="WOs completed" />
            <Stat n={p.totals.emailThreadsReceived} label="Email threads" />
            <Stat n={p.totals.maiaResolved}         label="MAIA resolved" />
          </View>

          {/* Financial summary — figures from the uploaded statement */}
          {p.financials ? <Financials figures={p.financials} /> : null}

          {/* Narrative */}
          {renderNarrative(p.markdown)}

          {/* Footer */}
          <View style={s.footer}>
            <Text style={s.footerText}>{p.generatedLine}</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
