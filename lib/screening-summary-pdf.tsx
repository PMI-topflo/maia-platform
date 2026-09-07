// =====================================================================
// lib/screening-summary-pdf.tsx
//
// A colorful, MAIA-branded ONE-PAGE SUMMARY of a completed Checkr report
// (@react-pdf/renderer, same pattern as lib/monthly-report-pdf.tsx) --
// built from the exact same parsed data as components/
// ScreeningReportSummary.tsx (lib/screening/report-summary.ts's
// summarizeReport()), so the numbers here always match what's on screen.
//
// This is explicitly NOT a replacement for Checkr's own report PDF --
// that PDF is the actual FCRA consumer report (required disclosures,
// dispute-rights language, the CRA's own exact wording) and stays the
// retained record, downloaded unchanged via the existing "View report"
// link. This is a supplementary at-a-glance export for staff/board, and
// says so in its own footer.
// =====================================================================

import { Document, Page, View, Text, Svg, Path, Circle, Line, StyleSheet } from '@react-pdf/renderer'
import type { ReportSummary, CreditSummary } from '@/lib/screening/report-summary'
import { creditScoreBand, sectionStatusColors } from '@/lib/screening/report-summary'

const NAVY = '#1f2a44'
const ORANGE = '#f26a1b'
const INK = '#2b2f38'
const MUTED = '#6b7280'
const LINE = '#e5e7eb'
const GREEN = '#1a6b3c'
const GREEN_TINT = '#eaf6ef'
const SPOTLIGHT_BG = '#14152b'
const SPOTLIGHT_CHIP = '#23264d'
const SPOTLIGHT_GOLD = '#f5c26b'

const s = StyleSheet.create({
  page: { paddingHorizontal: 38, paddingVertical: 26, fontSize: 9.5, fontFamily: 'Helvetica', color: INK },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  eyebrow: { fontSize: 7.5, color: ORANGE, fontFamily: 'Helvetica-Bold', letterSpacing: 1, textTransform: 'uppercase' },
  name: { fontSize: 19, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 3 },
  sub: { fontSize: 9, color: MUTED, marginTop: 2 },
  metaBox: { alignItems: 'flex-end' },
  metaText: { fontSize: 8, color: MUTED, marginTop: 1 },

  tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 10 },
  tile: { flexBasis: '31.5%', flexDirection: 'row', gap: 6, alignItems: 'center', borderWidth: 1, borderColor: LINE, borderRadius: 6, padding: 6 },
  tileIcon: { width: 22, height: 22, borderRadius: 6, backgroundColor: GREEN_TINT, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 6, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.3 },
  tileValue: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 1 },
  tileNote: { fontSize: 6.5, color: MUTED, marginTop: 1 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 7 },
  badge: { width: 15, height: 15, borderRadius: 7.5, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', color: NAVY },
  sectionRule: { flex: 1, borderBottomWidth: 1, borderBottomColor: LINE, marginLeft: 4 },
  section: { marginBottom: 10 },

  creditCard: { borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 10 },
  creditTop: { flexDirection: 'row', gap: 20 },
  scoreLabel: { fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 },
  scoreNum: { fontSize: 30, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 2 },
  bandPill: { alignSelf: 'flex-start', fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingHorizontal: 8, paddingVertical: 2.5, borderRadius: 8, marginTop: 4 },
  gaugeWrap: { flex: 1, justifyContent: 'center' },
  gaugeLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  gaugeLabelText: { fontSize: 6, color: MUTED },
  gaugeNote: { fontSize: 7.5, color: MUTED, marginTop: 8, lineHeight: 1.4 },

  statRow2: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  stat2: { flexBasis: '18.4%', borderWidth: 1, borderColor: LINE, borderRadius: 6, padding: 6, backgroundColor: '#fafafa' },
  stat2Label: { fontSize: 5.6, color: MUTED, textTransform: 'uppercase' },
  stat2Value: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 2 },

  trendBlock: { marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: LINE },
  trendHeadRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 5 },
  trendValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: NAVY },
  trendSub: { fontSize: 7.5, color: MUTED },

  recordCard: { flexDirection: 'row', gap: 10, alignItems: 'center', borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 8 },
  recordIcon: { width: 28, height: 28, borderRadius: 7, backgroundColor: GREEN_TINT, alignItems: 'center', justifyContent: 'center' },
  recordTitle: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', color: NAVY },
  recordStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  recordStatusText: { fontSize: 8, fontFamily: 'Helvetica-Bold' },
  recordScope: { fontSize: 7.5, color: MUTED, marginTop: 4 },

  spotlight: { backgroundColor: SPOTLIGHT_BG, borderRadius: 10, padding: 12 },
  spotlightHeadRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  spotlightBadge: { alignSelf: 'flex-start', fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: SPOTLIGHT_GOLD, borderWidth: 1, borderColor: SPOTLIGHT_GOLD, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, letterSpacing: 0.4 },
  spotlightTitle: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#ffffff', marginTop: 3 },
  spotlightStatus: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#8fe3ac', marginTop: 2 },
  spotlightPara: { fontSize: 7.5, color: '#c9c8d8', lineHeight: 1.4, marginTop: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 7 },
  chip: { fontSize: 6.8, color: '#e9e8f2', backgroundColor: SPOTLIGHT_CHIP, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },

  footer: { marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: LINE },
  footerText: { fontSize: 6.8, color: MUTED, lineHeight: 1.4 },
})

// ── Small hand-drawn icon set (same path data as the on-screen mockup) ──
const ICONS: Record<string, string> = {
  wallet: 'M2.5 6h19v13H2.5zM2.5 10h19M17 14.2h.01',
  house: 'M4 21V10.5L12 4l8 6.5V21M9 21v-6h6v6',
  scales: 'M12 3v18M5 7h14M5 7 2.5 12a2.5 2.5 0 0 0 5 0zM19 7l-2.5 5a2.5 2.5 0 0 0 5 0zM8 21h8',
  shield: 'M12 3 4.5 6v6c0 4.5 3.2 7.7 7.5 9 4.3-1.3 7.5-4.5 7.5-9V6z',
  globe: 'M12 3.5c2.4 2.4 3.6 5.4 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.4-3.6-8.5S9.6 5.9 12 3.5zM3.5 12h17',
  calendar: 'M3 4.5h18v16H3zM3 9.5h18M8 3v3M16 3v3M8.2 15l2.4 2.4L16 12',
  check: 'M5 12l5 5 9-10',
}
function Icon({ d, color, size = 12 }: { d: string; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

function Tile({ icon, label, value, note }: { icon: string; label: string; value: string; note?: string }) {
  return (
    <View style={s.tile}>
      <View style={s.tileIcon}><Icon d={icon} color={GREEN} /></View>
      <View>
        <Text style={s.tileLabel}>{label}</Text>
        <Text style={s.tileValue}>{value}</Text>
        {note && <Text style={s.tileNote}>{note}</Text>}
      </View>
    </View>
  )
}

function SectionHead({ icon, title }: { icon: string; title: string }) {
  return (
    <View style={s.sectionHead}>
      <View style={s.badge}><Icon d={icon} color="#fff" size={9} /></View>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.sectionRule} />
    </View>
  )
}

function RecordSection({ icon, title, status, recordCount, scope }: { icon: string; title: string; status: string | null; recordCount: number | null; scope: string }) {
  const c = sectionStatusColors(status)
  const found = recordCount ?? 0
  return (
    <View style={s.section}>
      <SectionHead icon={icon} title={title} />
      <View style={s.recordCard} wrap={false}>
        <View style={[s.recordIcon, { backgroundColor: c.background }]}><Icon d={icon} color={c.color} size={18} /></View>
        <View>
          <Text style={s.recordTitle}>{found === 0 ? 'No records found' : `${found} record${found === 1 ? '' : 's'} found`}</Text>
          <View style={s.recordStatusRow}>
            <Icon d={ICONS.check} color={c.color} size={8} />
            <Text style={[s.recordStatusText, { color: c.color }]}>{(status ?? 'unknown').replace(/^\w/, ch => ch.toUpperCase())}</Text>
          </View>
          <Text style={s.recordScope}>{scope}</Text>
        </View>
      </View>
    </View>
  )
}

function OnTimeTrend({ c }: { c: CreditSummary }) {
  if (!c.paymentTimeline || c.paymentTimeline.length < 2 || c.onTimePaymentRate === null) return null
  const W = 500, H = 44, PAD = 4
  const pts = c.paymentTimeline
  const x = (i: number) => PAD + (i / (pts.length - 1)) * (W - PAD * 2)
  const y = (v: number) => PAD + (1 - v / 100) * (H - PAD * 2)
  const d = pts.map((m, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(m.onTimeRate).toFixed(1)}`).join(' ')
  const avgY = y(c.onTimePaymentRate)
  return (
    <View style={s.trendBlock}>
      <View style={s.trendHeadRow}>
        <Text style={s.tileLabel}>On-Time Payments</Text>
        <Text style={s.trendValue}>{c.onTimePaymentRate}% avg</Text>
        <Text style={s.trendSub}>Last 24 months</Text>
      </View>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={PAD} y1={avgY} x2={W - PAD} y2={avgY} stroke={LINE} strokeWidth={1} strokeDasharray="3,4" />
        <Path d={d} stroke={ORANGE} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((m, i) => (
          <Circle key={m.month} cx={x(i)} cy={y(m.onTimeRate)} r={m.lateCount > 0 ? 2.6 : 1.6} fill={m.lateCount > 0 ? '#c0392b' : ORANGE} />
        ))}
      </Svg>
    </View>
  )
}

const WATCHLIST_SOURCES = [
  'OFAC Sanctions', 'Treasury SDN & Blocked Persons', 'Dept. of State Sanctions', 'OIG-HHS',
  'System for Award Management', 'FBI Most Wanted', 'INTERPOL Most Wanted', 'DEA Wanted Fugitives',
  'Denied Persons List', '+ 50 additional watchlists',
]

export interface ScreeningSummaryPdfProps {
  applicantName: string | null
  unitLine: string | null
  reportId: string | null
  pulledAt: string | null
  summary: ReportSummary
}

export function ScreeningSummaryPdf({ applicantName, unitLine, reportId, pulledAt, summary }: ScreeningSummaryPdfProps) {
  const band = summary.creditScore !== null ? creditScoreBand(summary.creditScore) : null
  const bandPct = summary.creditScore !== null ? Math.max(0, Math.min(100, ((summary.creditScore - 300) / (850 - 300)) * 100)) : null
  const c = summary.creditSummary
  const sectionFor = (key: string) => summary.sections.find(x => x.key === key) ?? null
  const watchlist = sectionFor('global_watchlist')
  const eviction = sectionFor('eviction_history')
  const criminal = sectionFor('criminal_history')
  const sexOffender = sectionFor('sex_offender_registry')

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.eyebrow}>Screening Summary</Text>
            <Text style={s.name}>{applicantName ?? 'Applicant'}</Text>
            {unitLine && <Text style={s.sub}>{unitLine}</Text>}
          </View>
          <View style={s.metaBox}>
            {reportId && <Text style={s.metaText}>Report ID {reportId}</Text>}
            {pulledAt && <Text style={s.metaText}>Pulled {pulledAt}</Text>}
          </View>
        </View>

        <View style={s.tileRow}>
          {c?.estimatedMonthlyPaymentCents != null && <Tile icon={ICONS.wallet} label="Est. Monthly Payments" value={`~$${Math.round(c.estimatedMonthlyPaymentCents / 100)}/mo`} />}
          <Tile icon={ICONS.house} label="Eviction Records" value={String(eviction?.recordCount ?? 0)} />
          <Tile icon={ICONS.scales} label="Criminal" value={String(criminal?.recordCount ?? 0)} note={`${criminal?.recordCount ?? 0} cases`} />
          <Tile icon={ICONS.shield} label="Sex Offender Registry" value={String(sexOffender?.recordCount ?? 0)} />
          <Tile icon={ICONS.globe} label="Global Watchlist" value={String(watchlist?.recordCount ?? 0)} />
          {c?.onTimePaymentRate != null && <Tile icon={ICONS.calendar} label="On-Time Payments" value={`${c.onTimePaymentRate}%`} note="Last 24 months" />}
        </View>

        {summary.creditScore !== null && band && (
          <View style={s.section}>
            <SectionHead icon={ICONS.wallet} title="Credit Report" />
            <View style={s.creditCard} wrap={false}>
              <View style={s.creditTop}>
                <View>
                  <Text style={s.scoreLabel}>Credit Score</Text>
                  <Text style={s.scoreNum}>{summary.creditScore}+</Text>
                  <Text style={[s.bandPill, { color: band.color, backgroundColor: band.background }]}>{band.label}</Text>
                </View>
                <View style={s.gaugeWrap}>
                  <Svg width="100%" height={10} viewBox="0 0 300 10">
                    <Path d="M0 5h300" stroke={LINE} strokeWidth={8} strokeLinecap="round" />
                    <Path d="M0 5h60" stroke="#c0392b" strokeWidth={8} strokeLinecap="round" />
                    <Path d="M60 5h48" stroke="#e08a1e" strokeWidth={8} />
                    <Path d="M108 5h42" stroke="#e8c547" strokeWidth={8} />
                    <Path d="M150 5h72" stroke="#7fb069" strokeWidth={8} />
                    <Path d="M222 5h78" stroke="#1a6b3c" strokeWidth={8} strokeLinecap="round" />
                    {bandPct !== null && <Circle cx={(bandPct / 100) * 300} cy={5} r={5} fill="#fff" stroke={NAVY} strokeWidth={2} />}
                  </Svg>
                  <View style={s.gaugeLabels}>
                    <Text style={s.gaugeLabelText}>300 · Poor</Text>
                    <Text style={s.gaugeLabelText}>580 · Fair</Text>
                    <Text style={s.gaugeLabelText}>670 · Good</Text>
                    <Text style={s.gaugeLabelText}>740 · Very Good</Text>
                    <Text style={s.gaugeLabelText}>850 · Exceptional</Text>
                  </View>
                  {summary.creditReportStatus && (
                    <Text style={s.gaugeNote}>
                      Calculated on VantageScore 4.0. Report status:{' '}
                      <Text style={{ fontFamily: 'Helvetica-Bold', color: sectionStatusColors(summary.creditReportStatus).color }}>
                        {summary.creditReportStatus.replace(/^\w/, ch => ch.toUpperCase())}
                      </Text>
                    </Text>
                  )}
                </View>
              </View>

              {c && (
                <View style={s.statRow2}>
                  {c.estimatedMonthlyPaymentCents != null && <View style={s.stat2}><Text style={s.stat2Label}>Est. Monthly</Text><Text style={s.stat2Value}>${Math.round(c.estimatedMonthlyPaymentCents / 100)}/mo</Text></View>}
                  {c.totalAccounts != null && <View style={s.stat2}><Text style={s.stat2Label}>Total Accounts</Text><Text style={s.stat2Value}>{c.totalAccounts}</Text></View>}
                  {c.averageAccountAgeMonths != null && <View style={s.stat2}><Text style={s.stat2Label}>Avg Account Age</Text><Text style={s.stat2Value}>{(c.averageAccountAgeMonths / 12).toFixed(1)} yrs</Text></View>}
                  {(c.collectionsCount != null || c.bankruptciesCount != null) && <View style={s.stat2}><Text style={s.stat2Label}>Collections / BK</Text><Text style={s.stat2Value}>{c.collectionsCount ?? 0} / {c.bankruptciesCount ?? 0}</Text></View>}
                  {c.creditUtilizationRate != null && <View style={s.stat2}><Text style={s.stat2Label}>Credit Utilization</Text><Text style={s.stat2Value}>{c.creditUtilizationRate}%</Text></View>}
                </View>
              )}

              {c && <OnTimeTrend c={c} />}
            </View>
          </View>
        )}

        <RecordSection icon={ICONS.house} title="Eviction History" status={eviction?.status ?? null} recordCount={eviction?.recordCount ?? null} scope="30M+ records scanned · 49 states · South Dakota excluded" />
        <RecordSection icon={ICONS.scales} title="Criminal History" status={criminal?.status ?? null} recordCount={criminal?.recordCount ?? null} scope="800M+ records scanned · 50 states · full US coverage" />
        <RecordSection icon={ICONS.shield} title="Sex Offender Registry" status={sexOffender?.status ?? null} recordCount={sexOffender?.recordCount ?? null} scope="50 state registries · DC & territories" />

        <View style={s.spotlight} wrap={false}>
          <View style={s.spotlightHeadRow}>
            <Svg width={40} height={40} viewBox="0 0 24 24">
              <Circle cx={12} cy={12} r={8.5} stroke="#4b4e78" strokeWidth={1} fill="none" />
              <Path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.4 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.4-3.6-8.5S9.6 5.9 12 3.5z" stroke="#4b4e78" strokeWidth={0.8} fill="none" />
              <Circle cx={12} cy={12} r={1.4} fill={SPOTLIGHT_GOLD} />
            </Svg>
            <View>
              <Text style={s.spotlightBadge}>GLOBAL REACH · INCLUDED IN EVERY SCREEN</Text>
              <Text style={s.spotlightTitle}>Global Watchlist</Text>
              <Text style={s.spotlightStatus}>{(watchlist?.recordCount ?? 0) === 0 ? 'No records found' : `${watchlist?.recordCount} record(s) found`}</Text>
            </View>
          </View>
          <Text style={s.spotlightPara}>
            Cross-referenced against sanctions, exclusion, and most-wanted lists spanning federal law enforcement, treasury, and
            international agencies — the reach most competing tenant screens don&apos;t cover.
          </Text>
          <View style={s.chipRow}>
            {WATCHLIST_SOURCES.map(src => <Text key={src} style={s.chip}>{src}</Text>)}
          </View>
        </View>

        <View style={s.footer}>
          <Text style={s.footerText}>
            This is a MAIA-generated summary for quick staff/board review — it is not the consumer report. The full report,
            prepared by Checkr, Inc. (CRA) under the Fair Credit Reporting Act (FCRA) with all required disclosures, is filed
            separately and is the retained record of this screening. Screening decisions must comply with applicable federal,
            state, and local fair-housing laws.
          </Text>
        </View>
      </Page>
    </Document>
  )
}
